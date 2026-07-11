import { describe, expect, it } from "vitest";

import type { ApprovedOrderIntent } from "../src";
import {
  createTrackedOrder,
  nextReconciliationAction,
  reconcileOrder,
  transitionOrder,
} from "../src";

const approvedIntent: ApprovedOrderIntent = {
  symbol: "BTCUSDT", side: "buy", quantity: "2", price: "100",
  expectedSlippageBps: "5", reduceOnly: false,
};

function unknown() {
  const proposed = createTrackedOrder({
    deploymentId: "deployment", clientOrderId: "client-1", approvedIntent, at: 10,
  });
  return transitionOrder(
    transitionOrder(proposed, { type: "submit-start", at: 11 }),
    { type: "submit-timeout", at: 12 },
  );
}

describe("order reconciliation", () => {
  it("queries unknown orders and explicitly keeps a missing lookup unresolved", () => {
    const local = unknown();
    expect(nextReconciliationAction(local)).toBe("query-by-client-id");
    const result = reconcileOrder({ local, snapshot: null, at: 13 });
    expect(result).toEqual({ state: local, resolution: "unresolved" });
    expect(result.state.status).toBe("unknown");
  });

  it.each([
    ["NEW", "acknowledged", "0"],
    ["PARTIALLY_FILLED", "partially-filled", "1"],
    ["FILLED", "filled", "2"],
    ["CANCELED", "cancelled", "1"],
    ["REJECTED", "rejected", "0"],
  ] as const)("maps %s snapshots safely", (exchangeStatus, status, filledQuantity) => {
    const result = reconcileOrder({
      local: unknown(),
      snapshot: {
        clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
        side: "buy", quantity: "2", status: exchangeStatus,
        cumulativeFilledQuantity: filledQuantity,
        ...(filledQuantity === "0" ? {} : { averageFillPrice: "101", fees: "0.1" }),
      },
      at: 14,
    });
    expect(result.state.status).toBe(status);
    expect(result.resolution).toBe("resolved");
  });

  it("fails closed for mismatches and unknown exchange status", () => {
    const base = {
      clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
      side: "buy" as const, quantity: "2", status: "NEW" as const,
      cumulativeFilledQuantity: "0",
    };
    expect(() => reconcileOrder({ local: unknown(), snapshot: { ...base, symbol: "ETHUSDT" }, at: 14 })).toThrow(/mismatch/i);
    expect(() => reconcileOrder({
      local: unknown(), snapshot: { ...base, status: "MYSTERY" as "NEW" }, at: 14,
    })).toThrow(/status/i);
  });

  it("does not request reconciliation for a fresh submitting order without an explicit timeout", () => {
    const local = transitionOrder(createTrackedOrder({
      deploymentId: "deployment", clientOrderId: "client-1", approvedIntent, at: 10,
    }), { type: "submit-start", at: 11 });
    expect(nextReconciliationAction(local)).toBe("none");
  });
});
