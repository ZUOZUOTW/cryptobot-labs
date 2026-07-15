"use client";

import { useSyncExternalStore } from "react";

export interface DemoRun {
  id: string; botId: string; botName: string; mode: "paper"; state: "running" | "paused" | "stopped";
  createdAt: number; evaluationCount: number; pnl: number; maxDailyLoss: number;
}
const KEY = "cryptobot-labs:demo-runs:v1";
const EVENT = "cryptobot-labs:demo-runs-change";
const EMPTY: DemoRun[] = [];

export function readDemoRuns(): DemoRun[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value as DemoRun[] : EMPTY;
  } catch { return EMPTY; }
}

export function createDemoPaperRun(input: { botId: string; botName: string }): DemoRun {
  const existing = readDemoRuns();
  const current = existing.find((run) => run.botId === input.botId && run.state !== "stopped");
  if (current) return current;
  const run: DemoRun = { id: `demo-${Date.now().toString(36)}`, ...input, mode: "paper", state: "running",
    createdAt: Date.now(), evaluationCount: 1, pnl: 0, maxDailyLoss: 50 };
  localStorage.setItem(KEY, JSON.stringify([run, ...existing].slice(0, 10)));
  window.dispatchEvent(new Event(EVENT));
  return run;
}

export function updateDemoRun(id: string, state: DemoRun["state"]): void {
  localStorage.setItem(KEY, JSON.stringify(readDemoRuns().map((run) => run.id === id ? { ...run, state } : run)));
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback); window.addEventListener(EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(EVENT, callback); };
}
let rawCache: string | null | undefined; let runsCache = EMPTY;
function snapshot(): DemoRun[] {
  const raw = localStorage.getItem(KEY);
  if (raw === rawCache) return runsCache;
  rawCache = raw; runsCache = readDemoRuns(); return runsCache;
}
export function useDemoRuns(): DemoRun[] { return useSyncExternalStore(subscribe, snapshot, () => EMPTY); }
