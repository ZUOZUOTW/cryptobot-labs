"use client";

import { useSyncExternalStore } from "react";
import type { BacktestReport, BotConfig } from "./types";

export interface DemoSavedStrategy {
  id: string;
  config: BotConfig;
  report: BacktestReport | null;
  savedAt: number;
}

const KEY = "cryptobot-labs:demo-strategies:v1";
const EVENT = "cryptobot-labs:demo-strategies-change";
const EMPTY: DemoSavedStrategy[] = [];

export function readDemoStrategies(): DemoSavedStrategy[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value as DemoSavedStrategy[] : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function saveDemoStrategy(config: BotConfig, report: BacktestReport | null, id: string): void {
  const strategy: DemoSavedStrategy = { id, config, report, savedAt: Date.now() };
  const remaining = readDemoStrategies().filter((item) => item.id !== id);
  localStorage.setItem(KEY, JSON.stringify([strategy, ...remaining].slice(0, 20)));
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

let rawCache: string | null | undefined;
let strategyCache = EMPTY;
function snapshot(): DemoSavedStrategy[] {
  const raw = localStorage.getItem(KEY);
  if (raw === rawCache) return strategyCache;
  rawCache = raw;
  strategyCache = readDemoStrategies();
  return strategyCache;
}

export function useDemoStrategies(): DemoSavedStrategy[] {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}
