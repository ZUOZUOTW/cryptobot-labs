"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BotCard } from "@/components/BotCard";
import { BOT_CATALOG } from "@/data/bots";
import { loadDiscoveryPreferences, saveDiscoveryPreferences } from "@/lib/preferences";
import type { WeexHistoricalPerformance } from "@/lib/types";
import { isVerifiedWeexPerformance, loadWeexBotPerformance } from "@/lib/weex-historical-client";

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  const [performanceState, setPerformanceState] = useState<"loading" | "ready" | "error">("loading");
  const [performances, setPerformances] = useState<Record<string, WeexHistoricalPerformance>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = loadDiscoveryPreferences();
      setFavorites(saved?.favorites.filter((id) => BOT_CATALOG.some((bot) => bot.id === id)) ?? []);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadWeexBotPerformance().then((result) => {
      if (cancelled) return;
      const complete = !result.demo && BOT_CATALOG.every((bot) => isVerifiedWeexPerformance(result.performances[bot.id]));
      setPerformances(complete ? result.performances : {});
      setPerformanceState(complete ? "ready" : "error");
    }).catch(() => {
      if (!cancelled) setPerformanceState("error");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const favoriteBots = useMemo(() => favorites
    .map((id) => BOT_CATALOG.find((bot) => bot.id === id))
    .filter((bot): bot is (typeof BOT_CATALOG)[number] => Boolean(bot)), [favorites]);

  const removeFavorite = (botId: string) => {
    const next = favorites.filter((id) => id !== botId);
    const saved = loadDiscoveryPreferences();
    const result = saved
      ? saveDiscoveryPreferences({ ...saved, favorites: next })
      : { ok: false as const, reason: "無法儲存探索偏好" };
    setFavorites(next);
    setPreferenceError(result.ok ? "" : result.reason);
  };

  return (
    <div className="catalog-page favorites-page site-container">
      <header className="page-intro">
        <p className="eyebrow">收藏 / 策略</p>
        <h1>收藏策略</h1>
        <p>集中查看你收藏的策略，可直接查看詳細資料或帶入組裝車間。</p>
      </header>

      {!hydrated ? (
        <p className="catalog-preference-status favorites-page__loading" role="status">正在載入收藏策略…</p>
      ) : favoriteBots.length > 0 ? (
        <>
          <div className="catalog-summary">
            <p aria-live="polite"><strong>{favoriteBots.length}</strong> <span>收藏</span></p>
            <Link className="text-button" href="/bots">探索策略</Link>
          </div>
          {preferenceError && <p className="catalog-preference-status" role="status">{preferenceError}</p>}
          {performanceState === "error" && (
            <p className="catalog-preference-status" role="alert">近期績效暫時無法取得；未顯示替代或虛構數據。</p>
          )}
          <section className="bot-grid" aria-label="收藏策略">
            {favoriteBots.map((bot) => (
              <BotCard
                bot={bot}
                favorite
                historicalPerformance={performances[bot.id]}
                key={bot.id}
                onFavorite={removeFavorite}
                performanceStatus={performanceState === "ready" && !performances[bot.id] ? "error" : performanceState}
              />
            ))}
          </section>
        </>
      ) : (
        <section className="empty-state glass-panel" aria-live="polite">
          <p className="eyebrow">收藏 / 策略</p>
          <h2>尚未收藏任何策略</h2>
          <p>在探索策略頁點選星號，收藏後會顯示在這裡。</p>
          <Link className="button button--primary" href="/bots">探索策略</Link>
        </section>
      )}
    </div>
  );
}
