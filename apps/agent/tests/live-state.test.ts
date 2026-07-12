import { createTrackedOrder, transitionOrder } from "@cryptobot-labs/trading-core";
import { describe, expect, it } from "vitest";

import { DurableLiveState } from "../src/main/live-state";
import type { AsyncSafeStorage, VaultFileStore } from "../src/main/vault";

const storage: AsyncSafeStorage = { isAsyncEncryptionAvailable: () => true,
  encryptStringAsync: async (value) => Uint8Array.from(Buffer.from(value), (byte) => byte ^ 0x6a),
  decryptStringAsync: async (value) => Buffer.from(Uint8Array.from(value, (byte) => byte ^ 0x6a)).toString("utf8") };
const disk = (): VaultFileStore & { bytes: Uint8Array | null; mode: number | null } => ({ bytes: null, mode: null,
  async read() { return this.bytes && Uint8Array.from(this.bytes); },
  async writeAtomically(bytes, mode) { this.bytes = Uint8Array.from(bytes); this.mode = mode; },
  async erase() { this.bytes = null; } });
const filled = (id: string, side: "buy" | "sell", quantity: string, price: string, reduceOnly = false) => {
  let order = createTrackedOrder({ deploymentId: "dep-1", clientOrderId: id, executionTarget: { market: "spot", mode: "live" },
    approvedIntent: { symbol: "BTCUSDT", side, quantity, price, expectedSlippageBps: "5", reduceOnly }, at: 100 });
  order = transitionOrder(order, { type: "submit-start", at: 100 });
  order = transitionOrder(order, { type: "submit-acknowledged", exchangeOrderId: `weex-${id}`, at: 100 });
  return transitionOrder(order, { type: "fill-snapshot", cumulativeFilledQuantity: quantity,
    averageFillPrice: price, fees: "1", at: 100 });
};

describe("durable live state", () => {
  it("encrypts ownership, fills, and the exactly-once candle cursor across restarts", async () => {
    const file = disk(); const state = new DurableLiveState(storage, file);
    await state.initialize({ deploymentId: "dep-1", market: "spot", symbol: "BTCUSDT", dayStartEquity: "1000", now: 0 });
    await state.applyFill(filled("order-1", "buy", "1", "100"), 100);
    await state.applyFill(filled("order-1", "buy", "1", "100"), 100);
    await state.mark("110", 200);
    await state.completeEvaluation({ closeTime: 199, at: 200, signaled: true, failed: false });
    expect(file.mode).toBe(0o600); expect(Buffer.from(file.bytes!).toString("utf8")).not.toContain("BTCUSDT");

    const restarted = new DurableLiveState(storage, file);
    await expect(restarted.snapshot()).resolves.toMatchObject({ position: { side: "long", quantity: "1", entryPrice: "100",
      peakPrice: "110" }, realizedDailyPnl: "-1", lastSignalAt: 200, nextSignalSequence: 2,
    lastEvaluatedCloseTime: 199 });
    await restarted.applyFill(filled("order-2", "sell", "1", "120", true), 300);
    await expect(restarted.snapshot()).resolves.toMatchObject({ realizedDailyPnl: "18", nextSignalSequence: 2 });
    expect((await restarted.snapshot())?.position).toBeUndefined();
  });
});
