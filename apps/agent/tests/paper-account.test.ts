import { createTrackedOrder, transitionOrder } from "@cryptobot-labs/trading-core";
import { describe, expect, it } from "vitest";
import { DurablePaperAccount } from "../src/main/paper-account";
import type { AsyncSafeStorage, VaultFileStore } from "../src/main/vault";

const storage: AsyncSafeStorage = { isAsyncEncryptionAvailable: () => true,
  encryptStringAsync: async (value) => Uint8Array.from(Buffer.from(value), (byte) => byte ^ 0x5a),
  decryptStringAsync: async (value) => Buffer.from(Uint8Array.from(value, (byte) => byte ^ 0x5a)).toString("utf8") };
const disk = (): VaultFileStore & { bytes: Uint8Array | null; mode: number | null } => ({ bytes: null, mode: null,
  async read() { return this.bytes && Uint8Array.from(this.bytes); }, async writeAtomically(bytes, mode) { this.bytes = Uint8Array.from(bytes); this.mode = mode; },
  async erase() { this.bytes = null; } });
const filled = (id: string, side: "buy" | "sell", quantity: string, price: string, reduceOnly = false) => {
  let order = createTrackedOrder({ deploymentId: "dep-1", clientOrderId: id, executionTarget: { market: "spot", mode: "paper" },
    approvedIntent: { symbol: "BTCUSDT", side, quantity, price, expectedSlippageBps: "5", reduceOnly }, at: 100 });
  order = transitionOrder(order, { type: "submit-start", at: 100 }); order = transitionOrder(order, { type: "submit-acknowledged", exchangeOrderId: `paper-${id}`, at: 100 });
  return transitionOrder(order, { type: "fill-snapshot", cumulativeFilledQuantity: quantity, averageFillPrice: price, fees: "1", at: 100 });
};

describe("durable paper account", () => {
  it("persists fills, marks PnL, and ignores an identical fill replay", async () => {
    const file = disk(), account = new DurablePaperAccount(storage, file); await account.initialize({ deploymentId: "dep-1", market: "spot", symbol: "BTCUSDT", initialEquity: "1000", now: 0 });
    await account.applyFill(filled("order-1", "buy", "1", "100"), 100); await account.applyFill(filled("order-1", "buy", "1", "100"), 100);
    await account.mark("110", 200);
    await expect(account.snapshot("1")).resolves.toMatchObject({ portfolio: { equity: "1009", position: { side: "long", quantity: "1", entryPrice: "100" } },
      risk: { currentPositionNotional: "110", unrealizedDailyPnl: "10", realizedDailyPnl: "-1" } });
    expect(file.mode).toBe(0o600); expect(Buffer.from(file.bytes!).toString("utf8")).not.toContain("BTCUSDT");
    await expect(account.applyFill(filled("order-1", "buy", "1", "101"), 201)).rejects.toThrow(/replay conflict/i);
  });

  it("realizes reduce-only closes and restores the account after restart", async () => {
    const file = disk(), account = new DurablePaperAccount(storage, file); await account.initialize({ deploymentId: "dep-1", market: "spot", symbol: "BTCUSDT", initialEquity: "1000", now: 0 });
    await account.applyFill(filled("order-1", "buy", "1", "100"), 100); await account.applyFill(filled("order-2", "sell", "1", "120", true), 200);
    const restarted = new DurablePaperAccount(storage, file); await restarted.initialize({ deploymentId: "dep-1", market: "spot", symbol: "BTCUSDT", initialEquity: "1000", now: 300 });
    await expect(restarted.snapshot("1")).resolves.toMatchObject({ portfolio: { equity: "1018" }, risk: { positionSide: "flat", realizedDailyPnl: "18" } });
  });
});
