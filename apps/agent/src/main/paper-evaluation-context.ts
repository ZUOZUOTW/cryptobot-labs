import {
  createVisualStrategyEvaluator,
  type ExecutionContext,
  type RiskContext,
  type StrategyPortfolioSnapshot,
  type VisualBotConfig,
} from "@cryptobot-labs/trading-core";

import type { DeploymentBundle } from "./deployment-client";
import type { MarketQuote } from "./market-stream";
import type { PublicMarketSnapshot } from "./public-market-service";
import type { RunEvaluationRequest } from "./run-manager";

export interface PaperAccountSnapshot {
  readonly portfolio: Readonly<StrategyPortfolioSnapshot>;
  readonly risk: Readonly<Omit<RiskContext, "market" | "symbol" | "now" | "priceTimestamp" | "leverage">>;
}

function positiveSequence(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid signal sequence");
}

/** Binds all evidence used by one Paper evaluation into a single immutable request. */
export function buildPaperEvaluationRequest(input: {
  readonly bundle: DeploymentBundle;
  readonly market: PublicMarketSnapshot;
  readonly quote: MarketQuote;
  readonly account: PaperAccountSnapshot;
  readonly signalSequence: number;
}): RunEvaluationRequest {
  positiveSequence(input.signalSequence);
  const risk = input.bundle.risk;
  if (input.bundle.deployment.mode !== "paper" || risk === null ||
      input.bundle.strategy.config === null) throw new TypeError("Paper evaluation requires a complete paper deployment");
  const storedConfig = input.bundle.strategy.config as VisualBotConfig & { source?: unknown };
  if ((input.bundle.strategy.source === null && storedConfig.source !== undefined)
    || (input.bundle.strategy.source !== null && storedConfig.source !== input.bundle.strategy.source)) {
    throw new TypeError("Paper strategy source does not match its configuration");
  }
  const evaluator = createVisualStrategyEvaluator({ ...storedConfig, source: undefined });
  const config = evaluator.config;
  const now = input.market.collectedAt;
  const candles = Object.freeze(input.market.candles.map((candle) => Object.freeze({ ...candle })));
  const rules = Object.freeze({ ...input.market.rules });
  const latest = candles.at(-1);
  if (!latest || input.quote.market !== config.market || input.quote.symbol !== config.symbol ||
      input.quote.last !== latest.close || input.quote.exchangeTimestamp !== latest.closeTime ||
      input.quote.receivedAt !== now || rules.market !== config.market ||
      rules.symbol !== config.symbol || !risk.allowedSymbols.includes(config.symbol)) {
    throw new TypeError("Paper evaluation evidence does not match the deployment");
  }
  const leverage = String(config.leverage);
  const riskContext: RiskContext = Object.freeze({ ...input.account.risk, market: config.market,
    symbol: config.symbol, now, priceTimestamp: input.quote.exchangeTimestamp, leverage });
  const context: ExecutionContext = Object.freeze({ deploymentId: input.bundle.deployment.id,
    configurationVersion: `v${input.bundle.deployment.version}`, signalSequence: input.signalSequence,
    market: config.market, mode: "paper", referencePrice: input.quote.last,
    riskPolicy: Object.freeze({ allowedSymbols: Object.freeze([...risk.allowedSymbols]),
      maximumOrderNotional: risk.maxOrderNotional, maximumPositionNotional: risk.maxPositionNotional,
      maximumTotalExposure: risk.maxTotalExposure, maximumSimultaneousPositions: risk.maxSimultaneousPositions,
      maximumDailyLoss: risk.maxDailyLoss, maximumLeverage: risk.maxLeverage,
      maximumSlippageBps: String(risk.maxSlippageBps), minimumSignalCooldownMs: risk.minSignalCooldownMs,
      maximumConsecutiveFailures: risk.maxConsecutiveFailures, maximumPriceAgeMs: 60_000 }),
    riskContext, instrumentRules: rules, now });
  const portfolio = Object.freeze({ ...input.account.portfolio,
    ...(input.account.portfolio.position ? { position: Object.freeze({ ...input.account.portfolio.position }) } : {}) });
  return Object.freeze({ now, randomSeed: `${input.bundle.deployment.id}:v${input.bundle.deployment.version}:${latest.closeTime}:${input.signalSequence}`,
    context, input: Object.freeze({ candles, market: config.market, symbol: config.symbol,
      now, timeframe: config.timeframe, leverage, portfolio }) });
}
