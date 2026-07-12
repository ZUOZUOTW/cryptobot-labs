import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { RiskPolicy } from "@cryptobot-labs/trading-core";
import { Dashboard, DEFAULT_DASHBOARD_MODE } from "../src/renderer/Dashboard";
import { canSubmitLiveUnlock, getLiveUnlockBlockers, LiveUnlock, type LiveUnlockSummary } from "../src/renderer/LiveUnlock";
import { DEFAULT_RISK_POLICY, isRiskPolicyComplete } from "../src/renderer/RiskSetup";

function summary(overrides: Partial<LiveUnlockSummary> = {}): LiveUnlockSummary {
  return {
    botName: "Orbit",
    market: "spot",
    symbol: "BTCUSDT",
    requestedLeverage: "1",
    apiKeySuffix: "1234",
    credentialVerified: true,
    permissions: { read: true, spot: true, futures: false, withdrawal: false },
    policy: DEFAULT_RISK_POLICY,
    ...overrides,
  };
}

describe("beginner-safe run controls", () => {
  it("defaults every dashboard to paper and never describes spot paper as WEEX demo", () => {
    const html = renderToStaticMarkup(createElement(Dashboard, {
      botName: "Orbit", market: "spot", liveUnlocked: false,
      onEmergencyStop: vi.fn(), onCancelOpenOrders: vi.fn(), onClosePositions: vi.fn(),
    }));

    expect(DEFAULT_DASHBOARD_MODE).toBe("paper");
    expect(html).toContain("CryptoBot Labs 模擬交易（預設）");
    expect(html).toContain("不是 WEEX Demo 或測試網");
    expect(html).not.toContain("WEEX 現貨 Demo");
  });

  it("keeps stop, cancel, and close as three separately explained actions", () => {
    const html = renderToStaticMarkup(createElement(Dashboard, {
      botName: "Orbit", market: "futures", liveUnlocked: true,
      onEmergencyStop: vi.fn(), onCancelOpenOrders: vi.fn(), onClosePositions: vi.fn(),
    }));

    expect(html).toContain("緊急停止新單");
    expect(html).toContain("確認後撤單");
    expect(html).toContain("輸入「平倉 Orbit」");
    expect(html).toContain("不撤銷掛單、不平倉");
    expect(html).toContain("現有持倉保持不變");
  });
});

describe("live unlock", () => {
  it("requires verified permissions, no withdrawal scope, and a complete bounded risk policy", () => {
    expect(getLiveUnlockBlockers(summary())).toEqual([]);
    expect(getLiveUnlockBlockers(summary({ credentialVerified: false }))).toContain("credential-not-verified");
    expect(getLiveUnlockBlockers(summary({ permissions: { read: true, spot: true, futures: false, withdrawal: "unknown" } })))
      .toContain("withdrawal-permission-unverified");

    const incomplete = { ...DEFAULT_RISK_POLICY, maximumDailyLoss: "" } satisfies RiskPolicy;
    expect(isRiskPolicyComplete(incomplete)).toBe(false);
    expect(getLiveUnlockBlockers(summary({ policy: incomplete }))).toContain("risk-policy-incomplete");
  });

  it("shows exact-name typed confirmation and keeps unlock disabled initially", () => {
    const html = renderToStaticMarkup(createElement(LiveUnlock, { summary: summary(), onUnlock: vi.fn() }));
    expect(html).toContain("輸入機器人名稱「Orbit」以確認");
    expect(html).toContain("重新驗證並解鎖實盤");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>重新驗證並解鎖實盤<\/button>/);
    expect(html).toContain("目前仍是 CryptoBot Labs 模擬交易");
    expect(canSubmitLiveUnlock(summary(), "Orbit", true)).toBe(true);
    expect(canSubmitLiveUnlock(summary(), "orbit", true)).toBe(false);
    expect(canSubmitLiveUnlock(summary(), "Orbit", false)).toBe(false);
  });

  it("fails closed with visible blockers before typed confirmation is available", () => {
    const html = renderToStaticMarkup(createElement(LiveUnlock, {
      summary: summary({ credentialVerified: false, permissions: { read: false, spot: false, futures: false, withdrawal: "unknown" } }),
      onUnlock: vi.fn(),
    }));
    expect(html).toContain("實盤維持鎖定");
    expect(html).toContain("尚未由本機代理驗證 WEEX API");
    expect(html).toContain("無法確認提幣權限已關閉");
  });
});
