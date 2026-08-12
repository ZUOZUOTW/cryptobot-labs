"use client";

import { useEffect, useMemo, useState } from "react";
import type { BotDefinition, WeexHistoricalPerformance } from "../lib/types";
import { benchmarkSeries } from "../lib/benchmark-series";
import { isVerifiedWeexPerformance, loadWeexBotPerformance } from "../lib/weex-historical-client";
import { MetricCard } from "./MetricCard";
import { PerformanceChart } from "./PerformanceChart";
import { BotDownloadButton } from "./BotCard";

export function BotDetailPerformance({ bot }: { bot: BotDefinition }) {
  const [performance, setPerformance] = useState<WeexHistoricalPerformance | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    void loadWeexBotPerformance().then((result) => {
      if (cancelled) return;
      const item = !result.demo ? result.performances[bot.id] : undefined;
      if (!isVerifiedWeexPerformance(item)) {
        setState("error");
        return;
      }
      setPerformance(item);
      setState("ready");
    }).catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [bot.id]);

  const view = useMemo(() => performance ? { ...bot, metrics: performance.metrics, equityCurve: performance.equityCurve } : null, [bot, performance]);
  if (state !== "ready" || !performance || !view) {
    return (
      <section className="detail-section site-container" aria-live="polite" role={state === "error" ? "alert" : "status"}>
        <div className="leaderboard-data-state glass-panel">
          <p className="eyebrow">VERIFIED MARKET DATA</p>
          <h2>{state === "error" ? "真實行情績效暫時無法取得" : "正在驗證行情績效"}</h2>
          <p>{state === "error" ? "不顯示替代或合成數據，請稍後重新載入。" : "正在取得公開歷史 K 線與回測證據。"}</p>
        </div>
      </section>
    );
  }

  const metrics = view.metrics;
  const benchmark = benchmarkSeries(view);
  const botFinal = view.equityCurve.at(-1)?.value ?? 100;
  const benchmarkFinal = benchmark.at(-1)?.value ?? 100;
  const difference = botFinal - benchmarkFinal;
  const monthly = view.equityCurve.map((point, index) => {
    const previous = view.equityCurve[index - 1]?.value ?? point.value;
    return { ...point, change: previous === 0 ? 0 : ((point.value - previous) / previous) * 100 };
  });

  return (
    <>
      <section className="detail-section site-container" aria-label="完整績效指標">
        <div className="button-row"><BotDownloadButton bot={bot} historicalPerformance={performance} className="button button--secondary" /></div>
        <div className="metric-grid">
          <MetricCard label="交易績效" value={`${metrics.totalReturn >= 0 ? "+" : ""}${metrics.totalReturn.toFixed(1)}%`} hint="回測期間資產淨值變化" tone="mint" />
          <MetricCard label="年化報酬" value={`${metrics.annualizedReturn >= 0 ? "+" : ""}${metrics.annualizedReturn.toFixed(1)}%`} hint="依回測期間換算的年化值" tone="cyan" />
          <MetricCard label="最大回撤" value={`${metrics.maxDrawdown.toFixed(1)}%`} hint="回測高點至低點最大跌幅" tone="danger" />
          <MetricCard label="勝率" value={`${metrics.winRate.toFixed(1)}%`} hint="獲利交易占全部交易比例" tone="violet" />
          <MetricCard label="盈虧比" value={metrics.profitFactor.toFixed(2)} hint="總獲利相對總虧損" tone="mint" />
          <MetricCard label="夏普比率" value={metrics.sharpe.toFixed(2)} hint="風險調整後報酬" tone="cyan" />
          <MetricCard label="交易次數" value={metrics.trades} hint="目前回測區間成交次數" tone="violet" />
          <MetricCard label="運行天數" value={metrics.runningDays} hint="目前回測觀察期間" tone="cyan" />
          <MetricCard label="風險等級" value={bot.risk} hint={`穩定度 ${metrics.stability} / 100`} tone={bot.risk === "高" ? "danger" : "mint"} />
        </div>
        <p className="simulation-disclosure" role="note">{performance.disclaimer}</p>
      </section>

      <section className="detail-section site-container detail-performance-comparison">
        <div className="section-heading"><p className="eyebrow">EQUITY CURVE</p><h2>交易績效走勢</h2></div>
        <div className="detail-performance-comparison__charts">
          <PerformanceChart points={view.equityCurve} label={`${bot.name} 交易績效曲線`} tone={bot.risk === "高" ? "danger" : "mint"} />
          <PerformanceChart points={benchmark} label="市場基準曲線" tone="cyan" />
        </div>
        <section aria-label="策略與基準比較摘要" className="benchmark-summary glass-panel">
          <h3>策略與基準比較</h3>
          <p>{bot.name} 期末淨值 {botFinal.toFixed(1)}；市場基準期末淨值 {benchmarkFinal.toFixed(1)}。策略{difference >= 0 ? "領先" : "落後"}基準 {Math.abs(difference).toFixed(1)} 點。</p>
        </section>
        <p className="simulation-disclosure" role="note">資料來源：WEEX 公開歷史 K 線；{performance.disclaimer}</p>
      </section>

      <section className="detail-section site-container" aria-labelledby="monthly-title">
        <div className="section-heading"><p className="eyebrow">PERIOD PERFORMANCE</p><h2 id="monthly-title">分段表現</h2></div>
        <div className="table-shell glass-panel">
          <table aria-label={`${bot.name} 分段表現`}>
            <thead><tr><th scope="col">區間</th><th scope="col">期末淨值</th><th scope="col">區間變化</th><th scope="col">方向</th></tr></thead>
            <tbody>{monthly.map((point) => (
              <tr key={point.label}><th scope="row">{point.label}</th><td>{point.value.toFixed(1)}</td><td className={point.change >= 0 ? "value-positive" : "value-negative"}>{point.change >= 0 ? "+" : ""}{point.change.toFixed(1)}%</td><td>{point.change > 0 ? "上升" : point.change < 0 ? "下降" : "持平"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
