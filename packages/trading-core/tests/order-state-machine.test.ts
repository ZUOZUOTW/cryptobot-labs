import { describe, expect, it } from "vitest";

import type { ApprovedOrderIntent, TrackedOrder } from "../src";
import { createTrackedOrder, transitionOrder } from "../src";

const intent: ApprovedOrderIntent = {
  symbol: "BTCUSDT",
  side: "buy",
  quantity: "2",
  price: "100",
  expectedSlippageBps: "10",
  reduceOnly: false,
};

function proposed(): TrackedOrder {
  return createTrackedOrder({
    deploymentId: "deploy-1",
    clientOrderId: "cb_order_1",
    approvedIntent: intent,
    at: 100,
  });
}

function acknowledged() {
  return transitionOrder(
    transitionOrder(proposed(), { type: "submit-start", at: 101 }),
    { type: "submit-acknowledged", exchangeOrderId: "ex-1", at: 102 },
  );
}

describe("order state machine", () => {
  it("covers accepted submission and full fill without mutating prior state", () => {
    const initial = proposed();
    const submitting = transitionOrder(initial, { type: "submit-start", at: 101 });
    const ack = transitionOrder(submitting, {
      type: "submit-acknowledged",
      exchangeOrderId: "ex-1",
      at: 102,
    });
    const filled = transitionOrder(ack, {
      type: "fill-snapshot",
      cumulativeFilledQuantity: "2",
      averageFillPrice: "101",
      fees: "0.2",
      at: 103,
    });
    expect(initial).toMatchObject({ status: "proposed", version: 0 });
    expect(submitting).toMatchObject({ status: "submitting", version: 1 });
    expect(ack).toMatchObject({ status: "acknowledged", version: 2 });
    expect(filled).toMatchObject({ status: "filled", cumulativeFilledQuantity: "2", version: 3 });
  });

  it("treats timeout as unknown and never as rejection", () => {
    const next = transitionOrder(
      transitionOrder(proposed(), { type: "submit-start", at: 101 }),
      { type: "submit-timeout", at: 102 },
    );
    expect(next.status).toBe("unknown");
    expect(() => transitionOrder(next, { type: "submit-start", at: 103 })).toThrow();
  });

  it("supports risk and exchange rejection paths", () => {
    expect(transitionOrder(proposed(), { type: "risk-rejected", reason: "cap", at: 101 }).status)
      .toBe("risk-rejected");
    const submitting = transitionOrder(proposed(), { type: "submit-start", at: 101 });
    expect(transitionOrder(submitting, { type: "submit-rejected", reason: "exchange", at: 102 }).status)
      .toBe("rejected");
  });

  it("makes identical snapshots idempotent and rejects stale or excessive fills", () => {
    const partial = transitionOrder(acknowledged(), {
      type: "fill-snapshot",
      cumulativeFilledQuantity: "1",
      averageFillPrice: "100",
      fees: "0.1",
      at: 103,
    });
    expect(transitionOrder(partial, {
      type: "fill-snapshot",
      cumulativeFilledQuantity: "1",
      averageFillPrice: "100",
      fees: "0.1",
      at: 103,
    })).toBe(partial);
    expect(() => transitionOrder(partial, {
      type: "fill-snapshot", cumulativeFilledQuantity: "0.9", at: 104,
    })).toThrow(/stale/i);
    expect(() => transitionOrder(partial, {
      type: "fill-snapshot", cumulativeFilledQuantity: "2.1", at: 104,
    })).toThrow(/exceed/i);
  });

  it("resolves a cancel/fill race in favor of a complete fill", () => {
    const partial = transitionOrder(acknowledged(), {
      type: "fill-snapshot", cumulativeFilledQuantity: "1", averageFillPrice: "100", at: 103,
    });
    const pending = transitionOrder(partial, { type: "cancel-request", at: 104 });
    const filled = transitionOrder(pending, {
      type: "fill-snapshot", cumulativeFilledQuantity: "2", averageFillPrice: "100", at: 105,
    });
    expect(filled.status).toBe("filled");
    expect(() => transitionOrder(filled, { type: "cancel-acknowledged", at: 106 })).toThrow();
  });

  it("makes terminal states immutable except identical duplicate events", () => {
    const rejected = transitionOrder(
      transitionOrder(proposed(), { type: "submit-start", at: 101 }),
      { type: "submit-rejected", reason: "no", at: 102 },
    );
    const duplicate = { type: "submit-rejected", reason: "no", at: 102 } as const;
    expect(transitionOrder(rejected, duplicate)).toBe(rejected);
    expect(() => transitionOrder(rejected, { ...duplicate, reason: "different", at: 103 })).toThrow();

    const filled = transitionOrder(acknowledged(), {
      type: "fill-snapshot", cumulativeFilledQuantity: "2", averageFillPrice: "100", at: 103,
    });
    expect(transitionOrder(filled, {
      type: "fill-snapshot", cumulativeFilledQuantity: "2", averageFillPrice: "100", at: 999,
    })).toBe(filled);
  });

  it("rejects illegal transitions, backward timestamps and invalid decimals", () => {
    expect(() => transitionOrder(proposed(), { type: "submit-acknowledged", exchangeOrderId: "x", at: 101 })).toThrow();
    expect(() => transitionOrder(proposed(), { type: "submit-start", at: 99 })).toThrow(/time/i);
    expect(() => createTrackedOrder({
      deploymentId: "d", clientOrderId: "c", approvedIntent: { ...intent, quantity: "1e3" }, at: 1,
    })).toThrow();
  });
});
