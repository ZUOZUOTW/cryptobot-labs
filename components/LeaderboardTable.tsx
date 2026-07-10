"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BOT_CATALOG } from "../data/bots";
import type { BotDefinition, BotMetrics, EquityPoint } from "../lib/types";
import { PerformanceChart } from "./PerformanceChart";

export type LeaderboardPeriod = "30" | "90" | "365";
export type LeaderboardSort = "return" | "stability" | "drawdown" | "sharpe";

export const PERIOD_FACTORS: Readonly<Record<LeaderboardPeriod, number>> = {
  "30": 0.14,
  "90": 0.37,
  "365": 1,
};

const DISCLAIMER = "模擬回測資料，不代表未來績效";
const PERIOD_DAYS: Readonly<Record<LeaderboardPeriod, number>> = { "30": 30, "90": 90, "365": 365 };
const PERIOD_LABELS: Readonly<Record<LeaderboardPeriod, string>> = { "30": "30 天", "90": "90 天", "365": "1 年" };
const SORT_LABELS: Readonly<Record<LeaderboardSort, string>> = {
  return: "累積收益",
  stability: "穩定度",
  drawdown: "最大回撤",
  sharpe: "夏普比率",
};

interface RankedBot extends BotDefinition {
  projectedMetrics: BotMetrics;
  projectedCurve: EquityPoint[];
}

const projectCurve = (points: EquityPoint[], period: LeaderboardPeriod) => {
  const factor = PERIOD_FACTORS[period];
  const finalIndex = Math.max(points.length - 1, 1);

  return points.map((point, index) => ({
    ...point,
    label: period === "365"
      ? point.label
      : `第 ${1 + Math.round(((PERIOD_DAYS[period] - 1) * index) / finalIndex)} 天`,
    value: 100 + ((point.value - 100) * factor),
  }));
};

export function projectMetrics(metrics: BotMetrics, period: LeaderboardPeriod): BotMetrics {
  const factor = PERIOD_FACTORS[period];
  return {
    ...metrics,
    totalReturn: metrics.totalReturn * factor,
    annualizedReturn: metrics.annualizedReturn * factor,
    maxDrawdown: metrics.maxDrawdown * factor,
    trades: Math.max(1, Math.round(metrics.trades * factor)),
    runningDays: PERIOD_DAYS[period],
  };
}

export function rankBots(
  bots: readonly BotDefinition[],
  period: LeaderboardPeriod,
  sort: LeaderboardSort,
): RankedBot[] {
  return bots
    .map((bot) => ({
      ...bot,
      projectedMetrics: projectMetrics(bot.metrics, period),
      projectedCurve: projectCurve(bot.equityCurve, period),
    }))
    .toSorted((a, b) => {
      const aMetrics = a.projectedMetrics;
      const bMetrics = b.projectedMetrics;
      let difference: number;

      if (sort === "stability") difference = bMetrics.stability - aMetrics.stability;
      else if (sort === "drawdown") difference = Math.abs(aMetrics.maxDrawdown) - Math.abs(bMetrics.maxDrawdown);
      else if (sort === "sharpe") difference = bMetrics.sharpe - aMetrics.sharpe;
      else difference = bMetrics.totalReturn - aMetrics.totalReturn;

      return difference || a.id.localeCompare(b.id);
    });
}

const signedPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const drawdownPercent = (value: number) => `${value.toFixed(1)}%`;

const comparisonValue = (bot: RankedBot, sort: LeaderboardSort) => {
  if (sort === "stability") return bot.projectedMetrics.stability;
  if (sort === "drawdown") return Math.abs(bot.projectedMetrics.maxDrawdown);
  if (sort === "sharpe") return bot.projectedMetrics.sharpe;
  return bot.projectedMetrics.totalReturn;
};

const comparisonLabel = (bot: RankedBot, sort: LeaderboardSort) => {
  const value = comparisonValue(bot, sort);
  if (sort === "return") return signedPercent(value);
  if (sort === "stability") return `${value.toFixed(0)} / 100`;
  if (sort === "drawdown") return `${value.toFixed(1)}%`;
  return value.toFixed(2);
};

export function LeaderboardTable() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("365");
  const [sort, setSort] = useState<LeaderboardSort>("return");
  const rowNodes = useRef(new Map<string, HTMLTableRowElement>());
  const previousPositions = useRef(new Map<string, number>());
  const rankedBots = useMemo(() => rankBots(BOT_CATALOG, period, sort), [period, sort]);
  const podium = rankedBots.slice(0, 3);
  const leader = rankedBots[0];
  const maximumComparison = Math.max(...rankedBots.map((bot) => comparisonValue(bot, sort)), 1);
  const maximumReturn = Math.max(...rankedBots.map((bot) => bot.projectedMetrics.totalReturn), 1);
  const maximumDrawdown = Math.max(...rankedBots.map((bot) => Math.abs(bot.projectedMetrics.maxDrawdown)), 1);

  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>();
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    rowNodes.current.forEach((node, id) => {
      const top = node.getBoundingClientRect().top;
      nextPositions.set(id, top);
      const previousTop = previousPositions.current.get(id);
      const offset = previousTop === undefined ? 0 : previousTop - top;
      if (!reduceMotion && offset !== 0 && typeof node.animate === "function") {
        node.animate(
          [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
          { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      }
    });

    previousPositions.current = nextPositions;
  }, [rankedBots]);

  return (
    <div className="leaderboard-experience">
      <section className="leaderboard-controls glass-panel" aria-label="排行榜顯示設定">
        <fieldset>
          <legend>績效期間</legend>
          <div className="period-switcher">
            {(Object.keys(PERIOD_LABELS) as LeaderboardPeriod[]).map((value) => (
              <button
                aria-pressed={period === value}
                className="period-switcher__button"
                key={value}
                onClick={() => setPeriod(value)}
                type="button"
              >
                {PERIOD_LABELS[value]}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          <span>排序指標</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as LeaderboardSort)}>
            <option value="return">累積收益：高到低</option>
            <option value="stability">穩定度：高到低</option>
            <option value="drawdown">最大回撤：低到高</option>
            <option value="sharpe">夏普比率：高到低</option>
          </select>
        </label>
        <p className="leaderboard-controls__status" aria-live="polite">
          目前顯示 {PERIOD_LABELS[period]}，依{SORT_LABELS[sort]}排序
        </p>
      </section>

      <section className="leaderboard-section" aria-label="前三名頒獎台">
        <div className="section-heading">
          <p className="eyebrow">TOP PERFORMERS / {PERIOD_LABELS[period]}</p>
          <h2 id="podium-title">本期領先策略</h2>
        </div>
        <div className="podium-grid">
          {podium.map((bot, index) => (
            <article className="podium-card glass-panel" data-rank={index + 1} key={bot.id}>
              <span className="podium-card__rank" aria-label={`第 ${index + 1} 名`}>0{index + 1}</span>
              <div>
                <p className="eyebrow">{bot.exchange} / {bot.symbol}</p>
                <h3><Link href={`/bots/${bot.id}`}>{bot.name}</Link></h3>
                <span className="risk-badge" data-risk={bot.risk}>{bot.risk}風險</span>
              </div>
              <dl>
                <div><dt>{SORT_LABELS[sort]}</dt><dd>{comparisonLabel(bot, sort)}</dd></div>
                <div><dt>期間收益</dt><dd>{signedPercent(bot.projectedMetrics.totalReturn)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
        <p className="simulation-disclosure" role="note">{DISCLAIMER}</p>
      </section>

      <section className="leaderboard-section" aria-label="機器人績效比較">
        <div className="section-heading">
          <p className="eyebrow">RELATIVE SCALE</p>
          <h2 id="comparison-title">{SORT_LABELS[sort]}比較{sort === "drawdown" ? "（越短越好）" : ""}</h2>
        </div>
        <ol className="comparison-bars glass-panel">
          {rankedBots.map((bot, index) => (
            <li data-bot-id={bot.id} key={bot.id}>
              <span className="comparison-bars__rank">{String(index + 1).padStart(2, "0")}</span>
              <Link className="comparison-bars__name" href={`/bots/${bot.id}`}>{bot.name}</Link>
              <span className="comparison-bars__track" aria-hidden="true">
                <span style={{ "--bar-width": `${(comparisonValue(bot, sort) / maximumComparison) * 100}%` } as CSSProperties} />
              </span>
              <strong className="comparison-bars__value">{comparisonLabel(bot, sort)}</strong>
            </li>
          ))}
        </ol>
        <p className="simulation-disclosure" role="note">{DISCLAIMER}</p>
      </section>

      <section className="leaderboard-insights">
        <div className="leaderboard-insights__curve">
          <div className="section-heading">
            <p className="eyebrow">LEADER CURVE</p>
            <h2>{leader.name} 模擬收益軌跡</h2>
          </div>
          <PerformanceChart
            label={`${leader.name} ${PERIOD_LABELS[period]}收益曲線`}
            points={leader.projectedCurve}
            tone={leader.risk === "高" ? "danger" : "mint"}
          />
          <p className="simulation-disclosure" role="note">{DISCLAIMER}</p>
        </div>

        <div className="risk-return-panel glass-panel" role="region" aria-label="風險與收益分布">
          <div className="section-heading">
            <p className="eyebrow">RISK / RETURN MAP</p>
            <h2>風險與收益分布</h2>
          </div>
          <div className="risk-return-panel__plot" role="list" aria-label={`${PERIOD_LABELS[period]}風險與收益資料點`}>
            <span className="risk-return-panel__axis risk-return-panel__axis--return" aria-hidden="true">收益較高 →</span>
            <span className="risk-return-panel__axis risk-return-panel__axis--risk" aria-hidden="true">風險較高 →</span>
            {rankedBots.map((bot) => {
              const returnPosition = (bot.projectedMetrics.totalReturn / maximumReturn) * 86 + 7;
              const labelPlacement = returnPosition >= 60 ? "left" : "right";

              return (
                <span
                  className="risk-return-panel__point"
                  data-label-placement={labelPlacement}
                  data-risk={bot.risk}
                  key={bot.id}
                  role="listitem"
                  style={{
                    "--return-position": `${returnPosition}%`,
                    "--risk-position": `${(Math.abs(bot.projectedMetrics.maxDrawdown) / maximumDrawdown) * 78 + 7}%`,
                  } as CSSProperties}
                >
                  <Link
                    aria-label={`${bot.name}，收益 ${signedPercent(bot.projectedMetrics.totalReturn)}，最大回撤 ${drawdownPercent(bot.projectedMetrics.maxDrawdown)}`}
                    href={`/bots/${bot.id}`}
                  >
                    <span aria-hidden="true" />
                    <strong>{bot.name}</strong>
                  </Link>
                </span>
              );
            })}
          </div>
          <p className="simulation-disclosure" role="note">{DISCLAIMER}</p>
        </div>
      </section>

      <section className="leaderboard-section" aria-labelledby="complete-ranking-title">
        <div className="section-heading">
          <p className="eyebrow">FULL RANKING / 10 BOTS</p>
          <h2 id="complete-ranking-title">完整績效排名</h2>
        </div>
        <div className="table-shell glass-panel leaderboard-table-shell">
          <table aria-label="完整機器人績效排名" className="leaderboard-table">
            <thead>
              <tr>
                <th scope="col">排名</th><th scope="col">機器人</th><th scope="col">期間收益</th>
                <th scope="col">穩定度</th><th scope="col">最大回撤</th><th scope="col">夏普比率</th><th scope="col">風險</th>
              </tr>
            </thead>
            <tbody>
              {rankedBots.map((bot, index) => (
                <tr
                  className="leaderboard-table__row"
                  data-bot-id={bot.id}
                  key={bot.id}
                  ref={(node) => {
                    if (node) rowNodes.current.set(bot.id, node);
                    else rowNodes.current.delete(bot.id);
                  }}
                >
                  <td><span className="leaderboard-table__rank">{String(index + 1).padStart(2, "0")}</span></td>
                  <th scope="row"><Link href={`/bots/${bot.id}`}>{bot.name}</Link><small>{bot.exchange} · {bot.market === "spot" ? "現貨" : "合約"}</small></th>
                  <td className="value-positive">{signedPercent(bot.projectedMetrics.totalReturn)}</td>
                  <td>{bot.projectedMetrics.stability.toFixed(0)}</td>
                  <td className="value-negative">{drawdownPercent(bot.projectedMetrics.maxDrawdown)}</td>
                  <td>{bot.projectedMetrics.sharpe.toFixed(2)}</td>
                  <td><span className="risk-badge" data-risk={bot.risk}>{bot.risk}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="simulation-disclosure" role="note">{DISCLAIMER}</p>
      </section>
    </div>
  );
}
