import { describe, expect, it } from "vitest";

import { WeexExecutionAdapter } from "../src/execution-adapter";

describe("WeexExecutionAdapter", () => {
  it("delegates the exchange execution envelope without changing its target", async () => {
    const calls: unknown[] = [];
    const client = {
      async submitOrder(value: unknown) { calls.push(value); return { status: "rejected" as const, reason: "test" }; },
      async findOrderByClientOrderId() { return null; },
      async cancelOrder() { return { status: "cancelled" as const }; },
    };
    const adapter = new WeexExecutionAdapter(client);
    const request = {
      target: { market: "spot" as const, mode: "live" as const },
      clientOrderId: "cbl-1",
      intent: { symbol: "BTCUSDT", side: "buy" as const, quantity: "1", price: "1", expectedSlippageBps: "0", reduceOnly: false },
    };
    await expect(adapter.submit(request)).resolves.toEqual({ status: "rejected", reason: "test" });
    expect(calls).toEqual([request]);
  });
});
