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
  it("rejects market and symbol disagreements across default risk inputs", () => {
    expect(reason({ instrument: { market: "futures", maximumLeverage: "10" } }))
      .toBe("instrument-mismatch");
    expect(reason({ instrument: { symbol: "ETHUSDT" } }))
      .toBe("instrument-mismatch");
    expect(reason({ intent: { symbol: "ETHUSDT" } }))
      .toBe("symbol-mismatch");
  });

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
        currentPositionQuantity: "0",
        totalExposure: "0",
        positionSide: "flat",
      },
      { ...intent, quantity: "0.01" },
      { ...instrument, minimumNotional: "10" },
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
    ["spot", "long", "sell", "50", "0", "100"],
    ["futures", "long", "sell", "50", "0", "100"],
    ["futures", "short", "buy", "50", "0", "100"],
  ] as const)(
    "reduces and closes %s %s positions without adding exposure",
    (market, positionSide, side, partialPosition, closedPosition, totalAfterPartial) => {
      const marketInstrument = {
        ...instrument,
        market,
        ...(market === "futures" ? { maximumLeverage: "10" } : {}),
      };
      const baseContext = {
        ...context,
        market,
        positionSide,
        currentPositionQuantity: "0.1",
        currentPositionNotional: "100",
        totalExposure: "150",
      };
      expect(
        evaluateOrderRisk(
          policy,
          baseContext,
          { ...intent, side, quantity: "0.05", reduceOnly: true },
          marketInstrument,
        ),
      ).toMatchObject({
        allowed: true,
        normalized: {
          projectedPositionNotional: partialPosition,
          projectedTotalExposure: totalAfterPartial,
        },
      });
      expect(
        evaluateOrderRisk(
          policy,
          baseContext,
          { ...intent, side, quantity: "0.1", reduceOnly: true },
          marketInstrument,
        ),
      ).toMatchObject({
        allowed: true,
        normalized: { projectedPositionNotional: closedPosition, projectedTotalExposure: "50" },
      });
    },
  );

  it("infers increases, new positions, and rejects reversals or invalid reduce-only intents", () => {
    expect(reason()).toBe("allowed");
    expect(
      reason({
        context: { market: "futures", positionSide: "short", leverage: "2" },
        intent: { side: "sell" },
        instrument: { market: "futures", maximumLeverage: "10" },
      }),
    ).toBe("allowed");
    expect(
      reason({
        context: { positionSide: "long" },
        intent: { side: "sell", reduceOnly: false },
      }),
    ).toBe("opposite-side-requires-reduce-only");
    expect(reason({ intent: { reduceOnly: true } })).toBe("reduce-only-side-mismatch");
    expect(
      reason({
        context: { positionSide: "long", currentPositionQuantity: "0.05", currentPositionNotional: "50" },
        intent: { side: "sell", quantity: "0.1", reduceOnly: true },
      }),
    ).toBe("reduce-only-exceeds-position");
    expect(
      reason({
        context: { positionSide: "flat", currentPositionQuantity: "0", currentPositionNotional: "0" },
        intent: { side: "sell", reduceOnly: false },
      }),
    ).toBe("spot-short-not-supported");
  });

  it("allows a valid risk-reducing close despite entry cooldown and failure latches", () => {
    expect(reason({ context: { positionSide: "long", currentPositionQuantity: "0.1", currentPositionNotional: "100",
      totalExposure: "100", lastSignalAt: context.now, consecutiveFailures: policy.maximumConsecutiveFailures },
    intent: { side: "sell", quantity: "0.1", reduceOnly: true } })).toBe("allowed");
  });

  it("projects reductions from held quantity at lower and higher execution prices", () => {
    const held = {
      ...context,
      positionSide: "long" as const,
      currentPositionQuantity: "0.1",
      currentPositionNotional: "100",
      totalExposure: "150",
    };
    expect(
      evaluateOrderRisk(
        { ...policy, maximumOrderNotional: "200" },
        held,
        { ...intent, side: "sell", quantity: "0.05", price: "800", reduceOnly: true },
        instrument,
      ),
    ).toMatchObject({
      allowed: true,
      normalized: { projectedPositionNotional: "40", projectedTotalExposure: "90" },
    });
    expect(
      evaluateOrderRisk(
        { ...policy, maximumOrderNotional: "200" },
        held,
        { ...intent, side: "sell", quantity: "0.05", price: "1200", reduceOnly: true },
        instrument,
      ),
    ).toMatchObject({
      allowed: true,
      normalized: { projectedPositionNotional: "60", projectedTotalExposure: "110" },
    });
    expect(
      evaluateOrderRisk(
        { ...policy, maximumOrderNotional: "200" },
        held,
        { ...intent, side: "sell", quantity: "0.1", price: "1200", reduceOnly: true },
        instrument,
      ),
    ).toMatchObject({
      allowed: true,
      normalized: { projectedPositionNotional: "0", projectedTotalExposure: "50" },
    });
    expect(
      evaluateOrderRisk(
        { ...policy, maximumOrderNotional: "200" },
        held,
        { ...intent, side: "sell", quantity: "0.101", price: "800", reduceOnly: true },
        instrument,
      ),
    ).toEqual({ allowed: false, reason: "reduce-only-exceeds-position" });
  });

  it("enforces consistent position quantities and spot leverage exactly one", () => {
    expect(reason({ context: { currentPositionQuantity: "" } })).toBe(
      "invalid-current-position-quantity",
    );
    expect(
      reason({
        context: { positionSide: "flat", currentPositionQuantity: "0", currentPositionNotional: "1" },
      }),
    ).toBe("invalid-position-state");
    expect(reason({ context: { leverage: "2" } })).toBe("spot-leverage-must-be-one");
  });

  it.each([
    ["long", "sell", "buy"],
    ["short", "buy", "sell"],
  ] as const)(
    "allows a futures %s position above a newly lowered leverage cap to reduce only",
    (positionSide, reducingSide, increasingSide) => {
      const leveragedContext = {
        ...context,
        market: "futures" as const,
        positionSide,
        currentPositionQuantity: "0.1",
        currentPositionNotional: "100",
        totalExposure: "150",
        leverage: "10",
      };
      const futuresInstrument = { ...instrument, market: "futures" as const, maximumLeverage: "5" };

      expect(
        evaluateOrderRisk(
          { ...policy, maximumLeverage: "5" },
          leveragedContext,
          { ...intent, side: reducingSide, quantity: "0.05", reduceOnly: true },
          futuresInstrument,
        ),
      ).toMatchObject({ allowed: true });
      expect(
        evaluateOrderRisk(
          { ...policy, maximumLeverage: "5" },
          leveragedContext,
          { ...intent, side: increasingSide, quantity: "0.05", reduceOnly: false },
          { ...futuresInstrument, maximumLeverage: "20" },
        ),
      ).toEqual({ allowed: false, reason: "maximum-leverage-exceeded" });
      expect(
        evaluateOrderRisk(
          { ...policy, maximumLeverage: "20" },
          leveragedContext,
          { ...intent, side: increasingSide, quantity: "0.05", reduceOnly: false },
          futuresInstrument,
        ),
      ).toEqual({ allowed: false, reason: "instrument-maximum-leverage-exceeded" });
    },
  );

  it("rejects oversized decimals and detects a one-wei over-cap notional without rounding down", () => {
    const tooManyIntegers = "1".repeat(25);
    const tooManyFractions = `1.${"1".repeat(19)}`;
    expect(reason({ policy: { maximumOrderNotional: tooManyIntegers } })).toBe(
      "invalid-policy-maximum-order-notional",
    );
    expect(reason({ intent: { quantity: tooManyFractions } })).toBe("invalid-quantity");
    expect(reason({ instrument: { stepSize: tooManyFractions } })).toBe(
      "invalid-instrument-rules",
    );
    expect(reason({ instrument: { baseAsset: "B".repeat(65) } })).toBe(
      "invalid-instrument-rules",
    );
    expect(
      reason({
        policy: {
          allowedSymbols: Array.from(
            { length: 101 },
            (_, index) => `S${String(index).padStart(2, "0")}`,
          ),
        },
      }),
    ).toBe("invalid-policy-allowed-symbols");

    const cap = "10000000000000000000000";
    expect(
      reason({
        policy: {
          maximumOrderNotional: cap,
          maximumPositionNotional: cap,
          maximumTotalExposure: cap,
        },
        context: {
          positionSide: "flat",
          currentPositionQuantity: "0",
          currentPositionNotional: "0",
          totalExposure: "0",
        },
        intent: {
          quantity: "10000000000000000000000.000000000000000001",
          price: "1",
        },
        instrument: {
          stepSize: "0.000000000000000001",
          tickSize: "1",
          minimumQuantity: "1",
          minimumNotional: "1",
        },
      }),
    ).toBe("maximum-order-notional-exceeded");
  });

  it.each([
    [{ policy: { allowedSymbols: [] } }, "invalid-policy-allowed-symbols"],
    [{ policy: { allowedSymbols: [" BTCUSDT"] } }, "invalid-policy-allowed-symbols"],
    [{ policy: { allowedSymbols: ["BTCUSDT "] } }, "invalid-policy-allowed-symbols"],
    [{ policy: { allowedSymbols: ["btcusdt"] } }, "invalid-policy-allowed-symbols"],
    [{ policy: { allowedSymbols: ["*"] } }, "invalid-policy-allowed-symbols"],
    [{ policy: { allowedSymbols: ["UNLIMITED"] } }, "invalid-policy-allowed-symbols"],
    [{ policy: { allowedSymbols: ["ALL"] } }, "invalid-policy-allowed-symbols"],
    [{ policy: { allowedSymbols: ["BTCUSDT", "BTCUSDT"] } }, "invalid-policy-allowed-symbols"],
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
    [{ intent: { quantity: "0.01", price: "999.9" }, instrument: { minimumNotional: "10" } }, "below-minimum-notional"],
    [{ intent: { quantity: "0.101" } }, "maximum-order-notional-exceeded"],
    [{ context: { currentPositionQuantity: "0.101", currentPositionNotional: "101", totalExposure: "101" } }, "maximum-position-notional-exceeded"],
    [{ context: { totalExposure: "401" } }, "maximum-total-exposure-exceeded"],
    [{ context: { openPositions: 3, positionSide: "flat", currentPositionQuantity: "0", currentPositionNotional: "0" } }, "maximum-simultaneous-positions-reached"],
    [{ context: { market: "futures", leverage: "5.1" }, instrument: { market: "futures", maximumLeverage: "10" } }, "maximum-leverage-exceeded"],
    [{ policy: { maximumLeverage: "20" }, context: { market: "futures", leverage: "10.1" }, instrument: { market: "futures", maximumLeverage: "10" } }, "instrument-maximum-leverage-exceeded"],
    [{ intent: { expectedSlippageBps: "50.1" } }, "maximum-slippage-exceeded"],
    [{ context: { lastSignalAt: 9_001 } }, "signal-cooldown-active"],
  ] as const)("enforces %s", (overrides, expected) => {
    expect(reason(overrides)).toBe(expected);
  });
});
