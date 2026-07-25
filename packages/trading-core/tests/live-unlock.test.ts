import { describe, expect, it } from "vitest";

import type { LiveUnlockInput, RiskPolicy } from "../src";
import { evaluateLiveUnlock, MAX_INSTRUMENT_AGE_MS } from "../src";
import {
  parseFuturesInstrumentRules,
  parseSpotInstrumentRules,
} from "../../weex-client/src/schemas";
import { riskFixtures } from "./fixtures/risk";

const input: LiveUnlockInput = {
  targetMarket: "spot",
  now: 1_000_000,
  selectedSymbol: "BTCUSDT",
  requestedLeverage: "1",
  instrumentRules: riskFixtures.instrument,
  instrumentVerifiedAt: 999_000,
  credentialVerified: true,
  permissions: { read: true, spot: true, futures: false, unknownExtraScope: false },
  withdrawalPermission: "absent",
  policy: riskFixtures.policy,
  typedBotName: "Orbit",
  expectedBotName: "Orbit",
  acceptedRisk: true,
};

describe("evaluateLiveUnlock", () => {
  it.each([null, undefined, 0, "invalid", {}])(
    "returns invalid-input for malformed top-level input %s",
    (malformed) => {
      expect(evaluateLiveUnlock(malformed as unknown as LiveUnlockInput)).toEqual({
        allowed: false,
        reason: "invalid-input",
      });
    },
  );

  it("unlocks only when every local requirement is satisfied", () => {
    expect(evaluateLiveUnlock(input)).toEqual({ allowed: true });
    expect(
      evaluateLiveUnlock({
        ...input,
        targetMarket: "futures",
        instrumentRules: { ...input.instrumentRules, market: "futures", maximumLeverage: "10" },
        permissions: { ...input.permissions, spot: false, futures: true },
      }),
    ).toEqual({ allowed: true });
  });

  it("accepts the actual spot and futures shapes returned by the WEEX parsers", () => {
    const spot = parseSpotInstrumentRules({
      timezone: "UTC",
      serverTime: 1,
      rateLimits: [],
      symbols: [{
        symbol: "BTCUSDT",
        status: "TRADING",
        baseAsset: "BTC",
        baseAssetPrecision: 8,
        quoteAsset: "USDT",
        quoteAssetPrecision: 8,
        tickSize: "0.01",
        stepSize: "0.0001",
        minTradeAmount: "0.0001",
      }],
    }, "BTCUSDT");
    expect(evaluateLiveUnlock({ ...input, instrumentRules: spot })).toEqual({ allowed: true });

    const futures = parseFuturesInstrumentRules({
      assets: [],
      rateLimits: [],
      symbols: [{
        symbol: "CMT_BTCUSDT",
        displaySymbol: "BTCUSDT",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        marginAsset: "USDT",
        pricePrecision: 1,
        quantityPrecision: 3,
        baseAssetPrecision: 3,
        quotePrecision: 8,
        contractVal: 0.000001,
        delivery: [],
        forwardContractFlag: true,
        minLeverage: 1,
        maxLeverage: 125,
        minOrderSize: 0.001,
      }],
    }, "CMT_BTCUSDT");
    expect(evaluateLiveUnlock({
      ...input,
      targetMarket: "futures",
      selectedSymbol: "CMT_BTCUSDT",
      policy: { ...input.policy, allowedSymbols: ["CMT_BTCUSDT"] },
      permissions: { ...input.permissions, spot: false, futures: true },
      instrumentRules: futures,
    })).toEqual({ allowed: true });
  });

  it("uses a trusted product-metadata age and rejects caller attempts to override it", () => {
    expect(evaluateLiveUnlock({
      ...input,
      instrumentVerifiedAt: input.now - MAX_INSTRUMENT_AGE_MS,
    })).toEqual({ allowed: true });
    expect(evaluateLiveUnlock({
      ...input,
      instrumentVerifiedAt: input.now - MAX_INSTRUMENT_AGE_MS - 1,
    })).toEqual({ allowed: false, reason: "stale-instrument-rules" });
    expect(evaluateLiveUnlock({
      ...input,
      instrumentVerifiedAt: input.now - MAX_INSTRUMENT_AGE_MS - 1,
      maximumInstrumentAgeMs: Number.MAX_SAFE_INTEGER,
    })).toEqual({ allowed: false, reason: "unexpected-input-property" });
  });

  it.each([
    [{ selectedSymbol: "ETHUSDT" }, "selected-symbol-not-allowed"],
    [{ instrumentRules: { ...input.instrumentRules, market: "futures", maximumLeverage: "10" } }, "instrument-market-mismatch"],
    [{ instrumentRules: { ...input.instrumentRules, symbol: "ETHUSDT" } }, "instrument-symbol-mismatch"],
    [{ instrumentVerifiedAt: 1_000_001 }, "instrument-verified-at-in-future"],
    [{ instrumentVerifiedAt: 699_999 }, "stale-instrument-rules"],
    [{ requestedLeverage: "2" }, "spot-leverage-must-be-one"],
    [{
      targetMarket: "futures",
      requestedLeverage: "10.1",
      policy: { ...input.policy, maximumLeverage: "20" },
      permissions: { ...input.permissions, spot: false, futures: true },
      instrumentRules: { ...input.instrumentRules, market: "futures", maximumLeverage: "10" },
    }, "requested-leverage-exceeds-instrument"],
    [{ instrumentRules: null }, "invalid-instrument-rules"],
    [{ instrumentRules: { ...input.instrumentRules, stepSize: "" } }, "invalid-instrument-rules"],
    [{ permissions: { ...input.permissions, tradeAll: true } }, "unexpected-permission-property"],
  ] as const)("requires a fresh validated product order envelope: %s", (overrides, expected) => {
    expect(evaluateLiveUnlock({ ...input, ...overrides })).toEqual({ allowed: false, reason: expected });
  });

  it.each([
    [{ credentialVerified: false }, "credential-not-verified"],
    [{ permissions: { ...input.permissions, read: false } }, "missing-read-permission"],
    [{ permissions: { ...input.permissions, spot: false } }, "missing-spot-permission"],
    [{ targetMarket: "futures", permissions: { ...input.permissions, spot: false } }, "missing-futures-permission"],
    [{ permissions: { ...input.permissions, unknownExtraScope: true } }, "unknown-extra-scope"],
    [{ withdrawalPermission: "present" }, "withdrawal-permission-present"],
    [{ withdrawalPermission: "unknown" }, "withdrawal-permission-unknown"],
    [{ typedBotName: "" }, "missing-bot-name"],
    [{ typedBotName: " Orbit" }, "bot-name-mismatch"],
    [{ acceptedRisk: false }, "risk-not-accepted"],
  ] as const)("fails closed for %s", (overrides, expected) => {
    expect(evaluateLiveUnlock({ ...input, ...overrides })).toEqual({ allowed: false, reason: expected });
  });

  it("reports a missing mandatory limit before live trading", () => {
    const incomplete = { ...riskFixtures.policy, maximumOrderNotional: null } as unknown as RiskPolicy;
    expect(evaluateLiveUnlock({ ...input, policy: incomplete })).toEqual({
      allowed: false,
      reason: "missing-maximum-order-notional",
    });
  });

  it("fails closed when the entire policy is missing at runtime", () => {
    expect(
      evaluateLiveUnlock({ ...input, policy: undefined as unknown as RiskPolicy }),
    ).toEqual({ allowed: false, reason: "missing-allowed-symbols" });
  });

  it("rejects every missing policy field deterministically", () => {
    const fields = [
      "allowedSymbols",
      "maximumOrderNotional",
      "maximumPositionNotional",
      "maximumTotalExposure",
      "maximumSimultaneousPositions",
      "maximumDailyLoss",
      "maximumLeverage",
      "maximumSlippageBps",
      "minimumSignalCooldownMs",
      "maximumConsecutiveFailures",
      "maximumPriceAgeMs",
    ] as const;
    for (const field of fields) {
      const policy = { ...riskFixtures.policy } as Record<string, unknown>;
      delete policy[field];
      expect(evaluateLiveUnlock({ ...input, policy: policy as unknown as RiskPolicy })).toEqual({
        allowed: false,
        reason: `missing-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      });
    }
  });

  it("rejects an invalid complete policy", () => {
    expect(
      evaluateLiveUnlock({
        ...input,
        policy: { ...input.policy, maximumLeverage: "unlimited" },
      }),
    ).toEqual({ allowed: false, reason: "invalid-risk-policy" });
    expect(
      evaluateLiveUnlock({
        ...input,
        policy: { ...input.policy, allowedSymbols: ["UNLIMITED"] },
      }),
    ).toEqual({ allowed: false, reason: "invalid-risk-policy" });
  });
});
