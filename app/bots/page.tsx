"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { BotCard } from "../../components/BotCard";
import { BOT_CATALOG } from "../../data/bots";
import type { Market, RiskLevel, WeexHistoricalPerformance } from "../../lib/types";
import { loadDiscoveryPreferences, saveDiscoveryPreferences, type DiscoveryPreferences } from "../../lib/preferences";
import { isVerifiedWeexPerformance, loadWeexBotPerformance } from "../../lib/weex-historical-client";
import { captureAttribution } from "../../lib/attribution";
import { demoAuthPath } from "../../lib/demo-auth";
import { usePlatformUser } from "../../components/PlatformAuthProvider";
import { useI18n } from "../../components/I18nProvider";
import { PublishedStrategyCard } from "../../components/PublishedStrategyCard";
import type { PublicStrategyPublication } from "../../lib/strategy-publications";

type MarketFilter = Market | "all";
type RiskFilter = RiskLevel | "all";
type SortOption = "recommended" | "return-desc" | "drawdown-asc" | "win-rate-desc" | "stability-desc";

const TAGS = Array.from(new Set(BOT_CATALOG.flatMap((bot) => bot.tags))).sort((a, b) => a.localeCompare(b, "zh-Hant"));
const TIMEFRAMES = Array.from(new Set(BOT_CATALOG.map((bot) => bot.timeframe))).sort();

export default function BotsPage() {
  const { locale } = useI18n();
  const user = usePlatformUser();
  const [market, setMarket] = useState<MarketFilter>("all");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [tag, setTag] = useState("all");
  const [timeframe, setTimeframe] = useState("all");
  const [sort, setSort] = useState<SortOption>("recommended");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [preferenceError, setPreferenceError] = useState("");
  const [performanceState, setPerformanceState] = useState<"loading" | "ready" | "error">("loading");
  const [performances, setPerformances] = useState<Record<string, WeexHistoricalPerformance>>({});
  const [performanceUpdatedAt, setPerformanceUpdatedAt] = useState("");
  const [demoPerformance, setDemoPerformance] = useState(false);
  const [performanceReloadKey, setPerformanceReloadKey] = useState(0);
  const [publications, setPublications] = useState<PublicStrategyPublication[]>([]);
  const [publicationState, setPublicationState] = useState<"loading" | "ready" | "error">("loading");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  useEffect(() => {
    captureAttribution(new URLSearchParams(window.location.search).get("via"));
    const timer = window.setTimeout(() => {
      const saved = loadDiscoveryPreferences();
      if (!saved) return;
      const nextTag = saved.tag === "all" || TAGS.includes(saved.tag) ? saved.tag : "all";
      const nextTimeframe = saved.timeframe === "all" || TIMEFRAMES.includes(saved.timeframe) ? saved.timeframe : "all";
      const hasMatch = BOT_CATALOG.some((bot) => (
        (saved.market === "all" || bot.market === saved.market)
        && (saved.risk === "all" || bot.risk === saved.risk)
        && (nextTag === "all" || bot.tags.includes(nextTag))
        && (nextTimeframe === "all" || bot.timeframe === nextTimeframe)
      ));
      setMarket(hasMatch ? saved.market : "all");
      setRisk(hasMatch ? saved.risk : "all");
      setTag(hasMatch ? nextTag : "all");
      setTimeframe(hasMatch ? nextTimeframe : "all");
      setSort(saved.sort);
      setFavorites(saved.favorites.filter((id) => BOT_CATALOG.some((bot) => bot.id === id)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/strategy-publications", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const body = await response.json() as { publications?: unknown };
        if (!response.ok || !Array.isArray(body.publications)) throw new Error("publication_list_failed");
        const valid = body.publications.filter((entry): entry is PublicStrategyPublication => (
          Boolean(entry) && typeof entry === "object"
          && typeof (entry as { slug?: unknown }).slug === "string"
          && typeof (entry as { name?: unknown }).name === "string"
          && typeof (entry as { publisherName?: unknown }).publisherName === "string"
          && ["long", "short", "both"].includes(String((entry as { tradeDirection?: unknown }).tradeDirection))
          && typeof (entry as { hasPrivateSource?: unknown }).hasPrivateSource === "boolean"
          && Array.isArray((entry as { blocks?: unknown }).blocks)
          && Array.isArray((entry as { equityCurve?: unknown }).equityCurve)
        ));
        if (!cancelled) { setPublications(valid); setPublicationState("ready"); }
      })
      .catch(() => { if (!cancelled) setPublicationState("error"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadWeexBotPerformance({ forceRefresh: performanceReloadKey > 0 }).then((result) => {
      if (cancelled) return;
      const complete = !result.demo && BOT_CATALOG.every((bot) => isVerifiedWeexPerformance(result.performances[bot.id]));
      if (!complete) {
        setPerformances({});
        setDemoPerformance(result.demo);
        setPerformanceState("error");
        return;
      }
      setPerformances(result.performances);
      setPerformanceUpdatedAt(result.updatedAt);
      setDemoPerformance(result.demo);
      setPerformanceState("ready");
    }).catch(() => {
      if (!cancelled) setPerformanceState("error");
    });
    return () => { cancelled = true; };
  }, [performanceReloadKey]);

  const catalog = useMemo(() => BOT_CATALOG.map((bot) => {
    const performance = performances[bot.id];
    return performance ? { ...bot, metrics: performance.metrics, equityCurve: performance.equityCurve, disclaimer: performance.disclaimer } : bot;
  }), [performances]);

  const persist = (next: Partial<DiscoveryPreferences>) => {
    const result = saveDiscoveryPreferences({ market, risk, tag, timeframe, sort, favorites, ...next });
    setPreferenceError(result.ok ? "" : result.reason);
  };

  const visibleBots = useMemo(() => catalog
    .filter((bot) => market === "all" || bot.market === market)
    .filter((bot) => risk === "all" || bot.risk === risk)
    .filter((bot) => tag === "all" || bot.tags.includes(tag))
    .filter((bot) => timeframe === "all" || bot.timeframe === timeframe)
    .toSorted((a, b) => {
      if (sort === "drawdown-asc") return Math.abs(a.metrics.maxDrawdown) - Math.abs(b.metrics.maxDrawdown);
      if (sort === "win-rate-desc") return b.metrics.winRate - a.metrics.winRate;
      if (sort === "stability-desc") return b.metrics.stability - a.metrics.stability;
      if (sort === "recommended") {
        const score = (item: typeof a) => item.metrics.stability + item.metrics.sharpe * 12 - Math.abs(item.metrics.maxDrawdown) + Math.min(item.metrics.trades, 100) / 20;
        return score(b) - score(a);
      }
      return b.metrics.totalReturn - a.metrics.totalReturn;
    }), [catalog, market, risk, sort, tag, timeframe]);
  const displayedBots = user ? visibleBots : visibleBots.slice(0, 6);
  const hasMemberResults = !user && visibleBots.length > displayedBots.length;

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
        <p className="eyebrow">PUBLIC STRATEGIES / 01</p>
        <h1>探索策略</h1>
        <p>先比較用途、風險、最大回撤、交易次數與資料日期；未登入可預覽精選策略，登入後查看完整策略庫。</p>
      </header>

      {(publicationState === "loading" || publications.length > 0) && (
        <section className="published-strategies" aria-labelledby="published-strategies-title">
          <div className="section-heading">
            <p className="eyebrow">COMMUNITY RELEASES</p>
            <h2 id="published-strategies-title">會員公開策略</h2>
            <p>每一張卡片都綁定不可變策略版本與完整公開行情回測，不顯示未驗證績效。</p>
          </div>
          {publicationState === "loading" ? (
            <div className="published-strategies__loading glass-panel" role="status">正在載入會員公開策略…</div>
          ) : (
            <div className="published-strategies__grid">
              {publications.map((publication) => <PublishedStrategyCard key={publication.slug} publication={publication} />)}
            </div>
          )}
        </section>
      )}
      {publicationState === "error" && (
        <p className="catalog-preference-status" role="status">會員公開策略暫時無法載入；官方策略仍可正常瀏覽。</p>
      )}

      <button
        aria-controls="catalog-filter-panel"
        aria-expanded={mobileFiltersOpen}
        className="catalog-filter-toggle button button--secondary"
        onClick={() => setMobileFiltersOpen((open) => !open)}
        type="button"
      >
        {mobileFiltersOpen ? "收合篩選" : "篩選與排序"}
      </button>
      <section
        className="catalog-controls glass-panel"
        data-mobile-open={mobileFiltersOpen}
        id="catalog-filter-panel"
        aria-label="篩選與排序機器人"
      >
        <div className="catalog-choice-filter catalog-choice-filter--market">
          <span>市場</span>
          <div aria-label="市場" className="catalog-choice-group" role="group">
            {([
              ["all", "全部", user ? `${catalog.length} 組` : "公開預覽"],
              ["spot", "現貨", "資產持有"],
              ["futures", "合約", "多空策略"],
            ] as const).map(([value, label, detail]) => (
              <button
                aria-pressed={market === value}
                data-choice={value}
                data-filter-control="market"
                key={value}
                onClick={() => { setMarket(value); persist({ market: value }); }}
                type="button"
              >
                <strong>{label}</strong><small>{detail}</small>
              </button>
            ))}
          </div>
        </div>
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
        <div className="catalog-choice-filter catalog-choice-filter--timeframe">
          <span>交易週期</span>
          <div aria-label="交易週期" className="catalog-choice-group catalog-choice-group--timeframe" role="group">
            {["all", ...TIMEFRAMES].map((value) => (
              <button
                aria-pressed={timeframe === value}
                data-filter-control="timeframe"
                key={value}
                onClick={() => { setTimeframe(value); persist({ timeframe: value }); }}
                type="button"
              >
                <strong>{value === "all" ? "全部" : value}</strong>
                <small>{value === "all" ? "不限" : value === "1h" ? "日內" : "波段"}</small>
              </button>
            ))}
          </div>
        </div>
        <label>
          <span>排序方式</span>
          <select value={sort} onChange={(event) => { const value = event.target.value as SortOption; setSort(value); persist({ sort: value }); }}>
            <option value="recommended">熱門推薦：完成度與風險調整</option>
            <option value="return-desc">交易績效：高到低</option>
            <option value="drawdown-asc">最大回撤：低到高</option>
            <option value="win-rate-desc">勝率：高到低</option>
            <option value="stability-desc">穩定度：高到低</option>
          </select>
        </label>
      </section>

      {preferenceError && <p className="catalog-preference-status" role="status">{preferenceError}，目前篩選仍可繼續使用。</p>}
      {demoPerformance && <p className="catalog-preference-status" role="note">目前是展示環境，未載入真實行情績效，因此不顯示替代或合成數據。</p>}
      {performanceState !== "ready" && (
        <p className="catalog-preference-status" role={performanceState === "error" ? "alert" : "status"}>
          {performanceState === "error" ? "近期績效暫時無法取得；未顯示替代或虛構數據。" : "正在計算近期績效…"}
          {performanceState === "error" && (
            <button
              className="text-button"
              onClick={() => {
                setPerformanceState("loading");
                setPerformanceReloadKey((value) => value + 1);
              }}
              type="button"
            >
              重新取得績效
            </button>
          )}
        </p>
      )}

      <div className="catalog-summary">
        <p aria-live="polite">{user ? `顯示 ${displayedBots.length} / ${visibleBots.length} 組符合策略` : `目前顯示 ${displayedBots.length} 組符合策略`}</p>
        <div className="catalog-summary__actions">
          <Link aria-label="收藏策略" className="text-button catalog-favorites-link" href="/favorites">
            <span>收藏</span><span>策略</span><strong>{favorites.length}</strong>
          </Link>
          <button className="text-button" onClick={resetFilters} type="button">重設篩選</button>
        </div>
      </div>

      {visibleBots.length > 0 ? (
        <>
          <section className="bot-grid" aria-label="機器人搜尋結果">
            {displayedBots.map((bot) => <BotCard
              bot={bot}
              favorite={favorites.includes(bot.id)}
              historicalPerformance={performances[bot.id]}
              key={bot.id}
              onFavorite={toggleFavorite}
              performanceStatus={performanceState === "ready" && !demoPerformance && !performances[bot.id] ? "error" : performanceState}
            />)}
          </section>
          {hasMemberResults && (
            <section className="catalog-member-vault" aria-label="會員策略庫預覽">
              <div className="catalog-member-backdrop" aria-hidden="true">
                {[
                  { image: "/mascots/ai-observer.webp", tone: "violet" },
                  { image: "/mascots/ai-builder.webp", tone: "cyan" },
                  { image: "/mascots/ai-guardian.webp", tone: "mint" },
                ].map((card) => (
                  <div className="catalog-member-backdrop__card" data-tone={card.tone} key={card.image}>
                    <Image alt="" height={128} loading="lazy" src={card.image} width={148} />
                    <div className="catalog-member-backdrop__skeleton">
                      <span /><span /><span />
                    </div>
                  </div>
                ))}
              </div>
              <section className="catalog-login-gate glass-panel" aria-labelledby="catalog-login-title">
                <div className="catalog-login-gate__signal" aria-hidden="true"><span>MEMBER</span><strong>+</strong></div>
                <div className="catalog-login-gate__copy">
                  <p className="eyebrow">MEMBER STRATEGY VAULT</p>
                  <h2 id="catalog-login-title">登入後，繼續探索完整策略庫</h2>
                  <p>查看更多現貨與合約策略、保存收藏偏好，並將策略直接帶入組裝車間。</p>
                  <ul aria-label="會員功能">
                    <li>完整策略比較</li><li>收藏跨裝置保存</li><li>一鍵帶入組裝</li>
                  </ul>
                </div>
                <div className="catalog-login-gate__action">
                  <Link className="button button--primary" href={demoAuthPath("/bots")}>登入繼續探索</Link>
                  <small>不需連接交易帳戶即可瀏覽</small>
                </div>
              </section>
            </section>
          )}
          {performanceState === "ready" && performanceUpdatedAt && (
            <p className="research-data-note research-data-note--catalog" role="note">
              <strong>研究資料說明</strong>
              <span>近 30 天 WEEX 公開歷史 K 線，現貨採 4h、合約採 1h；手續費與滑價使用統一研究假設，未計資金費率。更新於 {new Date(performanceUpdatedAt).toLocaleString(locale)}；回測不代表未來績效。</span>
            </p>
          )}
        </>
      ) : (
        <section className="empty-state glass-panel" aria-live="polite">
          <p className="eyebrow">NO MATCHES</p><h2>沒有符合條件的策略</h2>
          <p>調整市場、風險或策略類型，探索其他組合。</p>
          <button className="button button--primary" onClick={resetFilters} type="button">清除篩選</button>
        </section>
      )}

    </div>
  );
}
