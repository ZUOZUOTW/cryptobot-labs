import Decimal from "decimal.js";

import type { InstrumentRules } from "../datasets";
import type {
  OrderIntent,
  RiskContext,
  RiskDecision,
  RiskPolicy,
  RiskRejectionReason,
} from "./types";

const ExactDecimal = Decimal.clone({ precision: 96 });
const UNSIGNED_DECIMAL = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;
const NORMALIZED_SYMBOL = /^[A-Z0-9_]{3,32}$/;
const SYMBOL_SENTINELS = new Set(["ALL", "ANY", "UNLIMITED"]);

export function isNormalizedSymbol(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim().toUpperCase() &&
    NORMALIZED_SYMBOL.test(value) &&
    !SYMBOL_SENTINELS.has(value)
  );
}

export function isPositiveDecimalString(value: unknown): value is string {
  return typeof value === "string" && UNSIGNED_DECIMAL.test(value) && new ExactDecimal(value).gt(0);
}

function isNonnegativeDecimal(value: unknown): value is string {
  return typeof value === "string" && UNSIGNED_DECIMAL.test(value);
}

function isSignedDecimal(value: unknown): value is string {
  return typeof value === "string" && SIGNED_DECIMAL.test(value);
}

export function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isSafePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function validateRiskPolicy(policy: unknown): RiskRejectionReason | null {
  if (typeof policy !== "object" || policy === null) return "invalid-policy-allowed-symbols";
  const candidate = policy as Record<string, unknown>;
  if (
    !Array.isArray(candidate.allowedSymbols) ||
    candidate.allowedSymbols.length === 0 ||
    candidate.allowedSymbols.length > 100
  ) return "invalid-policy-allowed-symbols";
  const normalizedSymbols = candidate.allowedSymbols
    ? candidate.allowedSymbols.map((symbol) =>
        typeof symbol === "string" ? symbol.trim().toUpperCase() : "",
      )
    : [];
  if (
    candidate.allowedSymbols.some(
      (symbol, index) =>
        !isNormalizedSymbol(symbol) || symbol !== normalizedSymbols[index],
    ) ||
    new Set(normalizedSymbols).size !== normalizedSymbols.length
  ) return "invalid-policy-allowed-symbols";
  if (!isPositiveDecimalString(candidate.maximumOrderNotional)) return "invalid-policy-maximum-order-notional";
  if (!isPositiveDecimalString(candidate.maximumPositionNotional)) return "invalid-policy-maximum-position-notional";
  if (!isPositiveDecimalString(candidate.maximumTotalExposure)) return "invalid-policy-maximum-total-exposure";
  if (!isSafePositiveInteger(candidate.maximumSimultaneousPositions)) return "invalid-policy-maximum-simultaneous-positions";
  if (!isPositiveDecimalString(candidate.maximumDailyLoss)) return "invalid-policy-maximum-daily-loss";
  if (!isPositiveDecimalString(candidate.maximumLeverage)) return "invalid-policy-maximum-leverage";
  if (!isNonnegativeDecimal(candidate.maximumSlippageBps)) return "invalid-policy-maximum-slippage-bps";
  if (!isSafeNonnegativeInteger(candidate.minimumSignalCooldownMs)) return "invalid-policy-minimum-signal-cooldown-ms";
  if (!isSafePositiveInteger(candidate.maximumConsecutiveFailures)) return "invalid-policy-maximum-consecutive-failures";
  if (!isSafePositiveInteger(candidate.maximumPriceAgeMs)) return "invalid-policy-maximum-price-age-ms";
  return null;
}

function reject(reason: RiskRejectionReason): RiskDecision {
  return { allowed: false, reason };
}

export function isValidInstrumentRules(
  instrument: unknown,
): instrument is InstrumentRules {
  return (
    typeof instrument === "object" && instrument !== null &&
    !Array.isArray(instrument) &&
    (() => {
      const candidate = instrument as InstrumentRules;
      return (
        (candidate.market === "spot" || candidate.market === "futures") &&
        typeof candidate.symbol === "string" && candidate.symbol.length > 0 && candidate.symbol.length <= 64 &&
        typeof candidate.baseAsset === "string" && candidate.baseAsset.length > 0 && candidate.baseAsset.length <= 64 &&
        typeof candidate.quoteAsset === "string" && candidate.quoteAsset.length > 0 && candidate.quoteAsset.length <= 64 &&
        isPositiveDecimalString(candidate.tickSize) &&
        isPositiveDecimalString(candidate.stepSize) &&
        isPositiveDecimalString(candidate.minimumQuantity) &&
        (candidate.minimumNotional === undefined || isPositiveDecimalString(candidate.minimumNotional)) &&
        (candidate.market === "futures"
          ? isPositiveDecimalString(candidate.maximumLeverage)
          : candidate.maximumLeverage === undefined || isPositiveDecimalString(candidate.maximumLeverage))
      );
    })()
  );
}

export function compareDecimalStrings(left: string, right: string): number {
  return new ExactDecimal(left).comparedTo(new ExactDecimal(right));
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
  if (!isValidInstrumentRules(instrument)) return reject("invalid-instrument-rules");
  if (instrument.market !== context.market || instrument.symbol !== context.symbol) return reject("instrument-mismatch");

  if (!isPositiveDecimalString(intent.quantity)) return reject("invalid-quantity");
  const quantity = new ExactDecimal(intent.quantity);
  if (!quantity.mod(instrument.stepSize).isZero()) return reject("quantity-step-mismatch");

  if (!isPositiveDecimalString(intent.price)) return reject("invalid-price");
  const price = new ExactDecimal(intent.price);
  if (!price.mod(instrument.tickSize).isZero()) return reject("price-step-mismatch");
  if (quantity.lt(instrument.minimumQuantity)) return reject("below-minimum-quantity");

  const notional = quantity.mul(price);
  if (instrument.minimumNotional !== undefined && notional.lt(instrument.minimumNotional)) {
    return reject("below-minimum-notional");
  }
  if (notional.gt(policy.maximumOrderNotional)) return reject("maximum-order-notional-exceeded");

  if (!isNonnegativeDecimal(context.currentPositionQuantity)) {
    return reject("invalid-current-position-quantity");
  }
  if (!isNonnegativeDecimal(context.currentPositionNotional)) return reject("invalid-current-position-notional");
  if (context.positionSide !== "flat" && context.positionSide !== "long" && context.positionSide !== "short") {
    return reject("invalid-position-side");
  }
  if (typeof intent.reduceOnly !== "boolean") return reject("invalid-reduce-only");
  const currentPositionQuantity = new ExactDecimal(context.currentPositionQuantity);
  const currentPositionNotional = new ExactDecimal(context.currentPositionNotional);
  if (
    (context.positionSide === "flat" && (!currentPositionQuantity.isZero() || !currentPositionNotional.isZero())) ||
    (context.positionSide !== "flat" && (!currentPositionQuantity.gt(0) || !currentPositionNotional.gt(0))) ||
    (context.market === "spot" && context.positionSide === "short")
  ) return reject("invalid-position-state");

  let increasesRisk: boolean;
  let opensNewPosition = false;
  let projectedPositionQuantity: Decimal;
  let projectedPositionNotional: Decimal;
  if (context.positionSide === "flat") {
    if (intent.reduceOnly) return reject("reduce-only-side-mismatch");
    if (context.market === "spot" && intent.side === "sell") return reject("spot-short-not-supported");
    increasesRisk = true;
    opensNewPosition = true;
    projectedPositionQuantity = quantity;
    projectedPositionNotional = projectedPositionQuantity.mul(price);
  } else {
    const increasingSide = context.positionSide === "long" ? "buy" : "sell";
    if (intent.side === increasingSide) {
      if (intent.reduceOnly) return reject("reduce-only-side-mismatch");
      increasesRisk = true;
      projectedPositionQuantity = currentPositionQuantity.add(quantity);
      projectedPositionNotional = projectedPositionQuantity.mul(price);
    } else {
      if (!intent.reduceOnly) return reject("opposite-side-requires-reduce-only");
      if (quantity.gt(currentPositionQuantity)) return reject("reduce-only-exceeds-position");
      increasesRisk = false;
      projectedPositionQuantity = currentPositionQuantity.sub(quantity);
      projectedPositionNotional = projectedPositionQuantity.mul(price);
    }
  }
  if (increasesRisk && projectedPositionNotional.gt(policy.maximumPositionNotional)) {
    return reject("maximum-position-notional-exceeded");
  }

  if (!isNonnegativeDecimal(context.totalExposure)) return reject("invalid-total-exposure");
  const totalExposure = new ExactDecimal(context.totalExposure);
  if (totalExposure.lt(currentPositionNotional)) return reject("invalid-total-exposure");
  const projectedTotalExposure = totalExposure.sub(currentPositionNotional).add(projectedPositionNotional);
  if (increasesRisk && projectedTotalExposure.gt(policy.maximumTotalExposure)) {
    return reject("maximum-total-exposure-exceeded");
  }

  if (!isSafeNonnegativeInteger(context.openPositions)) return reject("invalid-open-positions");
  if (opensNewPosition && context.openPositions >= policy.maximumSimultaneousPositions) {
    return reject("maximum-simultaneous-positions-reached");
  }

  if (!isSignedDecimal(context.realizedDailyPnl)) return reject("invalid-realized-daily-pnl");
  if (!isSignedDecimal(context.unrealizedDailyPnl)) return reject("invalid-unrealized-daily-pnl");
  const dailyPnl = new ExactDecimal(context.realizedDailyPnl).add(context.unrealizedDailyPnl);
  if (increasesRisk && dailyPnl.lte(new ExactDecimal(policy.maximumDailyLoss).neg())) {
    return reject("maximum-daily-loss-reached");
  }

  if (!isPositiveDecimalString(context.leverage)) return reject("invalid-leverage");
  const leverage = new ExactDecimal(context.leverage);
  if (context.market === "spot" && !leverage.eq(1)) return reject("spot-leverage-must-be-one");
  if (increasesRisk && leverage.gt(policy.maximumLeverage)) return reject("maximum-leverage-exceeded");
  if (
    increasesRisk &&
    instrument.maximumLeverage !== undefined &&
    leverage.gt(instrument.maximumLeverage)
  ) {
    return reject("instrument-maximum-leverage-exceeded");
  }

  if (!isNonnegativeDecimal(intent.expectedSlippageBps)) return reject("invalid-expected-slippage-bps");
  if (new ExactDecimal(intent.expectedSlippageBps).gt(policy.maximumSlippageBps)) {
    return reject("maximum-slippage-exceeded");
  }

  if (context.lastSignalAt !== null) {
    if (!isSafeNonnegativeInteger(context.lastSignalAt) || context.lastSignalAt > context.now) {
      return reject("invalid-last-signal-at");
    }
    if (increasesRisk && context.now - context.lastSignalAt < policy.minimumSignalCooldownMs) {
      return reject("signal-cooldown-active");
    }
  }

  if (!isSafeNonnegativeInteger(context.consecutiveFailures)) return reject("invalid-consecutive-failures");
  if (increasesRisk && context.consecutiveFailures >= policy.maximumConsecutiveFailures) {
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
