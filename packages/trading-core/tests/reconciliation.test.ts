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
    executionTarget: { market: "futures", mode: "live" },
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

  it("keeps cancel-pending unresolved when a lookup is missing", () => {
    const pending = transitionOrder(
      reconcileOrder({
        local: unknown(),
        snapshot: {
          clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
          side: "buy", quantity: "2", status: "NEW", cumulativeFilledQuantity: "0",
        }, at: 14,
      }).state,
      { type: "cancel-request", at: 15 },
    );
    expect(reconcileOrder({ local: pending, snapshot: null, at: 16 }))
      .toEqual({ state: pending, resolution: "unresolved" });
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
      executionTarget: { market: "futures", mode: "live" },
    }), { type: "submit-start", at: 11 });
    expect(nextReconciliationAction(local)).toBe("none");
  });

  it("preserves cancel-pending for transient NEW and PARTIALLY_FILLED snapshots", () => {
    const acknowledged = reconcileOrder({
      local: unknown(),
      snapshot: {
        clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
        side: "buy", quantity: "2", status: "NEW", cumulativeFilledQuantity: "0",
      }, at: 14,
    }).state;
    const pending = transitionOrder(acknowledged, { type: "cancel-request", at: 15 });
    const newReplay = reconcileOrder({
      local: pending,
      snapshot: {
        clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
        side: "buy", quantity: "2", status: "NEW", cumulativeFilledQuantity: "0",
      }, at: 16,
    }).state;
    expect(newReplay).toBe(pending);

    const partial = reconcileOrder({
      local: pending,
      snapshot: {
        clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
        side: "buy", quantity: "2", status: "PARTIALLY_FILLED",
        cumulativeFilledQuantity: "1", averageFillPrice: "101", fees: "0.1",
      }, at: 17,
    }).state;
    expect(partial).toMatchObject({
      status: "cancel-pending", cumulativeFilledQuantity: "1", averageFillPrice: "101", fees: "0.1",
    });
    expect(transitionOrder(partial, { type: "cancel-acknowledged", at: 18 }).status).toBe("cancelled");
  });

  it.each([
    ["NEW", "0", undefined],
    ["PARTIALLY_FILLED", "1", "101"],
    ["FILLED", "2", "101"],
    ["CANCELED", "1", "101"],
    ["REJECTED", "0", undefined],
  ] as const)("makes repeated identical %s snapshots idempotent across timestamps", (status, cumulative, average) => {
    const snapshot = {
      clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
      side: "buy" as const, quantity: "2", status,
      cumulativeFilledQuantity: cumulative,
      ...(average === undefined ? {} : { averageFillPrice: average, fees: "0.1" }),
    };
    const first = reconcileOrder({ local: unknown(), snapshot, at: 14 }).state;
    const second = reconcileOrder({ local: first, snapshot, at: 99 }).state;
    expect(second).toBe(first);
    expect(second.version).toBe(first.version);
    expect(second.updatedAt).toBe(first.updatedAt);
  });

  it("rejects terminal rewrites", () => {
    const filledSnapshot = {
      clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
      side: "buy" as const, quantity: "2", status: "FILLED" as const,
      cumulativeFilledQuantity: "2", averageFillPrice: "101", fees: "0.2",
    };
    const filled = reconcileOrder({ local: unknown(), snapshot: filledSnapshot, at: 14 }).state;
    expect(() => reconcileOrder({
      local: filled,
      snapshot: { ...filledSnapshot, status: "CANCELED", cumulativeFilledQuantity: "1" },
      at: 15,
    })).toThrow(/terminal|stale/i);
  });

  it.each(["NEW", "REJECTED"] as const)("rejects stale zero fills for %s after a partial fill", (status) => {
    const partial = reconcileOrder({
      local: unknown(),
      snapshot: {
        clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
        side: "buy", quantity: "2", status: "PARTIALLY_FILLED",
        cumulativeFilledQuantity: "1", averageFillPrice: "101", fees: "0.1",
      }, at: 14,
    }).state;
    expect(() => reconcileOrder({
      local: partial,
      snapshot: {
        clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
        side: "buy", quantity: "2", status, cumulativeFilledQuantity: "0",
      }, at: 15,
    })).toThrow(/stale/i);
  });

  it("treats a newly discovered exchange order id as one material transition", () => {
    const local = transitionOrder(
      transitionOrder(createTrackedOrder({
        deploymentId: "deployment", clientOrderId: "client-1", approvedIntent, at: 10,
        executionTarget: { market: "futures", mode: "live" },
      }), { type: "submit-start", at: 11 }),
      { type: "submit-timeout", at: 12 },
    );
    const snapshot = {
      clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
      side: "buy" as const, quantity: "2", status: "NEW" as const,
      cumulativeFilledQuantity: "0",
    };
    const next = reconcileOrder({ local, snapshot, at: 20 }).state;
    expect(next.exchangeOrderId).toBe("exchange-1");
    expect(next.version).toBe(local.version + 1);
    expect(next.updatedAt).toBe(20);
    expect(reconcileOrder({ local: next, snapshot, at: 21 }).state).toBe(next);
  });

  it.each([
    { cumulativeFilledQuantity: "1e2" },
    { cumulativeFilledQuantity: "0", averageFillPrice: "NaN" },
    { cumulativeFilledQuantity: "0", fees: "-1" },
  ])("validates every supplied decimal even for a cancelled snapshot %#", (decimalOverrides) => {
    expect(() => reconcileOrder({
      local: unknown(),
      snapshot: {
        clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
        side: "buy", quantity: "2", status: "CANCELED",
        ...decimalOverrides,
      }, at: 14,
    })).toThrow(/fill|price|fees|decimal/i);
  });

  it("requires fresh average price and fees when reconciliation advances a cumulative fill", () => {
    const base = {
      clientOrderId: "client-1", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
      side: "buy" as const, quantity: "2", status: "PARTIALLY_FILLED" as const,
      cumulativeFilledQuantity: "1",
    };
    expect(() => reconcileOrder({
      local: unknown(), snapshot: { ...base, averageFillPrice: "101" }, at: 14,
    })).toThrow(/fees/i);
    expect(() => reconcileOrder({
      local: unknown(), snapshot: { ...base, fees: "0.1" }, at: 14,
    })).toThrow(/average/i);
  });
});
