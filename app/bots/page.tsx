"use client";

import { useEffect, useMemo, useState } from "react";
import { BotCard } from "../../components/BotCard";
import { BOT_CATALOG } from "../../data/bots";
import type { Market, RiskLevel } from "../../lib/types";
import { loadDiscoveryPreferences, saveDiscoveryPreferences, type DiscoveryPreferences } from "../../lib/preferences";

type MarketFilter = Market | "all";
type RiskFilter = RiskLevel | "all";
type SortOption = "return-desc" | "drawdown-asc" | "win-rate-desc" | "stability-desc";

const TAGS = Array.from(new Set(BOT_CATALOG.flatMap((bot) => bot.tags))).sort((a, b) => a.localeCompare(b, "zh-Hant"));
const TIMEFRAMES = Array.from(new Set(BOT_CATALOG.map((bot) => bot.timeframe))).sort();

export default function BotsPage() {
  const [market, setMarket] = useState<MarketFilter>("all");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [tag, setTag] = useState("all");
  const [timeframe, setTimeframe] = useState("all");
  const [sort, setSort] = useState<SortOption>("return-desc");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [preferenceError, setPreferenceError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = loadDiscoveryPreferences();
      if (!saved) return;
      setMarket(saved.market);
      setRisk(saved.risk);
      setTag(saved.tag === "all" || TAGS.includes(saved.tag) ? saved.tag : "all");
      setTimeframe(saved.timeframe === "all" || TIMEFRAMES.includes(saved.timeframe) ? saved.timeframe : "all");
      setSort(saved.sort);
      setFavorites(saved.favorites.filter((id) => BOT_CATALOG.some((bot) => bot.id === id)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const persist = (next: Partial<DiscoveryPreferences>) => {
    const result = saveDiscoveryPreferences({ market, risk, tag, timeframe, sort, favorites, ...next });
    setPreferenceError(result.ok ? "" : result.reason);
  };

  const visibleBots = useMemo(() => BOT_CATALOG
    .filter((bot) => market === "all" || bot.market === market)
    .filter((bot) => risk === "all" || bot.risk === risk)
    .filter((bot) => tag === "all" || bot.tags.includes(tag))
    .filter((bot) => timeframe === "all" || bot.timeframe === timeframe)
    .toSorted((a, b) => {
      if (sort === "drawdown-asc") return Math.abs(a.metrics.maxDrawdown) - Math.abs(b.metrics.maxDrawdown);
      if (sort === "win-rate-desc") return b.metrics.winRate - a.metrics.winRate;
      if (sort === "stability-desc") return b.metrics.stability - a.metrics.stability;
      return b.metrics.totalReturn - a.metrics.totalReturn;
    }), [market, risk, sort, tag, timeframe]);

  const resetFilters = () => {
    setMarket("all");
    setRisk("all");
    setTag("all");
    setTimeframe("all");
    persist({ market: "all", risk: "all", tag: "all", timeframe: "all" });
  };

  const toggleFavorite = (botId: string) => {
    const next = favorites.includes(botId) ? favorites.filter((id) => id !== botId) : [...favorites, botId];
    setFavorites(next);
    persist({ favorites: next });
  };

  return (
    <div className="catalog-page site-container">
      <header className="page-intro">
        <p className="eyebrow">BOT CATALOG / WEEX API · 推薦</p>
        <h1>機器人市場</h1>
        <p>比較 10 組經典策略的模擬績效，從市場、風險與策略邏輯找到合適的起點。</p>
        <p className="simulation-disclosure" role="note">模擬回測資料，不代表未來績效</p>
      </header>

      <section className="catalog-controls glass-panel" aria-label="篩選與排序機器人">
        <label>
          <span>市場</span>
          <select value={market} onChange={(event) => { const value = event.target.value as MarketFilter; setMarket(value); persist({ market: value }); }}>
            <option value="all">全部市場</option><option value="spot">現貨</option><option value="futures">合約</option>
          </select>
        </label>
        <label>
          <span>風險等級</span>
          <select value={risk} onChange={(event) => { const value = event.target.value as RiskFilter; setRisk(value); persist({ risk: value }); }}>
            <option value="all">全部風險</option><option value="低">低風險</option><option value="中">中風險</option><option value="高">高風險</option>
          </select>
        </label>
        <label>
          <span>策略類型</span>
          <select value={tag} onChange={(event) => { const value = event.target.value; setTag(value); persist({ tag: value }); }}>
            <option value="all">全部策略</option>
            {TAGS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>交易週期</span>
          <select value={timeframe} onChange={(event) => { const value = event.target.value; setTimeframe(value); persist({ timeframe: value }); }}>
            <option value="all">全部週期</option>
            {TIMEFRAMES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>排序方式</span>
          <select value={sort} onChange={(event) => { const value = event.target.value as SortOption; setSort(value); persist({ sort: value }); }}>
            <option value="return-desc">累積收益：高到低</option>
            <option value="drawdown-asc">最大回撤：低到高</option>
            <option value="win-rate-desc">勝率：高到低</option>
            <option value="stability-desc">穩定度：高到低</option>
          </select>
        </label>
      </section>

      {preferenceError && <p className="catalog-preference-status" role="status">{preferenceError}，目前篩選仍可繼續使用。</p>}

      <div className="catalog-summary">
        <p aria-live="polite">顯示 {visibleBots.length} / {BOT_CATALOG.length} 組策略</p>
        <button className="text-button" onClick={resetFilters} type="button">重設篩選</button>
      </div>

      {visibleBots.length > 0 ? (
        <section className="bot-grid" aria-label="機器人搜尋結果">
          {visibleBots.map((bot) => <BotCard bot={bot} favorite={favorites.includes(bot.id)} key={bot.id} onFavorite={toggleFavorite} />)}
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
