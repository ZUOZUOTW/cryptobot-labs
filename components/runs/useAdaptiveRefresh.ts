"use client";

import { useEffect, useRef } from "react";

interface AdaptiveRefreshOptions {
  readonly enabled?: boolean;
  readonly refresh: (initial: boolean) => Promise<boolean>;
  readonly eventName?: string;
  readonly minimumDelayMs?: number;
  readonly maximumDelayMs?: number;
}

export function useAdaptiveRefresh({
  enabled = true,
  refresh,
  eventName,
  minimumDelayMs = 30_000,
  maximumDelayMs = 120_000,
}: AdaptiveRefreshOptions): void {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let running = false;
    let failures = 0;
    let lastCompletedAt = 0;
    let timer: number | undefined;

    const schedule = (delayMs?: number) => {
      if (stopped) return;
      if (timer !== undefined) window.clearTimeout(timer);
      const base = delayMs ?? Math.min(maximumDelayMs, minimumDelayMs * 2 ** failures);
      const jitter = Math.floor(Math.random() * Math.max(1_000, Math.min(10_000, base / 3)));
      timer = window.setTimeout(() => void run(false), base + jitter);
    };
    const run = async (initial: boolean) => {
      if (stopped || running) return;
      if (!initial && (document.visibilityState !== "visible" || !navigator.onLine)) {
        schedule(maximumDelayMs);
        return;
      }
      running = true;
      try {
        const successful = await refreshRef.current(initial);
        failures = successful ? 0 : Math.min(2, failures + 1);
      } catch {
        failures = Math.min(2, failures + 1);
      } finally {
        running = false;
        lastCompletedAt = Date.now();
        schedule();
      }
    };
    const refreshNow = () => {
      if (Date.now() - lastCompletedAt < 1_000) return;
      if (timer !== undefined) window.clearTimeout(timer);
      void run(false);
    };
    const visibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastCompletedAt >= minimumDelayMs / 2) {
        refreshNow();
      }
    };

    timer = window.setTimeout(() => void run(true), 0);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", refreshNow);
    if (eventName) window.addEventListener(eventName, refreshNow);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", refreshNow);
      if (eventName) window.removeEventListener(eventName, refreshNow);
    };
  }, [enabled, eventName, maximumDelayMs, minimumDelayMs]);
}
