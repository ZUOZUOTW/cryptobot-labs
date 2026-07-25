import type {
  InstrumentRules,
  OrderIntent,
  RiskContext,
  RiskPolicy,
} from "../../src";

export const policy: RiskPolicy = {
  allowedSymbols: ["BTCUSDT"],
  maximumOrderNotional: "100",
  maximumPositionNotional: "200",
  maximumTotalExposure: "500",
  maximumSimultaneousPositions: 3,
  maximumDailyLoss: "50",
  maximumLeverage: "5",
  maximumSlippageBps: "50",
  minimumSignalCooldownMs: 1_000,
  maximumConsecutiveFailures: 3,
  maximumPriceAgeMs: 5_000,
};

export const context: RiskContext = {
  market: "spot",
  symbol: "BTCUSDT",
  now: 10_000,
  priceTimestamp: 9_000,
  lastSignalAt: null,
  openPositions: 1,
  positionSide: "long",
  currentPositionQuantity: "0.05",
  currentPositionNotional: "50",
  totalExposure: "100",
  realizedDailyPnl: "-10",
  unrealizedDailyPnl: "-5",
  consecutiveFailures: 0,
  leverage: "1",
};

export const intent: OrderIntent = {
  symbol: "BTCUSDT",
  side: "buy",
  quantity: "0.1",
  price: "1000",
  expectedSlippageBps: "25",
  reduceOnly: false,
};

export const instrument: InstrumentRules = {
  market: "spot",
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  tickSize: "0.1",
  stepSize: "0.001",
  minimumQuantity: "0.01",
};

export const riskFixtures = { policy, context, intent, instrument };
