"use client";

import { useMemo, useState } from "react";
import { BotCard } from "../../components/BotCard";
import { BOT_CATALOG } from "../../data/bots";
import type { Market, RiskLevel } from "../../lib/types";

type MarketFilter = Market | "all";
type RiskFilter = RiskLevel | "all";
type SortOption = "return-desc" | "drawdown-asc" | "win-rate-desc" | "stability-desc";

const TAGS = Array.from(new Set(BOT_CATALOG.flatMap((bot) => bot.tags))).sort((a, b) => a.localeCompare(b, "zh-Hant"));

export default function BotsPage() {
  const [market, setMarket] = useState<MarketFilter>("all");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [tag, setTag] = useState("all");
  const [sort, setSort] = useState<SortOption>("return-desc");

  const visibleBots = useMemo(() => BOT_CATALOG
    .filter((bot) => market === "all" || bot.market === market)
    .filter((bot) => risk === "all" || bot.risk === risk)
    .filter((bot) => tag === "all" || bot.tags.includes(tag))
    .toSorted((a, b) => {
      if (sort === "drawdown-asc") return Math.abs(a.metrics.maxDrawdown) - Math.abs(b.metrics.maxDrawdown);
      if (sort === "win-rate-desc") return b.metrics.winRate - a.metrics.winRate;
      if (sort === "stability-desc") return b.metrics.stability - a.metrics.stability;
      return b.metrics.totalReturn - a.metrics.totalReturn;
    }), [market, risk, sort, tag]);

  const resetFilters = () => {
    setMarket("all");
    setRisk("all");
    setTag("all");
  };

  return (
    <div className="catalog-page site-container">
      <header className="page-intro">
        <p className="eyebrow">BOT CATALOG / WEEX ONLY</p>
        <h1>機器人市場</h1>
        <p>比較 10 組經典策略的模擬績效，從市場、風險與策略邏輯找到合適的起點。</p>
        <p className="simulation-disclosure" role="note">模擬回測資料，不代表未來績效</p>
      </header>

      <section className="catalog-controls glass-panel" aria-label="篩選與排序機器人">
        <label>
          <span>市場</span>
          <select value={market} onChange={(event) => setMarket(event.target.value as MarketFilter)}>
            <option value="all">全部市場</option><option value="spot">現貨</option><option value="futures">合約</option>
          </select>
        </label>
        <label>
          <span>風險等級</span>
          <select value={risk} onChange={(event) => setRisk(event.target.value as RiskFilter)}>
            <option value="all">全部風險</option><option value="低">低風險</option><option value="中">中風險</option><option value="高">高風險</option>
          </select>
        </label>
        <label>
          <span>策略類型</span>
          <select value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="all">全部策略</option>
            {TAGS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>排序方式</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)}>
            <option value="return-desc">累積收益：高到低</option>
            <option value="drawdown-asc">最大回撤：低到高</option>
            <option value="win-rate-desc">勝率：高到低</option>
            <option value="stability-desc">穩定度：高到低</option>
          </select>
        </label>
      </section>

      <div className="catalog-summary">
        <p aria-live="polite">顯示 {visibleBots.length} / {BOT_CATALOG.length} 組策略</p>
        <button className="text-button" onClick={resetFilters} type="button">重設篩選</button>
      </div>

      {visibleBots.length > 0 ? (
        <section className="bot-grid" aria-label="機器人搜尋結果">
          {visibleBots.map((bot) => <BotCard bot={bot} key={bot.id} />)}
        </section>
      ) : (
        <section className="empty-state glass-panel" aria-live="polite">
          <p className="eyebrow">NO MATCHES</p><h2>沒有符合條件的機器人</h2>
          <p>調整市場、風險或策略類型，探索其他組合。</p>
          <button className="button button--primary" onClick={resetFilters} type="button">清除篩選</button>
        </section>
      )}
    </div>
  );
}
