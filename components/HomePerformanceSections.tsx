"use client";

import { useEffect, useMemo, useState } from "react";
import { BOT_CATALOG } from "../data/bots";
import type { BotDefinition, WeexHistoricalPerformance } from "../lib/types";
import { isVerifiedWeexPerformance, loadWeexBotPerformance } from "../lib/weex-historical-client";
import { BotCard } from "./BotCard";

export function HomePerformanceSections() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [performances, setPerformances] = useState<Record<string, WeexHistoricalPerformance>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadWeexBotPerformance().then((result) => {
      if (cancelled) return;
      const complete = !result.demo && BOT_CATALOG.every((bot) => isVerifiedWeexPerformance(result.performances[bot.id]));
      if (!complete) {
        setState("error");
        return;
      }
      setPerformances(result.performances);
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
    }
    return values.toSorted((a, b) => b.metrics.totalReturn - a.metrics.totalReturn);
  }, [performances]);

  const topBots = rankedBots.slice(0, 3);
  const ready = state === "ready" && rankedBots.length === BOT_CATALOG.length;

  if (!ready) {
    return (
      <section className="landing-section site-container" aria-label="熱門機器人近期績效">
        <div className="leaderboard-data-state glass-panel" aria-live="polite" role={state === "error" ? "alert" : "status"}>
          <p className="eyebrow">VERIFIED MARKET DATA</p>
          <h2>{state === "error" ? "近期熱門策略暫時無法取得" : "正在計算熱門策略"}</h2>
          <p>{state === "error" ? "沒有顯示舊的模擬排行或替代數據，請稍後重新載入。" : "正在以公開歷史 K 線計算策略績效。"}</p>
          {state === "error" && (
            <button className="button button--secondary" onClick={() => { setState("loading"); setReloadKey((value) => value + 1); }} type="button">重新載入</button>
          )}
        </div>
      </section>
    );
  }

  return (
      <section className="landing-section site-container" aria-labelledby="featured-title">
        <p className="eyebrow">TOP PERFORMERS / 30 DAYS</p>
        <h2 id="featured-title">熱門機器人</h2>
        <div className="bot-grid bot-grid--featured">
          {topBots.map((bot) => <BotCard bot={bot} historicalPerformance={bot.historicalPerformance} key={bot.id} />)}
        </div>
      </section>
  );
}
