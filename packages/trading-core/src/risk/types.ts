import type { Market } from "../contracts";
import type { InstrumentRules } from "../datasets";

export interface RiskPolicy {
  allowedSymbols: readonly string[];
  maximumOrderNotional: string;
  maximumPositionNotional: string;
  maximumTotalExposure: string;
  maximumSimultaneousPositions: number;
  maximumDailyLoss: string;
  maximumLeverage: string;
  maximumSlippageBps: string;
  minimumSignalCooldownMs: number;
  maximumConsecutiveFailures: number;
  maximumPriceAgeMs: number;
}

export interface RiskContext {
  market: Market;
  symbol: string;
  now: number;
  priceTimestamp: number;
  lastSignalAt: number | null;
  openPositions: number;
  positionSide: "flat" | "long" | "short";
  currentPositionQuantity: string;
  currentPositionNotional: string;
  totalExposure: string;
  realizedDailyPnl: string;
  unrealizedDailyPnl: string;
  consecutiveFailures: number;
  leverage: string;
}

export interface OrderIntent {
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  expectedSlippageBps: string;
  reduceOnly: boolean;
}

export type RiskRejectionReason =
  | "invalid-policy-allowed-symbols"
  | "invalid-policy-maximum-order-notional"
  | "invalid-policy-maximum-position-notional"
  | "invalid-policy-maximum-total-exposure"
  | "invalid-policy-maximum-simultaneous-positions"
  | "invalid-policy-maximum-daily-loss"
  | "invalid-policy-maximum-leverage"
  | "invalid-policy-maximum-slippage-bps"
  | "invalid-policy-minimum-signal-cooldown-ms"
  | "invalid-policy-maximum-consecutive-failures"
  | "invalid-policy-maximum-price-age-ms"
  | "invalid-market"
  | "invalid-symbol"
  | "symbol-not-allowed"
  | "invalid-now"
  | "invalid-price-timestamp"
  | "price-timestamp-in-future"
  | "stale-price"
  | "invalid-intent-symbol"
  | "symbol-mismatch"
  | "invalid-side"
  | "invalid-instrument-rules"
  | "instrument-mismatch"
  | "invalid-quantity"
  | "quantity-step-mismatch"
  | "invalid-price"
  | "price-step-mismatch"
  | "below-minimum-quantity"
  | "below-minimum-notional"
  | "maximum-order-notional-exceeded"
  | "invalid-current-position-notional"
  | "invalid-current-position-quantity"
  | "invalid-position-side"
  | "invalid-position-state"
  | "invalid-reduce-only"
  | "reduce-only-side-mismatch"
  | "reduce-only-exceeds-position"
  | "opposite-side-requires-reduce-only"
  | "spot-short-not-supported"
  | "maximum-position-notional-exceeded"
  | "invalid-total-exposure"
  | "maximum-total-exposure-exceeded"
  | "invalid-open-positions"
  | "maximum-simultaneous-positions-reached"
  | "invalid-realized-daily-pnl"
  | "invalid-unrealized-daily-pnl"
  | "maximum-daily-loss-reached"
  | "invalid-leverage"
  | "spot-leverage-must-be-one"
  | "maximum-leverage-exceeded"
  | "instrument-maximum-leverage-exceeded"
  | "invalid-expected-slippage-bps"
  | "maximum-slippage-exceeded"
  | "invalid-last-signal-at"
  | "signal-cooldown-active"
  | "invalid-consecutive-failures"
  | "maximum-consecutive-failures-reached";

export type RiskDecision =
  | {
      allowed: true;
      normalized: {
        notional: string;
        projectedPositionNotional: string;
        projectedTotalExposure: string;
        dailyPnl: string;
      };
    }
  | { allowed: false; reason: RiskRejectionReason };

export interface LiveUnlockInput {
  targetMarket: Market;
  now: number;
  selectedSymbol: string;
  requestedLeverage: string;
  instrumentRules: InstrumentRules;
  instrumentVerifiedAt: number;
  credentialVerified: boolean;
  permissions: {
    read: boolean;
    spot: boolean;
    futures: boolean;
    unknownExtraScope: boolean;
  };
  withdrawalPermission: "absent" | "present" | "unknown";
  policy: RiskPolicy;
  typedBotName: string;
  expectedBotName: string;
  acceptedRisk: boolean;
}

export type LiveUnlockRejectionReason =
  | "invalid-input"
  | "unexpected-input-property"
  | "invalid-target-market"
  | "invalid-now"
  | "credential-not-verified"
  | "missing-read-permission"
  | "invalid-permissions"
  | "unexpected-permission-property"
  | "missing-spot-permission"
  | "missing-futures-permission"
  | "unknown-extra-scope"
  | "withdrawal-permission-present"
  | "withdrawal-permission-unknown"
  | "missing-allowed-symbols"
  | "missing-maximum-order-notional"
  | "missing-maximum-position-notional"
  | "missing-maximum-total-exposure"
  | "missing-maximum-simultaneous-positions"
  | "missing-maximum-daily-loss"
  | "missing-maximum-leverage"
  | "missing-maximum-slippage-bps"
  | "missing-minimum-signal-cooldown-ms"
  | "missing-maximum-consecutive-failures"
  | "missing-maximum-price-age-ms"
  | "invalid-risk-policy"
  | "invalid-selected-symbol"
  | "selected-symbol-not-allowed"
  | "invalid-requested-leverage"
  | "invalid-instrument-rules"
  | "instrument-market-mismatch"
  | "instrument-symbol-mismatch"
  | "invalid-instrument-verified-at"
  | "instrument-verified-at-in-future"
  | "stale-instrument-rules"
  | "requested-leverage-exceeds-policy"
  | "requested-leverage-exceeds-instrument"
  | "spot-leverage-must-be-one"
  | "missing-bot-name"
  | "bot-name-mismatch"
  | "risk-not-accepted";

export type LiveUnlockResult =
  | { allowed: true }
  | { allowed: false; reason: LiveUnlockRejectionReason };

export type { InstrumentRules };
