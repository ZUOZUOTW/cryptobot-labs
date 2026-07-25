"use client";

import { useSyncExternalStore } from "react";

export type DemoConnectionStatus = "disconnected" | "authorizing" | "verifying" | "paper-ready" | "expired";
export interface DemoConnection { status: DemoConnectionStatus; connectedAt: number | null; permissions: { read: boolean; trade: boolean; withdrawal: false } }
const KEY = "cryptobot-labs:demo-weex-connection:v1";
const EVENT = "cryptobot-labs:demo-connection-change";
const EMPTY: DemoConnection = { status: "disconnected", connectedAt: null, permissions: { read: false, trade: false, withdrawal: false } };

export function readDemoConnection(): DemoConnection {
  if (typeof window === "undefined") return EMPTY;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null") as DemoConnection | null;
    return parsed?.status ? parsed : EMPTY;
  } catch { return EMPTY; }
}

export function setDemoConnection(status: DemoConnectionStatus): void {
  const ready = status === "paper-ready";
  localStorage.setItem(KEY, JSON.stringify({ status, connectedAt: ready ? Date.now() : null,
    permissions: { read: ready, trade: ready, withdrawal: false } } satisfies DemoConnection));
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback); window.addEventListener(EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(EVENT, callback); };
}
let cachedRaw: string | null | undefined; let cached = EMPTY;
function snapshot(): DemoConnection {
  const raw = localStorage.getItem(KEY);
  if (raw === cachedRaw) return cached;
  cachedRaw = raw; cached = readDemoConnection(); return cached;
}
export function useDemoConnection(): DemoConnection { return useSyncExternalStore(subscribe, snapshot, () => EMPTY); }
