"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BOT_CATALOG } from "../data/bots";
import type { BotDefinition, WeexHistoricalPerformance } from "../lib/types";
import { loadWeexBotPerformance } from "../lib/weex-historical-client";
import { BotCard } from "./BotCard";

export function HomePerformanceSections() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [performances, setPerformances] = useState<Record<string, WeexHistoricalPerformance>>({});
  const [updatedAt, setUpdatedAt] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [demoPerformance, setDemoPerformance] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadWeexBotPerformance().then((result) => {
      if (cancelled) return;
      const complete = result.demo || BOT_CATALOG.every((bot) => Boolean(result.performances[bot.id]));
      if (!complete) {
        setState("error");
        return;
      }
      setPerformances(result.performances);
      setUpdatedAt(result.updatedAt);
      setDemoPerformance(result.demo);
      setState("ready");
    }).catch(() => {
      if (!cancelled) setState("error");
    });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const rankedBots = useMemo<Array<BotDefinition & { historicalPerformance?: WeexHistoricalPerformance }>>(() => {
    const values: Array<BotDefinition & { historicalPerformance?: WeexHistoricalPerformance }> = [];
    for (const bot of BOT_CATALOG) {
      const performance = performances[bot.id];
      if (performance) values.push({ ...bot, metrics: performance.metrics, equityCurve: performance.equityCurve,
        disclaimer: performance.disclaimer, historicalPerformance: performance });
      else if (demoPerformance) values.push({ ...bot, historicalPerformance: undefined });
    }
    return values.toSorted((a, b) => b.metrics.totalReturn - a.metrics.totalReturn);
  }, [demoPerformance, performances]);

  const topBots = rankedBots.slice(0, 3);
  const ready = state === "ready" && rankedBots.length === BOT_CATALOG.length;

  if (!ready) {
    return (
      <section className="landing-section site-container" aria-label="熱門機器人近期績效">
        <div className="leaderboard-data-state glass-panel" aria-live="polite" role={state === "error" ? "alert" : "status"}>
          <p className="eyebrow">WEEX MARKET DATA</p>
          <h2>{state === "error" ? "近期熱門策略暫時無法取得" : "正在計算熱門策略"}</h2>
          <p>{state === "error" ? "沒有顯示舊的模擬排行或替代數據，請稍後重新載入。" : "正在以 WEEX 公開歷史 K 線計算並排序 10 組策略。"}</p>
          {state === "error" && (
            <button className="button button--secondary" onClick={() => { setState("loading"); setReloadKey((value) => value + 1); }} type="button">重新載入</button>
          )}
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="landing-section site-container" aria-labelledby="featured-title">
        <p className="eyebrow">WEEX TOP PERFORMERS / 30 DAYS</p>
        <h2 id="featured-title">熱門機器人</h2>
        <div className="bot-grid bot-grid--featured">
          {topBots.map((bot) => <BotCard bot={bot} historicalPerformance={bot.historicalPerformance} key={bot.id} />)}
        </div>
      </section>

      <section className="landing-section site-container" aria-labelledby="leaderboard-preview-title">
        <p className="eyebrow">WEEX 30-DAY LEADERBOARD</p>
        <h2 id="leaderboard-preview-title">近期績效排行榜</h2>
        <div className="leaderboard-preview glass-panel">
          <ol>
            {topBots.map((bot, index) => (
              <li key={bot.id}>
                <span className="leaderboard-preview__rank">0{index + 1}</span>
                <div><strong>{bot.name}</strong><span>{bot.market === "spot" ? "現貨" : "合約"} · {bot.risk}風險</span></div>
                <dl>
                  <div><dt>累積收益</dt><dd>{bot.metrics.totalReturn >= 0 ? "+" : ""}{bot.metrics.totalReturn.toFixed(1)}%</dd></div>
                  <div><dt>夏普比率</dt><dd>{bot.metrics.sharpe.toFixed(2)}</dd></div>
                </dl>
              </li>
            ))}
          </ol>
          <div className="leaderboard-preview__footer">
            <span>依近 30 天累積收益排序</span>
            <Link className="text-link" href="/leaderboard">查看完整排行榜</Link>
          </div>
        </div>
        <p className="research-data-note" role="note">
          {demoPerformance ? "DEMO_MODE：固定合成行情模擬範例，不呼叫 WEEX 行情 API；僅用於展示操作，完全不代表未來績效。"
            : `資料說明：近 30 天 WEEX 公開歷史 K 線，現貨採 4h、合約採 1h；手續費與滑價使用統一研究假設，未計資金費率。更新於 ${new Date(updatedAt).toLocaleString("zh-TW")}；回測不代表未來績效。`}
        </p>
      </section>
    </>
  );
}
