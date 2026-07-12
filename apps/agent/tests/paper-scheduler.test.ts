import { cloneVisualStrategyBlock, type VisualBotConfig } from "@cryptobot-labs/trading-core";
import { describe, expect, it, vi } from "vitest";
import type { DeploymentBundle } from "../src/main/deployment-client";
import { MarketStreamState } from "../src/main/market-stream";
import { PaperScheduler } from "../src/main/paper-scheduler";

const NOW = 7_200_000;
const config: VisualBotConfig = { id: "visual-1", name: "Grid", exchange: "WEEX", market: "spot", symbol: "BTCUSDT", timeframe: "1m",
  logicMode: "all", leverage: 1, blocks: ["grid", "stop-loss"].map(cloneVisualStrategyBlock) };
const bundle: DeploymentBundle = { schemaVersion: 1, deployment: { id: "dep-1", version: 1, strategyVersionId: "sv-1", mode: "paper", state: "stopped", configurationHash: "a".repeat(64) },
  strategy: { market: "spot", symbol: "BTCUSDT", configHash: "b".repeat(64), sourceHash: null, config, source: null },
  risk: { id: "risk-1", allowedSymbols: ["BTCUSDT"], maxOrderNotional: "100", maxPositionNotional: "500", maxTotalExposure: "1000",
    maxSimultaneousPositions: 2, maxDailyLoss: "50", maxLeverage: "1", maxSlippageBps: 30, minSignalCooldownMs: 0,
    maxConsecutiveFailures: 3, operationMode: "approval-required", updatedAt: 1 } };

describe("paper scheduler", () => {
  it("waits for activation, evaluates a completed candle once, and persists the cursor", async () => {
    const market = new MarketStreamState();
    const snapshot = { collectedAt: NOW, rules: { market: "spot" as const, symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
      tickSize: "0.1", stepSize: "0.001", minimumQuantity: "0.001" }, candles: [{ openTime: NOW - 60_000, closeTime: NOW - 1,
      open: "100", high: "101", low: "99", close: "100", volume: "10", complete: true }] };
    const collector = { collect: vi.fn(async () => { market.record({ market: "spot", symbol: "BTCUSDT", bid: "100", ask: "100", last: "100",
      exchangeTimestamp: NOW - 1, receivedAt: NOW }); return snapshot; }) };
    let cursor: number | null = null, sequence = 0; const account = { initialize: vi.fn(async () => undefined), mark: vi.fn(async () => undefined),
      snapshot: vi.fn(async () => ({ portfolio: { equity: "1000", dayStartEquity: "1000", availableEquity: "1000", utcDay: "1970-01-01" },
        risk: { lastSignalAt: null, openPositions: 0, positionSide: "flat" as const, currentPositionQuantity: "0", currentPositionNotional: "0",
          totalExposure: "0", realizedDailyPnl: "0", unrealizedDailyPnl: "0", consecutiveFailures: 0 } })),
      applyFill: vi.fn(async () => undefined), evaluationCursor: vi.fn(async () => ({ nextSignalSequence: sequence + 1, lastEvaluatedCloseTime: cursor })),
      completeEvaluation: vi.fn(async ({ closeTime }: { closeTime: number }) => { cursor = closeTime; sequence += 1; }) };
    const runner = { resume: vi.fn(async () => undefined), pause: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => ({ status: "discarded" as const, reason: "hold" as const })) };
    let scheduled: (() => void) | null = null;
    const scheduler = new PaperScheduler({ collector, market, account: () => account, runner, onFault: vi.fn(),
      schedule: (work) => { scheduled = work; return 1; }, cancel: vi.fn() });
    await scheduler.resume(bundle); expect(runner.evaluate).not.toHaveBeenCalled();
    await scheduler.activate(); expect(runner.evaluate).toHaveBeenCalledOnce(); expect(account.completeEvaluation).toHaveBeenCalledOnce();
    (scheduled as (() => void) | null)?.(); await vi.waitFor(() => expect(collector.collect).toHaveBeenCalledTimes(2));
    expect(runner.evaluate).toHaveBeenCalledOnce();
    await scheduler.pause(); expect(runner.pause).toHaveBeenCalledOnce();
  });
});
