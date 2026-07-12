import { cloneVisualStrategyBlock, type VisualBotConfig } from "@cryptobot-labs/trading-core";
import { describe, expect, it } from "vitest";

import type { DeploymentBundle } from "../src/main/deployment-client";
import { buildPaperEvaluationRequest } from "../src/main/paper-evaluation-context";

const NOW = 7_200_000;
const config: VisualBotConfig = { id: "visual-1", name: "Grid", exchange: "WEEX", market: "spot", symbol: "BTCUSDT",
  timeframe: "1h", logicMode: "all", leverage: 1, blocks: ["grid", "stop-loss"].map(cloneVisualStrategyBlock) };
const bundle: DeploymentBundle = { schemaVersion: 1,
  deployment: { id: "dep-1", version: 2, strategyVersionId: "sv-1", mode: "paper", state: "stopped", configurationHash: "a".repeat(64) },
  strategy: { market: "spot", symbol: "BTCUSDT", configHash: "b".repeat(64), sourceHash: null, config, source: null },
  risk: { id: "risk-1", allowedSymbols: ["BTCUSDT"], maxOrderNotional: "100", maxPositionNotional: "500", maxTotalExposure: "1000",
    maxSimultaneousPositions: 2, maxDailyLoss: "50", maxLeverage: "1", maxSlippageBps: 30, minSignalCooldownMs: 1_000,
    maxConsecutiveFailures: 3, operationMode: "approval-required", updatedAt: 1 } };
const candles = [{ openTime: 0, closeTime: 3_599_999, open: "100", high: "101", low: "99", close: "100", volume: "10", complete: true },
  { openTime: 3_600_000, closeTime: NOW - 1, open: "98", high: "99", low: "97", close: "98", volume: "10", complete: true }];
const market = { candles, rules: { market: "spot" as const, symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", tickSize: "0.1",
  stepSize: "0.001", minimumQuantity: "0.001" }, collectedAt: NOW };
const quote = { market: "spot" as const, symbol: "BTCUSDT", bid: "98", ask: "98", last: "98", exchangeTimestamp: NOW - 1, receivedAt: NOW };
const account = { portfolio: { equity: "1000", dayStartEquity: "1000", availableEquity: "1000", utcDay: "1970-01-01" },
  risk: { lastSignalAt: null, openPositions: 0, positionSide: "flat" as const, currentPositionQuantity: "0", currentPositionNotional: "0",
    totalExposure: "0", realizedDailyPnl: "0", unrealizedDailyPnl: "0", consecutiveFailures: 0 } };

describe("paper evaluation context", () => {
  it("binds deployment, market, risk, and account evidence exactly", () => {
    const request = buildPaperEvaluationRequest({ bundle, market, quote, account, signalSequence: 7 });
    expect(request).toMatchObject({ now: NOW, randomSeed: `dep-1:v2:${NOW - 1}:7`, input: { market: "spot", symbol: "BTCUSDT",
      timeframe: "1h", leverage: "1", portfolio: { equity: "1000" } }, context: { deploymentId: "dep-1", configurationVersion: "v2",
      signalSequence: 7, referencePrice: "98", riskPolicy: { maximumOrderNotional: "100", maximumPriceAgeMs: 60_000 },
      riskContext: { positionSide: "flat", priceTimestamp: NOW - 1 } } });
    expect(Object.isFrozen(request.context)).toBe(true);
  });

  it("rejects mixed deployment, market, quote, and sequence evidence", () => {
    expect(() => buildPaperEvaluationRequest({ bundle, market, quote: { ...quote, symbol: "ETHUSDT" }, account, signalSequence: 1 })).toThrow(/match/i);
    expect(() => buildPaperEvaluationRequest({ bundle, market, quote, account, signalSequence: 0 })).toThrow(/sequence/i);
  });

  it("builds identical trusted evidence for a source-hash-fenced JavaScript deployment",()=>{
    const source="export default () => ({action:'hold',reason:'test'})";
    const custom={...bundle,strategy:{...bundle.strategy,source,sourceHash:"c".repeat(64),config:{...config,source}}};
    expect(buildPaperEvaluationRequest({bundle:custom,market,quote,account,signalSequence:1})).toMatchObject({
      context:{deploymentId:"dep-1",configurationVersion:"v2",mode:"paper"},
      input:{market:"spot",symbol:"BTCUSDT",timeframe:"1h"},
    });
    expect(()=>buildPaperEvaluationRequest({bundle:{...custom,strategy:{...custom.strategy,source:"different"}},market,quote,account,signalSequence:1}))
      .toThrow(/source/i);
  });
});
