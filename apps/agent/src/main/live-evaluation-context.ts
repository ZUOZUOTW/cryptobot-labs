import { createVisualStrategyEvaluator, type ExecutionContext, type VisualBotConfig } from "@cryptobot-labs/trading-core";

import type { DeploymentBundle } from "./deployment-client";
import type { LiveAccountEvidence } from "./live-account-service";
import type { MarketQuote } from "./market-stream";
import type { PublicMarketSnapshot } from "./public-market-service";
import type { RunEvaluationRequest } from "./run-manager";

/** Binds public market data and credential-isolated account evidence into one private-exchange risk request. */
export function buildLiveEvaluationRequest(input: {
  readonly bundle: DeploymentBundle;
  readonly market: PublicMarketSnapshot;
  readonly quote: MarketQuote;
  readonly account: LiveAccountEvidence;
  readonly signalSequence: number;
}): RunEvaluationRequest {
  if (!Number.isSafeInteger(input.signalSequence) || input.signalSequence < 1) throw new TypeError("Invalid signal sequence");
  const risk = input.bundle.risk;
  const mode = input.bundle.deployment.mode;
  const supportedMode = mode === "live" || (mode === "futures-demo" && input.bundle.strategy.market === "futures");
  if (!supportedMode || risk === null || input.bundle.strategy.config === null) {
    throw new TypeError("Private evaluation requires a complete supported deployment");
  }
  const stored = input.bundle.strategy.config as VisualBotConfig & { source?: unknown };
  if ((input.bundle.strategy.source === null && stored.source !== undefined)
    || (input.bundle.strategy.source !== null && stored.source !== input.bundle.strategy.source)) {
    throw new TypeError("Live strategy source does not match its configuration");
  }
  const config = createVisualStrategyEvaluator({ ...stored, source: undefined }).config;
  const now = input.account.observedAt;
  const candles = Object.freeze(input.market.candles.map((candle) => Object.freeze({ ...candle })));
  const latest = candles.at(-1);
  const rules = Object.freeze({ ...input.market.rules });
  if (!latest || input.quote.market !== config.market || input.quote.symbol !== config.symbol
    || input.quote.last !== latest.close || input.quote.exchangeTimestamp !== latest.closeTime
    || input.quote.receivedAt > now || now - input.quote.receivedAt > 60_000
    || rules.market !== config.market || rules.symbol !== config.symbol
    || input.account.risk.market !== config.market || input.account.risk.symbol !== config.symbol
    || input.account.risk.now !== now || input.account.risk.priceTimestamp !== input.quote.exchangeTimestamp
    || input.account.risk.leverage !== String(config.leverage) || !risk.allowedSymbols.includes(config.symbol)) {
    throw new TypeError("Live evaluation evidence does not match the deployment");
  }
  const context: ExecutionContext = Object.freeze({ deploymentId: input.bundle.deployment.id,
    configurationVersion: `v${input.bundle.deployment.version}`, signalSequence: input.signalSequence,
    market: config.market, mode, referencePrice: input.quote.last, now, instrumentRules: rules,
    riskPolicy: Object.freeze({ allowedSymbols: Object.freeze([...risk.allowedSymbols]),
      maximumOrderNotional: risk.maxOrderNotional, maximumPositionNotional: risk.maxPositionNotional,
      maximumTotalExposure: risk.maxTotalExposure, maximumSimultaneousPositions: risk.maxSimultaneousPositions,
      maximumDailyLoss: risk.maxDailyLoss, maximumLeverage: risk.maxLeverage,
      maximumSlippageBps: String(risk.maxSlippageBps), minimumSignalCooldownMs: risk.minSignalCooldownMs,
      maximumConsecutiveFailures: risk.maxConsecutiveFailures, maximumPriceAgeMs: 60_000 }),
    riskContext: Object.freeze({ ...input.account.risk }) });
  return Object.freeze({ now, randomSeed: `${input.bundle.deployment.id}:v${input.bundle.deployment.version}:${latest.closeTime}:${input.signalSequence}`,
    context, input: Object.freeze({ candles, market: config.market, symbol: config.symbol, now,
      timeframe: config.timeframe, leverage: String(config.leverage), portfolio: input.account.portfolio }) });
}
