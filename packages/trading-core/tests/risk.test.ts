import { describe, expect, it } from "vitest";

import type { InstrumentRules, OrderIntent, RiskContext, RiskPolicy } from "../src";
import { evaluateOrderRisk } from "../src";
import { context, instrument, intent, policy } from "./fixtures/risk";

function reason(
  overrides: {
    policy?: Partial<RiskPolicy>;
    context?: Partial<RiskContext>;
    intent?: Partial<OrderIntent>;
    instrument?: Partial<InstrumentRules>;
  } = {},
) {
  const decision = evaluateOrderRisk(
    { ...policy, ...overrides.policy },
    { ...context, ...overrides.context },
    { ...intent, ...overrides.intent },
    { ...instrument, ...overrides.instrument },
  );
  return decision.allowed ? "allowed" : decision.reason;
}

describe("evaluateOrderRisk", () => {
  it("returns invalid reasons instead of throwing for malformed runtime objects", () => {
    expect(
      evaluateOrderRisk(policy, null as unknown as RiskContext, intent, instrument),
    ).toEqual({ allowed: false, reason: "invalid-market" });
    expect(
      evaluateOrderRisk(policy, context, null as unknown as OrderIntent, instrument),
    ).toEqual({ allowed: false, reason: "invalid-intent-symbol" });
    expect(
      evaluateOrderRisk(policy, context, intent, null as unknown as InstrumentRules),
    ).toEqual({ allowed: false, reason: "invalid-instrument-rules" });
  });

  it("allows equality at maximum caps and minimum trading rules", () => {
    const decision = evaluateOrderRisk(
      {
        ...policy,
        maximumOrderNotional: "10",
        maximumPositionNotional: "10",
        maximumTotalExposure: "10",
        maximumLeverage: "2",
        maximumSlippageBps: "25",
      },
      {
        ...context,
        priceTimestamp: 5_000,
        currentPositionNotional: "0",
        totalExposure: "0",
      },
      { ...intent, quantity: "0.01" },
      instrument,
    );

    expect(decision).toEqual({
      allowed: true,
      normalized: {
        notional: "10",
        projectedPositionNotional: "10",
        projectedTotalExposure: "10",
        dailyPnl: "-15",
      },
    });
  });

  it("allows cooldown at the exact boundary", () => {
    expect(reason({ context: { lastSignalAt: 9_000 } })).toBe("allowed");
  });

  it("blocks daily loss at the limit and failures at the maximum", () => {
    expect(
      reason({ context: { realizedDailyPnl: "-30", unrealizedDailyPnl: "-20" } }),
    ).toBe("maximum-daily-loss-reached");
    expect(reason({ context: { consecutiveFailures: 3 } })).toBe(
      "maximum-consecutive-failures-reached",
    );
  });

  it.each([
    [{ policy: { allowedSymbols: [] } }, "invalid-policy-allowed-symbols"],
    [{ policy: { maximumOrderNotional: "0" } }, "invalid-policy-maximum-order-notional"],
    [{ policy: { maximumPositionNotional: "Infinity" } }, "invalid-policy-maximum-position-notional"],
    [{ policy: { maximumTotalExposure: "1e3" } }, "invalid-policy-maximum-total-exposure"],
    [{ policy: { maximumSimultaneousPositions: 0 } }, "invalid-policy-maximum-simultaneous-positions"],
    [{ policy: { maximumDailyLoss: "unlimited" } }, "invalid-policy-maximum-daily-loss"],
    [{ policy: { maximumLeverage: "NaN" } }, "invalid-policy-maximum-leverage"],
    [{ policy: { maximumSlippageBps: "" } }, "invalid-policy-maximum-slippage-bps"],
    [{ policy: { minimumSignalCooldownMs: -1 } }, "invalid-policy-minimum-signal-cooldown-ms"],
    [{ policy: { maximumConsecutiveFailures: 1.5 } }, "invalid-policy-maximum-consecutive-failures"],
    [{ policy: { maximumPriceAgeMs: Number.NaN } }, "invalid-policy-maximum-price-age-ms"],
  ] as const)("validates the complete policy first", (overrides, expected) => {
    expect(reason(overrides)).toBe(expected);
  });

  it.each([
    [{ intent: { quantity: "NaN" } }, "invalid-quantity"],
    [{ intent: { price: "1e3" } }, "invalid-price"],
    [{ intent: { expectedSlippageBps: "Infinity" } }, "invalid-expected-slippage-bps"],
    [{ context: { currentPositionNotional: "unlimited" } }, "invalid-current-position-notional"],
    [{ context: { totalExposure: "" } }, "invalid-total-exposure"],
    [{ context: { realizedDailyPnl: "1e2" } }, "invalid-realized-daily-pnl"],
    [{ context: { unrealizedDailyPnl: "NaN" } }, "invalid-unrealized-daily-pnl"],
    [{ context: { leverage: "0" } }, "invalid-leverage"],
  ] as const)("returns a stable invalid input reason", (overrides, expected) => {
    expect(reason(overrides)).toBe(expected);
  });

  it.each([
    [{ intent: { symbol: "ETHUSDT" } }, "symbol-mismatch"],
    [{ policy: { allowedSymbols: ["ETHUSDT"] } }, "symbol-not-allowed"],
    [{ context: { priceTimestamp: 10_001 } }, "price-timestamp-in-future"],
    [{ context: { priceTimestamp: 4_999 } }, "stale-price"],
    [{ intent: { quantity: "0.1005" } }, "quantity-step-mismatch"],
    [{ intent: { price: "1000.05" } }, "price-step-mismatch"],
    [{ intent: { quantity: "0.009" } }, "below-minimum-quantity"],
    [{ intent: { quantity: "0.01", price: "999.9" } }, "below-minimum-notional"],
    [{ intent: { quantity: "0.101" } }, "maximum-order-notional-exceeded"],
    [{ context: { currentPositionNotional: "101" } }, "maximum-position-notional-exceeded"],
    [{ context: { totalExposure: "401" } }, "maximum-total-exposure-exceeded"],
    [{ context: { openPositions: 3, opensNewPosition: true } }, "maximum-simultaneous-positions-reached"],
    [{ context: { leverage: "5.1" } }, "maximum-leverage-exceeded"],
    [{ policy: { maximumLeverage: "20" }, context: { leverage: "10.1" } }, "instrument-maximum-leverage-exceeded"],
    [{ intent: { expectedSlippageBps: "50.1" } }, "maximum-slippage-exceeded"],
    [{ context: { lastSignalAt: 9_001 } }, "signal-cooldown-active"],
  ] as const)("enforces %s", (overrides, expected) => {
    expect(reason(overrides)).toBe(expected);
  });
});
