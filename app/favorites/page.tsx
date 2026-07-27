"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BotCard } from "@/components/BotCard";
import { PublishedStrategyCard } from "@/components/PublishedStrategyCard";
import { usePlatformAuth } from "@/components/PlatformAuthProvider";
import { BOT_CATALOG } from "@/data/bots";
import { demoAuthPath } from "@/lib/demo-auth";
import { loadDiscoveryPreferences, saveDiscoveryPreferences } from "@/lib/preferences";
import type { PublicStrategyPublication } from "@/lib/strategy-publications";
import type { WeexHistoricalPerformance } from "@/lib/types";
import { isVerifiedWeexPerformance, loadWeexBotPerformance } from "@/lib/weex-historical-client";

type StrategyCategory = "favorites" | "mine";

const isPublicStrategyPublication = (entry: unknown): entry is PublicStrategyPublication => (
  Boolean(entry) && typeof entry === "object"
  && typeof (entry as { slug?: unknown }).slug === "string"
  && typeof (entry as { name?: unknown }).name === "string"
  && typeof (entry as { publisherName?: unknown }).publisherName === "string"
  && ["long", "short", "both"].includes(String((entry as { tradeDirection?: unknown }).tradeDirection))
  && typeof (entry as { hasPrivateSource?: unknown }).hasPrivateSource === "boolean"
  && Array.isArray((entry as { blocks?: unknown }).blocks)
  && Array.isArray((entry as { equityCurve?: unknown }).equityCurve)
);

export default function FavoritesPage() {
  const { mode: authMode, user } = usePlatformAuth();
  const [category, setCategory] = useState<StrategyCategory>("favorites");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  const [performanceState, setPerformanceState] = useState<"loading" | "ready" | "error">("loading");
  const [performances, setPerformances] = useState<Record<string, WeexHistoricalPerformance>>({});
  const [myStrategies, setMyStrategies] = useState<PublicStrategyPublication[]>([]);
  const [myStrategiesState, setMyStrategiesState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = loadDiscoveryPreferences();
      setFavorites(saved?.favorites.filter((id) => BOT_CATALOG.some((bot) => bot.id === id)) ?? []);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (authMode !== "production" || !user) {
      const resetTimer = window.setTimeout(() => {
        setMyStrategies([]);
        setMyStrategiesState("idle");
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }
    const controller = new AbortController();
    const loadTimer = window.setTimeout(() => {
      setMyStrategiesState("loading");
      void fetch("/api/strategy-publications/mine", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }).then(async (response) => {
        const body = await response.json() as { publications?: unknown };
        if (!response.ok || !Array.isArray(body.publications)) throw new Error("owned_publication_list_failed");
        setMyStrategies(body.publications.filter(isPublicStrategyPublication));
        setMyStrategiesState("ready");
      }).catch((error: unknown) => {
        if ((error as { name?: unknown })?.name !== "AbortError") setMyStrategiesState("error");
      });
    }, 0);
    return () => {
      window.clearTimeout(loadTimer);
      controller.abort();
    };
  }, [authMode, user]);

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
        <p>集中查看你收藏的策略，以及自己發布過的公開策略。</p>
      </header>

      <div aria-label="策略分類" className="favorites-page__categories" role="tablist">
        <button
          aria-controls="favorite-strategies-panel"
          aria-selected={category === "favorites"}
          id="favorite-strategies-tab"
          onClick={() => setCategory("favorites")}
          role="tab"
          type="button"
        >
          收藏策略 <strong>{favoriteBots.length}</strong>
        </button>
        <button
          aria-controls="my-strategies-panel"
          aria-selected={category === "mine"}
          id="my-strategies-tab"
          onClick={() => setCategory("mine")}
          role="tab"
          type="button"
        >
          我的策略 {myStrategiesState === "ready" && <strong>{myStrategies.length}</strong>}
        </button>
      </div>

      <section
        aria-labelledby="favorite-strategies-tab"
        hidden={category !== "favorites"}
        id="favorite-strategies-panel"
        role="tabpanel"
      >
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
      </section>

      <section
        aria-labelledby="my-strategies-tab"
        hidden={category !== "mine"}
        id="my-strategies-panel"
        role="tabpanel"
      >
        {!user ? (
          <section className="empty-state glass-panel">
            <p className="eyebrow">COMMUNITY RELEASES</p>
            <h2>登入後查看我的策略</h2>
            <p>登入後查看你發布過的公開策略。</p>
            <Link className="button button--primary" href={demoAuthPath("/favorites")}>登入查看我的策略</Link>
          </section>
        ) : authMode !== "production" ? (
          <section className="empty-state glass-panel">
            <p className="eyebrow">COMMUNITY RELEASES</p>
            <h2>尚未發布公開策略</h2>
            <p>展示帳號不會發布公開策略；請使用正式會員帳號完成發布。</p>
          </section>
        ) : myStrategiesState === "loading" ? (
          <p className="catalog-preference-status favorites-page__loading" role="status">正在載入我的公開策略…</p>
        ) : myStrategiesState === "error" ? (
          <p className="catalog-preference-status favorites-page__loading" role="alert">無法載入我的公開策略，請稍後重試。</p>
        ) : myStrategies.length > 0 ? (
          <>
            <div className="catalog-summary">
              <p aria-live="polite"><strong>{myStrategies.length}</strong> <span>已發布</span></p>
              <Link className="text-button" href="/workshop">組裝策略</Link>
            </div>
            <div className="published-strategies__grid">
              {myStrategies.map((publication) => (
                <PublishedStrategyCard key={publication.slug} publication={publication} />
              ))}
            </div>
          </>
        ) : (
          <section className="empty-state glass-panel" aria-live="polite">
            <p className="eyebrow">COMMUNITY RELEASES</p>
            <h2>尚未發布公開策略</h2>
            <p>完成歷史回測與訊號流程測試後，即可從組裝車間發布到公開列表。</p>
            <Link className="button button--primary" href="/workshop">前往組裝策略</Link>
          </section>
        )}
      </section>
    </div>
  );
}
