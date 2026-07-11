import Decimal from "decimal.js";

import type { InstrumentRules } from "../datasets";
import type {
  OrderIntent,
  RiskContext,
  RiskDecision,
  RiskPolicy,
  RiskRejectionReason,
} from "./types";

const UNSIGNED_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function isPositiveDecimal(value: unknown): value is string {
  return typeof value === "string" && UNSIGNED_DECIMAL.test(value) && new Decimal(value).gt(0);
}

function isNonnegativeDecimal(value: unknown): value is string {
  return typeof value === "string" && UNSIGNED_DECIMAL.test(value);
}

function isSignedDecimal(value: unknown): value is string {
  return typeof value === "string" && SIGNED_DECIMAL.test(value);
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function validateRiskPolicy(policy: unknown): RiskRejectionReason | null {
  if (typeof policy !== "object" || policy === null) return "invalid-policy-allowed-symbols";
  const candidate = policy as Record<string, unknown>;
  if (
    !Array.isArray(candidate.allowedSymbols) ||
    candidate.allowedSymbols.length === 0 ||
    candidate.allowedSymbols.some((symbol) => typeof symbol !== "string" || symbol.length === 0) ||
    new Set(candidate.allowedSymbols).size !== candidate.allowedSymbols.length
  ) return "invalid-policy-allowed-symbols";
  if (!isPositiveDecimal(candidate.maximumOrderNotional)) return "invalid-policy-maximum-order-notional";
  if (!isPositiveDecimal(candidate.maximumPositionNotional)) return "invalid-policy-maximum-position-notional";
  if (!isPositiveDecimal(candidate.maximumTotalExposure)) return "invalid-policy-maximum-total-exposure";
  if (!isSafePositiveInteger(candidate.maximumSimultaneousPositions)) return "invalid-policy-maximum-simultaneous-positions";
  if (!isPositiveDecimal(candidate.maximumDailyLoss)) return "invalid-policy-maximum-daily-loss";
  if (!isPositiveDecimal(candidate.maximumLeverage)) return "invalid-policy-maximum-leverage";
  if (!isNonnegativeDecimal(candidate.maximumSlippageBps)) return "invalid-policy-maximum-slippage-bps";
  if (!isSafeNonnegativeInteger(candidate.minimumSignalCooldownMs)) return "invalid-policy-minimum-signal-cooldown-ms";
  if (!isSafePositiveInteger(candidate.maximumConsecutiveFailures)) return "invalid-policy-maximum-consecutive-failures";
  if (!isSafePositiveInteger(candidate.maximumPriceAgeMs)) return "invalid-policy-maximum-price-age-ms";
  return null;
}

function reject(reason: RiskRejectionReason): RiskDecision {
  return { allowed: false, reason };
}

function validInstrument(instrument: InstrumentRules): boolean {
  return (
    typeof instrument === "object" && instrument !== null &&
    (instrument.market === "spot" || instrument.market === "futures") &&
    typeof instrument.symbol === "string" && instrument.symbol.length > 0 &&
    typeof instrument.baseAsset === "string" && instrument.baseAsset.length > 0 &&
    typeof instrument.quoteAsset === "string" && instrument.quoteAsset.length > 0 &&
    isPositiveDecimal(instrument.tickSize) &&
    isPositiveDecimal(instrument.stepSize) &&
    isPositiveDecimal(instrument.minimumQuantity) &&
    (instrument.minimumNotional === undefined || isPositiveDecimal(instrument.minimumNotional)) &&
    (instrument.maximumLeverage === undefined || isPositiveDecimal(instrument.maximumLeverage))
  );
}

export function evaluateOrderRisk(
  policy: RiskPolicy,
  context: RiskContext,
  intent: OrderIntent,
  instrument: InstrumentRules,
): RiskDecision {
  const policyReason = validateRiskPolicy(policy);
  if (policyReason) return reject(policyReason);

  if (typeof context !== "object" || context === null) return reject("invalid-market");
  if (context.market !== "spot" && context.market !== "futures") return reject("invalid-market");
  if (typeof context.symbol !== "string" || context.symbol.length === 0) return reject("invalid-symbol");
  if (!policy.allowedSymbols.includes(context.symbol)) return reject("symbol-not-allowed");
  if (!isSafeNonnegativeInteger(context.now)) return reject("invalid-now");
  if (!isSafeNonnegativeInteger(context.priceTimestamp)) return reject("invalid-price-timestamp");
  if (context.priceTimestamp > context.now) return reject("price-timestamp-in-future");
  if (context.now - context.priceTimestamp > policy.maximumPriceAgeMs) return reject("stale-price");

  if (typeof intent !== "object" || intent === null || typeof intent.symbol !== "string" || intent.symbol.length === 0) {
    return reject("invalid-intent-symbol");
  }
  if (intent.symbol !== context.symbol) return reject("symbol-mismatch");
  if (intent.side !== "buy" && intent.side !== "sell") return reject("invalid-side");
  if (!validInstrument(instrument)) return reject("invalid-instrument-rules");
  if (instrument.market !== context.market || instrument.symbol !== context.symbol) return reject("instrument-mismatch");

  if (!isPositiveDecimal(intent.quantity)) return reject("invalid-quantity");
  const quantity = new Decimal(intent.quantity);
  if (!quantity.mod(instrument.stepSize).isZero()) return reject("quantity-step-mismatch");

  if (!isPositiveDecimal(intent.price)) return reject("invalid-price");
  const price = new Decimal(intent.price);
  if (!price.mod(instrument.tickSize).isZero()) return reject("price-step-mismatch");
  if (quantity.lt(instrument.minimumQuantity)) return reject("below-minimum-quantity");

  const notional = quantity.mul(price);
  if (instrument.minimumNotional !== undefined && notional.lt(instrument.minimumNotional)) {
    return reject("below-minimum-notional");
  }
  if (notional.gt(policy.maximumOrderNotional)) return reject("maximum-order-notional-exceeded");

  if (!isNonnegativeDecimal(context.currentPositionNotional)) return reject("invalid-current-position-notional");
  const projectedPositionNotional = new Decimal(context.currentPositionNotional).add(notional);
  if (projectedPositionNotional.gt(policy.maximumPositionNotional)) return reject("maximum-position-notional-exceeded");

  if (!isNonnegativeDecimal(context.totalExposure)) return reject("invalid-total-exposure");
  const projectedTotalExposure = new Decimal(context.totalExposure).add(notional);
  if (projectedTotalExposure.gt(policy.maximumTotalExposure)) return reject("maximum-total-exposure-exceeded");

  if (!isSafeNonnegativeInteger(context.openPositions)) return reject("invalid-open-positions");
  if (typeof context.opensNewPosition !== "boolean") return reject("invalid-opens-new-position");
  if (context.opensNewPosition && context.openPositions >= policy.maximumSimultaneousPositions) {
    return reject("maximum-simultaneous-positions-reached");
  }

  if (!isSignedDecimal(context.realizedDailyPnl)) return reject("invalid-realized-daily-pnl");
  if (!isSignedDecimal(context.unrealizedDailyPnl)) return reject("invalid-unrealized-daily-pnl");
  const dailyPnl = new Decimal(context.realizedDailyPnl).add(context.unrealizedDailyPnl);
  if (dailyPnl.lte(new Decimal(policy.maximumDailyLoss).neg())) return reject("maximum-daily-loss-reached");

  if (!isPositiveDecimal(context.leverage)) return reject("invalid-leverage");
  const leverage = new Decimal(context.leverage);
  if (leverage.gt(policy.maximumLeverage)) return reject("maximum-leverage-exceeded");
  if (instrument.maximumLeverage !== undefined && leverage.gt(instrument.maximumLeverage)) {
    return reject("instrument-maximum-leverage-exceeded");
  }

  if (!isNonnegativeDecimal(intent.expectedSlippageBps)) return reject("invalid-expected-slippage-bps");
  if (new Decimal(intent.expectedSlippageBps).gt(policy.maximumSlippageBps)) {
    return reject("maximum-slippage-exceeded");
  }

  if (context.lastSignalAt !== null) {
    if (!isSafeNonnegativeInteger(context.lastSignalAt) || context.lastSignalAt > context.now) {
      return reject("invalid-last-signal-at");
    }
    if (context.now - context.lastSignalAt < policy.minimumSignalCooldownMs) {
      return reject("signal-cooldown-active");
    }
  }

  if (!isSafeNonnegativeInteger(context.consecutiveFailures)) return reject("invalid-consecutive-failures");
  if (context.consecutiveFailures >= policy.maximumConsecutiveFailures) {
    return reject("maximum-consecutive-failures-reached");
  }

  return {
    allowed: true,
    normalized: {
      notional: notional.toFixed(),
      projectedPositionNotional: projectedPositionNotional.toFixed(),
      projectedTotalExposure: projectedTotalExposure.toFixed(),
      dailyPnl: dailyPnl.toFixed(),
    },
  };
}
