import { createTrackedOrder, transitionOrder } from "@cryptobot-labs/trading-core";
import { describe, expect, it } from "vitest";

import { createDurableOrderRepository } from "../src/main/order-store";
import type { AsyncSafeStorage, VaultFileStore } from "../src/main/vault";

const storage = (): AsyncSafeStorage => ({ isAsyncEncryptionAvailable: () => true,
  encryptStringAsync: async (value) => Uint8Array.from(Buffer.from(value), (byte) => byte ^ 0xa5),
  decryptStringAsync: async (value) => Buffer.from(Uint8Array.from(value, (byte) => byte ^ 0xa5)).toString("utf8") });
const file = (): VaultFileStore & { bytes: Uint8Array | null; mode: number | null } => ({ bytes: null, mode: null,
  async read() { return this.bytes && Uint8Array.from(this.bytes); },
  async writeAtomically(bytes, mode) { this.bytes = Uint8Array.from(bytes); this.mode = mode; },
  async erase() { this.bytes = null; } });
const proposal = (id = "cbl-order-1", symbol = "BTCUSDT") => createTrackedOrder({ deploymentId: "dep-1", clientOrderId: id,
  executionTarget: { market: "spot", mode: "paper" }, approvedIntent: { symbol, side: "buy", quantity: "0.01",
    price: "60000", expectedSlippageBps: "5", reduceOnly: false }, at: 100 });

describe("durable order repository", () => {
  it("encrypts proposals and persists optimistic transitions", async () => {
    const disk = file(); const repository = createDurableOrderRepository(storage(), disk); const order = proposal();
    await expect(repository.claim(order)).resolves.toEqual({ claimed: true, order });
    expect(disk.mode).toBe(0o600); expect(Buffer.from(disk.bytes!).toString("utf8")).not.toContain("BTCUSDT");
    const submitting = transitionOrder(order, { type: "submit-start", at: 101 });
    await expect(repository.save(submitting, 0)).resolves.toEqual(submitting);
    await expect(repository.getByClientOrderId(order.clientOrderId)).resolves.toEqual(submitting);
  });

  it("atomically rejects duplicate IDs, active symbol conflicts, and stale writers", async () => {
    const repository = createDurableOrderRepository(storage(), file()); const first = proposal(); await repository.claim(first);
    await expect(repository.claim(first)).resolves.toMatchObject({ claimed: false, reason: "client-order-id-exists" });
    await expect(repository.claim(proposal("cbl-order-2"))).resolves.toEqual({ claimed: false, reason: "active-order-conflict" });
    const submitting = transitionOrder(first, { type: "submit-start", at: 101 }); await repository.save(submitting, 0);
    await expect(repository.save(transitionOrder(submitting, { type: "submit-timeout", at: 102 }), 0)).rejects.toThrow(/version conflict/i);
  });

  it("restores active orders after restart and fails closed on corrupt ciphertext", async () => {
    const disk = file(); const first = createDurableOrderRepository(storage(), disk); await first.claim(proposal());
    const restarted = createDurableOrderRepository(storage(), disk);
    await expect(restarted.listActive("dep-1", "BTCUSDT")).resolves.toHaveLength(1);
    disk.bytes = Uint8Array.from(Buffer.from("not encrypted json"));
    await expect(restarted.listActive("dep-1")).rejects.toThrow();
  });
});
