import {
  cloneVisualStrategyBlock,
  type ExecutionContext,
  type OrderRepository,
  type TrackedOrder,
  type VisualBotConfig,
} from "@cryptobot-labs/trading-core";
import { describe, expect, it, vi } from "vitest";

import { createPaperRuntime } from "../src/main/paper-runtime";

class MemoryRepository implements OrderRepository {
  readonly orders = new Map<string, TrackedOrder>();
  async getByClientOrderId(id: string) { return this.orders.get(id) ?? null; }
  async listActive(deploymentId: string, symbol?: string) { return [...this.orders.values()].filter((order) =>
    order.deploymentId === deploymentId && (!symbol || order.approvedIntent.symbol === symbol) &&
    ["proposed", "submitting", "acknowledged", "partially-filled", "cancel-pending", "unknown", "reconciled"].includes(order.status)); }
  async claim(order: TrackedOrder) { const current = this.orders.get(order.clientOrderId);
    if (current) return { claimed: false as const, reason: "client-order-id-exists" as const, order };
    this.orders.set(order.clientOrderId, order); return { claimed: true as const, order }; }
  async save(order: TrackedOrder, expected: number | null) { if ((this.orders.get(order.clientOrderId)?.version ?? null) !== expected) throw new Error("conflict");
    this.orders.set(order.clientOrderId, order); return order; }
}

const config: VisualBotConfig = { id: "visual-1", name: "Grid", exchange: "WEEX", market: "spot", symbol: "BTCUSDT",
  timeframe: "1h", logicMode: "all", leverage: 1,
  blocks: ["grid", "fixed-position", "stop-loss"].map(cloneVisualStrategyBlock) };

describe("paper runtime composition", () => {
  it("routes a visual signal through risk, persistence, paper fill, and idempotency", async () => {
    const repository = new MemoryRepository(); const audit = vi.fn();
    const paper = createPaperRuntime({ config, repository, audit, fill: { slippageBps: "5", feeBps: "10", now: () => 7_199_999 } });
    paper.runtime.start({ deploymentId: "dep-1", configurationVersion: "v1", scriptHash: "a".repeat(64), source: "visual" });
    const context: ExecutionContext = { deploymentId: "dep-1", configurationVersion: "v1", signalSequence: 1,
      market: "spot", mode: "paper", referencePrice: "98", now: 7_199_999,
      instrumentRules: { market: "spot", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", tickSize: "0.1",
        stepSize: "0.001", minimumQuantity: "0.001", minimumNotional: "5" },
      riskPolicy: { allowedSymbols: ["BTCUSDT"], maximumOrderNotional: "100", maximumPositionNotional: "500",
        maximumTotalExposure: "1000", maximumSimultaneousPositions: 2, maximumDailyLoss: "50", maximumLeverage: "1",
        maximumSlippageBps: "30", minimumSignalCooldownMs: 0, maximumConsecutiveFailures: 3, maximumPriceAgeMs: 60_000 },
      riskContext: { market: "spot", symbol: "BTCUSDT", now: 7_199_999, priceTimestamp: 7_199_999, lastSignalAt: null,
        openPositions: 0, positionSide: "flat", currentPositionQuantity: "0", currentPositionNotional: "0", totalExposure: "0",
        realizedDailyPnl: "0", unrealizedDailyPnl: "0", consecutiveFailures: 0, leverage: "1" } };
    const input = { market: "spot" as const, symbol: "BTCUSDT", timeframe: "1h", leverage: "1", now: 7_199_999,
      candles: [{ openTime: 0, closeTime: 3_599_999, open: "100", high: "101", low: "99", close: "100", volume: "100", complete: true },
        { openTime: 3_600_000, closeTime: 7_199_999, open: "98", high: "99", low: "97", close: "98", volume: "100", complete: true }] };
    const request = { input, context, now: 7_199_999, randomSeed: "seed" };
    await expect(paper.runtime.evaluate(request)).resolves.toMatchObject({ status: "proposed", outcome: { status: "submitted", order: { status: "filled" } } });
    await expect(paper.runtime.evaluate(request)).resolves.toMatchObject({ status: "proposed", outcome: { status: "idempotent", order: { status: "filled" } } });
    expect(repository.orders).toHaveLength(1); expect(audit).toHaveBeenCalled();
  });
});
