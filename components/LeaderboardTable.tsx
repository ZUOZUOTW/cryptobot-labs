"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BOT_CATALOG } from "../data/bots";
import { useI18n } from "./I18nProvider";
import type { BotDefinition, EquityPoint, WeexHistoricalPerformance } from "../lib/types";
import { isVerifiedWeexPerformance, loadWeexBotPerformance } from "../lib/weex-historical-client";
import styles from "./LeaderboardTable.module.css";

export type LeaderboardSort = "return" | "winRate" | "trades" | "stability" | "drawdown" | "sharpe";
type SortDirection = "ascending" | "descending";

const SORT_LABELS: Readonly<Record<LeaderboardSort, string>> = {
  return: "交易績效",
  winRate: "勝率",
  trades: "交易次數",
  stability: "穩定度",
  drawdown: "最大回撤",
  sharpe: "夏普比率",
};

const SORT_BUTTON_LABELS: Readonly<Record<LeaderboardSort, string>> = {
  return: "交易績效",
  winRate: "勝率",
  trades: "交易次數",
  stability: "穩定度",
  drawdown: "低回撤",
  sharpe: "夏普比率",
};

const SORT_OPTIONS = Object.keys(SORT_BUTTON_LABELS) as LeaderboardSort[];

const BATTLE_COLORS = [
  "#54f7c2", "#58e6ff", "#9b7cff", "#ffb36b", "#ff6f69",
  "#63d8ff", "#b5ff7d", "#e889ff", "#ffd166", "#7aa2ff",
] as const;

const BATTLE_MASCOTS = [
  "/mascots/ai-guardian.webp",
  "/mascots/ai-observer.webp",
  "/mascots/ai-builder.webp",
] as const;
const BATTLE_CHART_LIMIT = 10;

const battleVisual = (botId: string) => {
  const catalogIndex = Math.max(0, BOT_CATALOG.findIndex((bot) => bot.id === botId));
  return {
    color: BATTLE_COLORS[catalogIndex % BATTLE_COLORS.length],
    mascot: BATTLE_MASCOTS[catalogIndex % BATTLE_MASCOTS.length],
  };
};

interface RankedBot extends BotDefinition {
  historicalPerformance: WeexHistoricalPerformance;
}

const defaultSortDirection = (sort: LeaderboardSort): SortDirection => sort === "drawdown" ? "ascending" : "descending";

const metricValue = (bot: RankedBot, sort: LeaderboardSort) => {
  if (sort === "winRate") return bot.metrics.winRate;
  if (sort === "trades") return bot.metrics.trades;
  if (sort === "stability") return bot.metrics.stability;
  if (sort === "drawdown") return Math.abs(bot.metrics.maxDrawdown);
  if (sort === "sharpe") return bot.metrics.sharpe;
  return bot.metrics.totalReturn;
};

function rankBots(bots: readonly RankedBot[], sort: LeaderboardSort, direction = defaultSortDirection(sort)): RankedBot[] {
  return [...bots].toSorted((a, b) => {
    const difference = direction === "ascending"
      ? metricValue(a, sort) - metricValue(b, sort)
      : metricValue(b, sort) - metricValue(a, sort);
    return difference || a.id.localeCompare(b.id);
  });
}

const signedPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const drawdownPercent = (value: number) => `${value.toFixed(1)}%`;

const comparisonValue = metricValue;

const comparisonLabel = (bot: RankedBot, sort: LeaderboardSort) => {
  const value = comparisonValue(bot, sort);
  if (sort === "return") return signedPercent(value);
  if (sort === "winRate") return `${value.toFixed(1)}%`;
  if (sort === "trades") return Math.round(value).toLocaleString();
  if (sort === "stability") return `${value.toFixed(0)} / 100`;
  if (sort === "drawdown") return `${value.toFixed(1)}%`;
  return value.toFixed(2);
};

const chartMetricLabel = (value: number, sort: LeaderboardSort) => {
  if (sort === "return") return signedPercent(value);
  if (sort === "winRate") return `${value.toFixed(1)}%`;
  if (sort === "trades") return Math.round(value).toLocaleString();
  if (sort === "drawdown") return `${value.toFixed(1)}%`;
  if (sort === "stability") return value.toFixed(0);
  return value.toFixed(2);
};

function progressiveMetric(values: readonly number[], sort: LeaderboardSort): number {
  if (values.length < 2) return 0;
  const first = Math.max(values[0] ?? 100, 0.0001);
  if (sort === "return") return ((values.at(-1)! / first) - 1) * 100;
  let peak = values[0] ?? 100;
  let maximumDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    maximumDrawdown = Math.max(maximumDrawdown, peak === 0 ? 0 : ((peak - value) / peak) * 100);
  }
  if (sort === "drawdown") return maximumDrawdown;
  const returns = values.slice(1).map((value, index) => values[index] === 0 ? 0 : value / values[index]! - 1);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const deviation = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length);
  if (sort === "sharpe") return deviation === 0 ? 0 : (mean / deviation) * Math.sqrt(returns.length);
  const positiveRatio = returns.filter((value) => value > 0).length / returns.length;
  const volatilityScore = Math.max(0, 1 - deviation * Math.sqrt(returns.length));
  const drawdownScore = Math.max(0, 1 - maximumDrawdown / 100);
  return Math.min(100, Math.max(0, volatilityScore * 50 + positiveRatio * 25 + drawdownScore * 25));
}

function battleMetricSeries(bot: RankedBot, sort: LeaderboardSort) {
  return bot.equityCurve.map((point, index) => ({
    label: point.label,
    value: index === bot.equityCurve.length - 1
      ? comparisonValue(bot, sort)
      : progressiveMetric(bot.equityCurve.slice(0, index + 1).map((item) => item.value), sort),
  }));
}

function smoothPath(coordinates: Array<{ x: number; y: number }>): string {
  if (coordinates.length === 0) return "";
  if (coordinates.length === 1) return `M ${coordinates[0].x} ${coordinates[0].y}`;
  return coordinates.slice(1).reduce((path, point, index) => {
    const current = coordinates[index];
    const previous = coordinates[index - 1] ?? current;
    const next = coordinates[index + 2] ?? point;
    const controlOneX = current.x + (point.x - previous.x) / 6;
    const controlOneY = current.y + (point.y - previous.y) / 6;
    const controlTwoX = point.x - (next.x - current.x) / 6;
    const controlTwoY = point.y - (next.y - current.y) / 6;
    return `${path} C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${point.x} ${point.y}`;
  }, `M ${coordinates[0].x} ${coordinates[0].y}`);
}

function ArenaTrend({ label, points, compact = false }: { label: string; points: readonly EquityPoint[]; compact?: boolean }) {
  const gradientId = `arena-trend-${useId().replace(/:/g, "")}`;
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(maximum - minimum, 1);
  const coordinates = points.map((point, index) => ({
    x: (index * 180) / Math.max(points.length - 1, 1),
    y: 47 - ((point.value - minimum) / spread) * 39,
  }));
  const line = smoothPath(coordinates);
  const area = coordinates.length === 0 ? "" : `${line} L 180 52 L 0 52 Z`;

  return (
    <svg aria-label={label} className={`arena-trend${compact ? " arena-trend--compact" : ""}`} preserveAspectRatio="none" role="img" viewBox="0 0 180 54">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#54f7c2" stopOpacity="0.36" />
          <stop offset="1" stopColor="#54f7c2" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="arena-trend__area" d={area} fill={`url(#${gradientId})`} />
      <path className="arena-trend__line" d={line} fill="none" pathLength="1" />
    </svg>
  );
}

function BattleChart({ bots, onSortChange, sort }: { bots: readonly RankedBot[]; onSortChange: (sort: LeaderboardSort) => void; sort: LeaderboardSort }) {
  const width = 1240;
  const height = 500;
  const paddingLeft = 68;
  const paddingTop = 40;
  const plotBottom = 438;
  const chartRight = 934;
  const labelX = 986;
  const plottedSort: LeaderboardSort = sort === "winRate" || sort === "trades" ? "return" : sort;
  const metricSeries = bots.map((bot) => battleMetricSeries(bot, plottedSort));
  const values = metricSeries.flatMap((points) => points.map((point) => point.value));
  const rawMinimum = Math.min(0, ...values);
  const rawMaximum = Math.max(0, ...values);
  const padding = Math.max((rawMaximum - rawMinimum) * 0.08, plottedSort === "sharpe" ? 0.2 : 1);
  const minimum = plottedSort === "return" ? rawMinimum - padding : 0;
  const maximum = Math.max(rawMaximum + padding, plottedSort === "stability" ? 100 : plottedSort === "sharpe" ? 1 : 5);
  const spread = Math.max(maximum - minimum, 0.001);
  const yForValue = (value: number) => paddingTop + ((maximum - value) / spread) * (plotBottom - paddingTop);
  const yTicks = Array.from({ length: 5 }, (_, index) => maximum - (spread / 4) * index);
  const longestTimeline = metricSeries.reduce((longest, points) => points.length > longest.length ? points : longest, metricSeries[0] ?? []);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const pointIndex = Math.round(ratio * Math.max(longestTimeline.length - 1, 0));
    return {
      x: paddingLeft + ratio * (chartRight - paddingLeft),
      label: longestTimeline[pointIndex]?.label ?? "",
    };
  });
  const series = bots.map((bot, index) => {
    const curve = metricSeries[index] ?? [];
    const visual = battleVisual(bot.id);
    const coordinates = curve.map((point, pointIndex) => ({
      x: paddingLeft + (pointIndex / Math.max(curve.length - 1, 1)) * (chartRight - paddingLeft),
      y: yForValue(point.value),
    }));
    return {
      bot,
      color: visual.color,
      mascot: visual.mascot,
      coordinates,
      path: smoothPath(coordinates),
      endpoint: coordinates.at(-1) ?? { x: chartRight, y: height / 2 },
    };
  });
  const orderedLabels = [...series].sort((a, b) => a.endpoint.y - b.endpoint.y);
  const labelStep = orderedLabels.length > 1 ? (plotBottom - paddingTop) / (orderedLabels.length - 1) : 0;
  const labelYById = new Map(orderedLabels.map((item, index) => [item.bot.id, paddingTop + index * labelStep]));
  const baselineY = yForValue(0);
  const aggregateSort = sort === "winRate" || sort === "trades";
  const chartTitle = aggregateSort
    ? `依${SORT_LABELS[sort]}排序的近 30 天機器人交易績效戰況；點擊折線或線端標籤可查看機器人詳情`
    : `近 30 天機器人${SORT_LABELS[sort]}戰況；點擊折線或線端標籤可查看機器人詳情`;

  return (
    <div className={`battle-chart glass-panel ${styles.battleChart}`}>
      <div className={styles.battleToolbar}>
        <div className={styles.battleStatus}>
          <span aria-hidden="true" />
          <strong>前 {bots.length} 組策略即時對照</strong>
          <small>VERIFIED HISTORICAL BACKTEST</small>
        </div>
        <div className={styles.sortDock}>
          <span className={styles.sortLabel}>戰況排序</span>
          <div className={styles.sortButtons} role="group" aria-label="戰況排序">
            {SORT_OPTIONS.map((option) => (
              <button
                aria-pressed={sort === option}
                className={styles.sortButton}
                data-active={sort === option ? "true" : "false"}
                key={option}
                onClick={() => onSortChange(option)}
                type="button"
              >
                {SORT_BUTTON_LABELS[option]}
              </button>
            ))}
          </div>
          <span className={styles.sortResult} aria-live="polite">依{SORT_LABELS[sort]}排序</span>
        </div>
        <div className={styles.battleMeta} aria-label="圖表設定">
          <span>近 30 天</span>
          <span>{aggregateSort ? `${SORT_LABELS[sort]}排序 · 交易績效 %` : `${SORT_LABELS[sort]}${sort === "return" || sort === "drawdown" ? " %" : ""}`}</span>
        </div>
      </div>
      <div className={styles.plotScroller}>
        <svg aria-label={chartTitle} className={`battle-chart__plot ${styles.plot}`} fill="none" role="img" viewBox={`0 0 ${width} ${height}`}>
          {plottedSort === "return" && <rect className={styles.profitZone} height={Math.max(baselineY - paddingTop, 0)} width={chartRight - paddingLeft} x={paddingLeft} y={paddingTop} />}
          {plottedSort === "return" && <rect className={styles.lossZone} height={Math.max(plotBottom - baselineY, 0)} width={chartRight - paddingLeft} x={paddingLeft} y={baselineY} />}
          {yTicks.map((value) => {
            const y = yForValue(value);
            return (
              <g key={value}>
                <line className={`battle-chart__gridline ${styles.gridline}`} x1={paddingLeft} x2={chartRight} y1={y} y2={y} />
                <text className={`battle-chart__axis-label ${styles.axisLabel}`} textAnchor="end" x={paddingLeft - 12} y={y}>{chartMetricLabel(value, plottedSort)}</text>
              </g>
            );
          })}
          {xTicks.map((tick, index) => (
            <g key={`${tick.label}-${index}`}>
              <line className={styles.verticalGridline} x1={tick.x} x2={tick.x} y1={paddingTop} y2={plotBottom} />
              <text className={`battle-chart__axis-label ${styles.timeLabel}`} textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"} x={tick.x} y={472}>{tick.label}</text>
            </g>
          ))}
          {plottedSort === "return" && <line className={styles.baseline} x1={paddingLeft} x2={chartRight} y1={baselineY} y2={baselineY} />}
          {plottedSort === "return" && <text className={styles.baselineLabel} x={paddingLeft + 10} y={baselineY - 9}>STARTING EQUITY</text>}
          <line className={styles.labelRail} x1={chartRight + 24} x2={chartRight + 24} y1={paddingTop} y2={plotBottom} />
          {series.map(({ bot, color, endpoint, mascot, path }, index) => {
            const labelY = labelYById.get(bot.id) ?? endpoint.y;
            const style = {
              "--battle-color": color,
              "--battle-delay": `${index * 28}ms`,
            } as CSSProperties;

            return (
              <a aria-label={`查看 ${bot.name}，${SORT_LABELS[sort]} ${comparisonLabel(bot, sort)}`} className={`battle-chart__series ${styles.series}`} data-bot-id={bot.id} href={`/bots/${bot.id}`} key={bot.id} style={style}>
                <path className={`battle-chart__hit ${styles.hit}`} d={path} fill="none" stroke="transparent" />
                <path className={`battle-chart__line ${styles.line}`} d={path} fill="none" pathLength="1" stroke={color} vectorEffect="non-scaling-stroke" />
                <path className={styles.endConnector} d={`M ${endpoint.x} ${endpoint.y} L ${chartRight + 24} ${labelY} L ${labelX - 8} ${labelY}`} stroke={color} vectorEffect="non-scaling-stroke" />
                <circle className={styles.endDot} cx={endpoint.x} cy={endpoint.y} fill="#04111f" r="5" stroke={color} vectorEffect="non-scaling-stroke" />
                <g className={`battle-chart__end-card ${styles.endCard}`}>
                  <rect className={styles.endCardSurface} height="36" rx="7" width="232" x={labelX} y={labelY - 18} />
                  <rect fill={color} height="36" rx="2" width="3" x={labelX} y={labelY - 18} />
                  <circle className={styles.avatarRing} cx={labelX + 22} cy={labelY} fill="#071121" r="14" stroke={color} />
                  <image height="27" href={mascot} preserveAspectRatio="xMidYMid slice" width="30" x={labelX + 7} y={labelY - 14} />
                  <text aria-hidden="true" className={`battle-chart__end-label ${styles.endLabel}`} fill={color} x={labelX + 43} y={labelY - 4}>{bot.name}</text>
                  <text aria-hidden="true" className={styles.endValue} data-result={sort === "return" ? (bot.metrics.totalReturn >= 0 ? "profit" : "loss") : "metric"} x={labelX + 43} y={labelY + 12}>{comparisonLabel(bot, sort)}</text>
                </g>
              </a>
            );
          })}
        </svg>
      </div>
      <div className={`battle-chart__legend ${styles.legend}`} aria-label="機器人戰況圖例">
        {bots.map((bot) => (
          <Link className={styles.legendLink} href={`/bots/${bot.id}`} key={bot.id} style={{ "--battle-color": battleVisual(bot.id).color } as CSSProperties}>
            <span aria-hidden="true" className={styles.swatch} />
            <strong className={styles.legendName}>{bot.name}</strong>
            <em className={styles.legendResult} data-result={sort === "return" ? (bot.metrics.totalReturn >= 0 ? "profit" : "loss") : "metric"}>{comparisonLabel(bot, sort)}</em>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function LeaderboardTable() {
  const { locale } = useI18n();
  const [sort, setSort] = useState<LeaderboardSort>("return");
  const [tableSort, setTableSort] = useState<{ direction: SortDirection; key: LeaderboardSort }>({ direction: "descending", key: "return" });
  const [performanceState, setPerformanceState] = useState<"loading" | "ready" | "error">("loading");
  const [performances, setPerformances] = useState<Record<string, WeexHistoricalPerformance>>({});
  const [performanceUpdatedAt, setPerformanceUpdatedAt] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const rowNodes = useRef(new Map<string, HTMLTableRowElement>());
  const previousPositions = useRef(new Map<string, number>());

  useEffect(() => {
    let cancelled = false;
    void loadWeexBotPerformance().then((result) => {
      if (cancelled) return;
      const complete = !result.demo && BOT_CATALOG.every((bot) => isVerifiedWeexPerformance(result.performances[bot.id]));
      if (!complete) {
        setPerformances({});
        setPerformanceState("error");
        return;
      }
      setPerformances(result.performances);
      setPerformanceUpdatedAt(result.updatedAt);
      setPerformanceState("ready");
    }).catch(() => {
      if (!cancelled) setPerformanceState("error");
    });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const realBots = useMemo(() => BOT_CATALOG.flatMap((bot) => {
    const historicalPerformance = performances[bot.id];
    return historicalPerformance ? [{
      ...bot,
      metrics: historicalPerformance.metrics,
      equityCurve: historicalPerformance.equityCurve,
      disclaimer: historicalPerformance.disclaimer,
      historicalPerformance,
    }] : [];
  }), [performances]);
  const rankedBots = useMemo(() => rankBots(realBots, sort), [realBots, sort]);
  const tableBots = useMemo(() => rankBots(realBots, tableSort.key, tableSort.direction), [realBots, tableSort]);
  const battleBots = rankedBots.slice(0, BATTLE_CHART_LIMIT);
  const podium = rankedBots.slice(0, 3);
  const returnValues = rankedBots.map((bot) => bot.metrics.totalReturn);
  const minimumReturn = Math.min(...returnValues, 0);
  const maximumReturn = Math.max(...returnValues, 0);
  const returnSpread = Math.max(maximumReturn - minimumReturn, 1);
  const maximumDrawdown = Math.max(...rankedBots.map((bot) => Math.abs(bot.metrics.maxDrawdown)), 1);
  const clusteredReturnIds = rankedBots
    .filter((bot) => Math.abs(bot.metrics.totalReturn) <= 2)
    .map((bot) => bot.id);

  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>();
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rowNodes.current.forEach((node, id) => {
      const top = node.getBoundingClientRect().top;
      nextPositions.set(id, top);
      const previousTop = previousPositions.current.get(id);
      const offset = previousTop === undefined ? 0 : previousTop - top;
      if (!reduceMotion && offset !== 0 && typeof node.animate === "function") {
        node.animate([{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }], { duration: 240, easing: "cubic-bezier(.16,1,.3,1)" });
      }
    });
    previousPositions.current = nextPositions;
  }, [tableBots]);

  const changeBattleSort = (nextSort: LeaderboardSort) => {
    setSort(nextSort);
    setTableSort({ direction: defaultSortDirection(nextSort), key: nextSort });
  };

  const changeTableSort = (key: LeaderboardSort) => {
    setTableSort((current) => ({
      direction: current.key === key
        ? (current.direction === "descending" ? "ascending" : "descending")
        : defaultSortDirection(key),
      key,
    }));
  };

  const sortableHeader = (key: LeaderboardSort, label: string) => (
    <th aria-sort={tableSort.key === key ? tableSort.direction : "none"} scope="col">
      <button aria-label={label} className="leaderboard-table__sort-button" onClick={() => changeTableSort(key)} type="button">
        <span>{label}</span>
        <span aria-hidden="true">{tableSort.key === key ? (tableSort.direction === "descending" ? "↓" : "↑") : "↕"}</span>
      </button>
    </th>
  );

  return (
    <div className="leaderboard-experience">
      {performanceState !== "ready" || rankedBots.length !== BOT_CATALOG.length ? (
        <section className="leaderboard-data-state glass-panel" aria-live="polite" role={performanceState === "error" ? "alert" : "status"}>
          <p className="eyebrow">MARKET DATA</p>
          <h2>{performanceState === "error" ? "近期績效暫時無法取得" : "正在計算近期績效"}</h2>
          <p>{performanceState === "error" ? "沒有顯示替代或虛構數據，請稍後重新載入。" : `正在整理 ${BOT_CATALOG.length} 組策略的公開歷史 K 線回測結果。`}</p>
          {performanceState === "error" && <button className="button button--secondary" onClick={() => { setPerformanceState("loading"); setReloadKey((value) => value + 1); }} type="button">重新載入</button>}
        </section>
      ) : (
        <>
          <section className="leaderboard-section" aria-label="前三名頒獎台">
            <div className="section-heading"><p className="eyebrow">TOP PERFORMERS / 30 DAYS</p><h2>本期領先策略</h2></div>
            <div className="podium-grid">
              {podium.map((bot, index) => (
                <article className="podium-card glass-panel" data-rank={index + 1} key={bot.id}>
                  <span className="podium-card__rank" aria-label={`第 ${index + 1} 名`}>0{index + 1}</span>
                  <Image alt="" aria-hidden="true" className="podium-card__mascot" height={180} src={index === 0 ? "/mascots/ai-guardian.webp" : index === 1 ? "/mascots/ai-observer.webp" : "/mascots/ai-builder.webp"} width={200} />
                  <div className="podium-card__identity"><p className="eyebrow">{bot.symbol} / {bot.timeframe.toUpperCase()}</p><h3><Link href={`/bots/${bot.id}`}>{bot.name}</Link></h3><span className="risk-badge" data-risk={bot.risk}>{bot.risk}風險</span></div>
                  <div className="podium-card__trend"><span>PERFORMANCE TREND</span><ArenaTrend label={`${bot.name} 近 30 天趨勢`} points={bot.equityCurve} /></div>
                  <dl>
                    <div><dt>{SORT_LABELS[sort]}</dt><dd>{comparisonLabel(bot, sort)}</dd></div>
                    <div><dt>勝率</dt><dd>{bot.metrics.winRate.toFixed(1)}%</dd></div>
                    <div><dt>交易次數</dt><dd>{bot.metrics.trades}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <section className="leaderboard-section" aria-label="機器人交易戰況">
            <div className="section-heading"><p className="eyebrow">TRADING BATTLE / CLICK A LINE</p><h2>機器人交易戰況</h2></div>
            <BattleChart bots={battleBots} onSortChange={changeBattleSort} sort={sort} />
          </section>

          <section className={`leaderboard-insights ${styles.insights}`} style={{ display: "block" }}>
            <div className="risk-return-panel glass-panel" role="region" aria-label="風險與收益分布">
              <div className="section-heading"><p className="eyebrow">RISK / RETURN MAP</p><h2>風險與收益分布</h2></div>
              <div className={`risk-return-panel__plot ${styles.riskPlot}`} role="list" aria-label="近 30 天風險與收益資料點">
                <span className="risk-return-panel__axis risk-return-panel__axis--return" aria-hidden="true">收益較高 →</span>
                <span className="risk-return-panel__axis risk-return-panel__axis--risk" aria-hidden="true">風險較高 →</span>
                {rankedBots.map((bot) => {
                  const returnPosition = ((bot.metrics.totalReturn - minimumReturn) / returnSpread) * 82 + 9;
                  const clusterIndex = clusteredReturnIds.indexOf(bot.id);
                  const labelOffset = clusterIndex >= 0 ? clusterIndex * 4.6 : 0;
                  return (
                    <span className="risk-return-panel__point" data-label-placement={returnPosition >= 60 ? "left" : "right"} data-risk={bot.risk} key={bot.id} role="listitem" style={{ "--return-position": `${returnPosition}%`, "--risk-position": `${(Math.abs(bot.metrics.maxDrawdown) / maximumDrawdown) * 78 + 7}%`, "--label-offset": `${labelOffset}rem` } as CSSProperties}>
                      <Link aria-label={`${bot.name}，收益 ${signedPercent(bot.metrics.totalReturn)}，最大回撤 ${drawdownPercent(bot.metrics.maxDrawdown)}`} href={`/bots/${bot.id}`}>
                        <span aria-hidden="true" />
                        <strong><b>{bot.name}</b><small>{signedPercent(bot.metrics.totalReturn)} · 回撤 {drawdownPercent(bot.metrics.maxDrawdown)}</small></strong>
                      </Link>
                    </span>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="leaderboard-section" aria-labelledby="complete-ranking-title">
            <div className="section-heading"><p className="eyebrow">FULL RANKING / {BOT_CATALOG.length} BOTS</p><h2 id="complete-ranking-title">完整績效排名</h2></div>
            <div className="table-shell glass-panel leaderboard-table-shell">
              <table aria-label="完整機器人績效排名" className="leaderboard-table">
                <thead><tr><th scope="col">排名</th><th scope="col">機器人</th>{sortableHeader("return", "交易績效")}<th scope="col">趨勢</th>{sortableHeader("winRate", "勝率")}{sortableHeader("trades", "交易次數")}{sortableHeader("stability", "穩定度")}{sortableHeader("drawdown", "最大回撤")}{sortableHeader("sharpe", "夏普比率")}<th scope="col">風險</th></tr></thead>
                <tbody>
                  {tableBots.map((bot, index) => (
                    <tr className="leaderboard-table__row" data-bot-id={bot.id} key={bot.id} ref={(node) => { if (node) rowNodes.current.set(bot.id, node); else rowNodes.current.delete(bot.id); }}>
                      <td><span className="leaderboard-table__rank">{String(index + 1).padStart(2, "0")}</span></td>
                      <th scope="row"><Link href={`/bots/${bot.id}`}>{bot.name}</Link><small>{bot.symbol} · {bot.market === "spot" ? "現貨" : "合約"}</small></th>
                      <td className={bot.metrics.totalReturn >= 0 ? "value-positive" : "value-negative"}>{signedPercent(bot.metrics.totalReturn)}</td>
                      <td className="leaderboard-table__trend"><ArenaTrend compact label={`${bot.name} 排名趨勢`} points={bot.equityCurve} /></td>
                      <td>{bot.metrics.winRate.toFixed(1)}%</td><td>{bot.metrics.trades}</td><td>{bot.metrics.stability.toFixed(0)}</td><td className="value-negative">{drawdownPercent(bot.metrics.maxDrawdown)}</td><td>{bot.metrics.sharpe.toFixed(2)}</td><td><span className="risk-badge" data-risk={bot.risk}>{bot.risk}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="research-data-note" role="note">
            資料說明：近 30 天 WEEX 公開歷史 K 線，現貨採 4h、合約採 1h；手續費與滑價使用統一研究假設，未計資金費率。更新於 {new Date(performanceUpdatedAt).toLocaleString(locale)}；回測不代表未來績效。
          </p>
        </>
      )}
    </div>
  );
}
