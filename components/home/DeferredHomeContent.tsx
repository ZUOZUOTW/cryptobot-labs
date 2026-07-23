"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";

const StrategyAssemblyPlayer = lazy(() => import("./StrategyAssemblyPlayer").then((module) => ({
  default: module.StrategyAssemblyPlayer,
})));
const StrategyCodePlayer = lazy(() => import("./StrategyCodePlayer").then((module) => ({
  default: module.StrategyCodePlayer,
})));
const HomePerformanceSections = lazy(() => import("../HomePerformanceSections").then((module) => ({
  default: module.HomePerformanceSections,
})));

function useNearViewport({
  rootMargin,
  respectReducedMotion = false,
}: {
  rootMargin: string;
  respectReducedMotion?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (respectReducedMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [respectReducedMotion, rootMargin]);

  return { ref, shouldLoad };
}

function PlayerFallback() {
  return <span className="player-loading" aria-hidden="true" />;
}

export function DeferredStrategyAssemblyPlayer() {
  const { ref, shouldLoad } = useNearViewport({
    rootMargin: "240px 0px",
    respectReducedMotion: true,
  });
  return (
    <div
      aria-label="策略模組依序加入並完成組裝的動畫"
      className="strategy-assembly-player glass-panel"
      ref={ref}
      role="img"
    >
      {shouldLoad ? (
        <Suspense fallback={<PlayerFallback />}>
          <StrategyAssemblyPlayer embedded />
        </Suspense>
      ) : <PlayerFallback />}
    </div>
  );
}

export function DeferredStrategyCodePlayer() {
  const { ref, shouldLoad } = useNearViewport({
    rootMargin: "240px 0px",
    respectReducedMotion: true,
  });
  return (
    <div
      aria-label="交易策略代碼輸入、掃描並完成匯入驗證的動畫"
      className="strategy-code-player glass-panel"
      ref={ref}
      role="img"
    >
      {shouldLoad ? (
        <Suspense fallback={<PlayerFallback />}>
          <StrategyCodePlayer embedded />
        </Suspense>
      ) : <PlayerFallback />}
    </div>
  );
}

export function DeferredHomePerformanceSections() {
  const { ref, shouldLoad } = useNearViewport({ rootMargin: "320px 0px" });
  return (
    <div className="deferred-performance-slot" ref={ref}>
      {shouldLoad ? (
        <Suspense fallback={<PerformanceFallback />}>
          <HomePerformanceSections />
        </Suspense>
      ) : <PerformanceFallback />}
    </div>
  );
}

function PerformanceFallback() {
  return (
    <section className="landing-section site-container" aria-label="熱門機器人近期績效">
      <div className="leaderboard-data-state glass-panel" aria-live="polite" role="status">
        <p className="eyebrow">VERIFIED MARKET DATA</p>
        <h2>正在計算熱門策略</h2>
        <p>正在以公開歷史 K 線計算策略績效。</p>
      </div>
    </section>
  );
}
