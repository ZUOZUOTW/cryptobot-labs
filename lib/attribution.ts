"use client";

import { activePromoter, DEFAULT_PROMOTER_SLUG } from "../data/demo-platform";

export interface DemoAttribution { firstTouch: string; lastTouch: string; lockedPromoter: string | null; touchedAt: number }
const KEY = "cryptobot-labs:attribution:v1";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1_000;

export function captureAttribution(via: string | null): DemoAttribution {
  const approved = activePromoter(via)?.slug ?? DEFAULT_PROMOTER_SLUG;
  const now = Date.now();
  let previous: DemoAttribution | null = null;
  try { previous = JSON.parse(localStorage.getItem(KEY) ?? "null") as DemoAttribution | null; } catch { previous = null; }
  const validPrevious = previous && now - previous.touchedAt <= THIRTY_DAYS ? previous : null;
  const next: DemoAttribution = {
    firstTouch: validPrevious?.firstTouch ?? approved,
    lastTouch: approved,
    lockedPromoter: validPrevious?.lockedPromoter ?? null,
    touchedAt: now,
  };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Attribution must never block the product flow. */ }
  return next;
}

export function lockRegistrationAttribution(): DemoAttribution {
  const current = captureAttribution(null);
  const next = { ...current, lockedPromoter: current.lockedPromoter ?? current.lastTouch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Registration can continue without local attribution. */ }
  return next;
}

export function readAttribution(): DemoAttribution | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null") as DemoAttribution | null; } catch { return null; }
}
