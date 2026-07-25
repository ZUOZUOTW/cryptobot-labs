import {
  cloneVisualStrategyBlock,
  type ExecutionContext,
  type OrderRepository,
  type TrackedOrder,
  type VisualBotConfig,
} from "@cryptobot-labs/trading-core";
import { describe, expect, it, vi } from "vitest";

import type { DeploymentBundle } from "../src/main/deployment-client";
import { ClockFreshnessGuard, MarketStreamState } from "../src/main/market-stream";
import { PaperRunRunner } from "../src/main/paper-run-runner";
import { StrategyWorker, type StrategySandboxLike } from "../src/runtime/strategy-worker";

class MemoryRepository implements OrderRepository {
  readonly orders = new Map<string, TrackedOrder>();
  async getByClientOrderId(id: string) { return this.orders.get(id) ?? null; }
  async listActive(deploymentId: string, symbol?: string) { return [...this.orders.values()].filter((order) => order.deploymentId === deploymentId &&
    (!symbol || order.approvedIntent.symbol === symbol) && !["filled", "cancelled", "rejected", "risk-rejected"].includes(order.status)); }
  async claim(order: TrackedOrder) { const current = this.orders.get(order.clientOrderId); if (current) return { claimed: false as const, reason: "client-order-id-exists" as const, order: current };
    this.orders.set(order.clientOrderId, order); return { claimed: true as const, order }; }
  async save(order: TrackedOrder, expected: number | null) { if ((this.orders.get(order.clientOrderId)?.version ?? null) !== expected) throw new Error("conflict");
    this.orders.set(order.clientOrderId, order); return order; }
}

const NOW = 7_199_999;
const config: VisualBotConfig = { id: "visual-1", name: "Grid", exchange: "WEEX", market: "spot", symbol: "BTCUSDT", timeframe: "1h",
  logicMode: "all", leverage: 1, blocks: ["grid", "fixed-position", "stop-loss"].map(cloneVisualStrategyBlock) };
const bundle: DeploymentBundle = { schemaVersion: 1,
  deployment: { id: "dep-1", version: 1, strategyVersionId: "sv-1", mode: "paper", state: "stopped", configurationHash: "a".repeat(64) },
  strategy: { market: "spot", symbol: "BTCUSDT", configHash: "b".repeat(64), sourceHash: null, config, source: null },
  risk: { id: "risk-1", allowedSymbols: ["BTCUSDT"], maxOrderNotional: "100", maxPositionNotional: "500", maxTotalExposure: "1000",
    maxSimultaneousPositions: 2, maxDailyLoss: "50", maxLeverage: "1", maxSlippageBps: 30, minSignalCooldownMs: 0,
    maxConsecutiveFailures: 3, operationMode: "approval-required", updatedAt: 1 } };

describe("paper run runner", () => {
  it("starts RunManager, evaluates one filled order, and pauses cleanly", async () => {
    const market = new MarketStreamState(); market.record({ market: "spot", symbol: "BTCUSDT", bid: "97.9", ask: "98.1", last: "98",
      exchangeTimestamp: NOW, receivedAt: NOW });
    const clock = new ClockFreshnessGuard(); clock.record({ synchronizedAt: NOW, driftMs: 0 });
    const rules = { market: "spot" as const, symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", tickSize: "0.1", stepSize: "0.001",
      minimumQuantity: "0.001", minimumNotional: "5" };
    const runner = new PaperRunRunner({ repository: new MemoryRepository(), market, clock,
      instruments: { requireFresh: () => rules }, runtimeAudit: vi.fn(), runAudit: vi.fn(), now: () => NOW });
    await runner.resume(bundle); expect(runner.status).toBe("running");
    const context: ExecutionContext = { deploymentId: "dep-1", configurationVersion: "v1", signalSequence: 1, market: "spot", mode: "paper",
      referencePrice: "98", now: NOW, instrumentRules: rules,
      riskPolicy: { allowedSymbols: ["BTCUSDT"], maximumOrderNotional: "100", maximumPositionNotional: "500", maximumTotalExposure: "1000",
        maximumSimultaneousPositions: 2, maximumDailyLoss: "50", maximumLeverage: "1", maximumSlippageBps: "30",
        minimumSignalCooldownMs: 0, maximumConsecutiveFailures: 3, maximumPriceAgeMs: 60_000 },
      riskContext: { market: "spot", symbol: "BTCUSDT", now: NOW, priceTimestamp: NOW, lastSignalAt: null, openPositions: 0,
        positionSide: "flat", currentPositionQuantity: "0", currentPositionNotional: "0", totalExposure: "0", realizedDailyPnl: "0",
        unrealizedDailyPnl: "0", consecutiveFailures: 0, leverage: "1" } };
    const input = { market: "spot" as const, symbol: "BTCUSDT", timeframe: "1h", leverage: "1", now: NOW,
      candles: [{ openTime: 0, closeTime: 3_599_999, open: "100", high: "101", low: "99", close: "100", volume: "100", complete: true },
        { openTime: 3_600_000, closeTime: NOW, open: "98", high: "99", low: "97", close: "98", volume: "100", complete: true }] };
    await expect(runner.evaluate({ input, context, now: NOW, randomSeed: "seed" })).resolves.toMatchObject({ status: "proposed",
      outcome: { order: { status: "filled" } } });
    await runner.pause(); expect(runner.status).toBe("idle");
  });

  it("prepares a source-hash-fenced JavaScript deployment with a dedicated strategy worker",async()=>{
    const source="export default () => ({action:'hold',reason:'test'})";
    const custom={...bundle,strategy:{...bundle.strategy,source,sourceHash:"c".repeat(64),config:{...config,source}}};
    const sandbox={evaluate:vi.fn(),dispose:vi.fn(async()=>undefined)} satisfies StrategySandboxLike;
    const createStrategyWorker=vi.fn(()=>new StrategyWorker(async()=>sandbox,1_000));
    const runner=new PaperRunRunner({repository:new MemoryRepository(),market:{requireFresh:vi.fn()},clock:{requireFresh:vi.fn()},
      instruments:{requireFresh:vi.fn()},runtimeAudit:vi.fn(),runAudit:vi.fn(),createStrategyWorker,now:()=>NOW});
    await runner.resume(custom);
    expect(runner.status).toBe("running"); expect(createStrategyWorker).toHaveBeenCalledOnce();
    await runner.pause(); expect(runner.status).toBe("idle");
    expect(sandbox.dispose).not.toHaveBeenCalled();
  });
});
