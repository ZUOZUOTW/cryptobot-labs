"use client";

import { useSyncExternalStore } from "react";

export type DemoAuthProvider = "google" | "email";
export interface DemoUser { displayName: string; email: string; provider: DemoAuthProvider }

const STORAGE_KEY = "cryptobot-labs:demo-user:v1";
const CHANGE_EVENT = "cryptobot-labs:demo-auth-change";

export function safeReturnTo(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const url = new URL(value, "https://cryptobot.invalid");
    return url.origin === "https://cryptobot.invalid" ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch { return fallback; }
}

export function readDemoUser(): DemoUser | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const user = parsed as Record<string, unknown>;
    if (typeof user.displayName !== "string" || typeof user.email !== "string"
      || (user.provider !== "google" && user.provider !== "email")) return null;
    return { displayName: user.displayName, email: user.email, provider: user.provider };
  } catch { return null; }
}

export function signInDemo(user: DemoUser): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function signOutDemo(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(CHANGE_EVENT, callback); };
}

let cachedRaw: string | null | undefined;
let cachedUser: DemoUser | null = null;
function snapshot(): DemoUser | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedUser;
  cachedRaw = raw;
  cachedUser = readDemoUser();
  return cachedUser;
}

export function useDemoUser(): DemoUser | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

export function demoAuthPath(returnTo: string): string {
  return `/auth?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
}
