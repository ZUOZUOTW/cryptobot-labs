import Decimal from "decimal.js";

import { transitionOrder } from "./state-machine";
import type { ExchangeOrderSnapshot, TrackedOrder } from "./types";

export type ReconciliationAction = "query-by-client-id" | "none";

export function nextReconciliationAction(order: TrackedOrder): ReconciliationAction {
  return order.status === "unknown" || order.status === "cancel-pending"
    ? "query-by-client-id"
    : "none";
}

export interface ReconciliationInput {
  readonly local: TrackedOrder;
  readonly snapshot: ExchangeOrderSnapshot | null;
  readonly at: number;
}

export interface ReconciliationResult {
  readonly state: TrackedOrder;
  readonly resolution: "resolved" | "unresolved";
}

function withExchangeId(local: TrackedOrder, exchangeOrderId: string): TrackedOrder {
  if (local.exchangeOrderId !== undefined && local.exchangeOrderId !== exchangeOrderId) {
    throw new Error("exchange order id mismatch");
  }
  return local.exchangeOrderId === exchangeOrderId
    ? local
    : Object.freeze({ ...local, exchangeOrderId });
}

function validateIdentity(local: TrackedOrder, snapshot: ExchangeOrderSnapshot): void {
  if (snapshot.clientOrderId !== local.clientOrderId) throw new Error("client order id mismatch");
  if (snapshot.symbol !== local.approvedIntent.symbol) throw new Error("symbol mismatch");
  if (snapshot.side !== local.approvedIntent.side) throw new Error("side mismatch");
  if (snapshot.quantity !== local.approvedIntent.quantity) throw new Error("quantity mismatch");
  if (typeof snapshot.exchangeOrderId !== "string" || snapshot.exchangeOrderId.length === 0 || snapshot.exchangeOrderId.length > 128) {
    throw new TypeError("invalid exchange order id");
  }
}

function finalState(local: TrackedOrder, snapshot: ExchangeOrderSnapshot, at: number): TrackedOrder {
  const base = withExchangeId(local, snapshot.exchangeOrderId);
  const fill = () => transitionOrder(base, {
    type: "fill-snapshot",
    cumulativeFilledQuantity: snapshot.cumulativeFilledQuantity,
    ...(snapshot.averageFillPrice === undefined ? {} : { averageFillPrice: snapshot.averageFillPrice }),
    ...(snapshot.fees === undefined ? {} : { fees: snapshot.fees }),
    at,
  });
  switch (snapshot.status) {
    case "NEW": {
      if (snapshot.cumulativeFilledQuantity !== "0") throw new Error("NEW snapshot has a nonzero fill");
      return Object.freeze({ ...base, status: "acknowledged", updatedAt: at, version: base.version + 1, reason: undefined });
    }
    case "PARTIALLY_FILLED": {
      const state = fill();
      if (state.status !== "partially-filled") throw new Error("invalid partial fill snapshot");
      return state;
    }
    case "FILLED": {
      const state = fill();
      if (state.status !== "filled") throw new Error("FILLED snapshot is not fully filled");
      return state;
    }
    case "CANCELED": {
      const filled = snapshot.cumulativeFilledQuantity === base.cumulativeFilledQuantity ? base : fill();
      if (new Decimal(filled.cumulativeFilledQuantity).eq(filled.approvedIntent.quantity)) return filled;
      return Object.freeze({ ...filled, status: "cancelled", updatedAt: at, version: filled.version + 1, reason: undefined });
    }
    case "REJECTED":
      if (snapshot.cumulativeFilledQuantity !== "0") throw new Error("REJECTED snapshot has a fill");
      return Object.freeze({ ...base, status: "rejected", updatedAt: at, version: base.version + 1, reason: "exchange-rejected" });
    default:
      throw new Error("unknown exchange status");
  }
}

export function reconcileOrder(input: ReconciliationInput): ReconciliationResult {
  if (!Number.isSafeInteger(input.at) || input.at < input.local.updatedAt) throw new Error("invalid reconciliation time");
  if (input.snapshot === null) {
    if (input.local.status !== "unknown") throw new Error("missing snapshot is only valid for unknown orders");
    return { state: input.local, resolution: "unresolved" };
  }
  validateIdentity(input.local, input.snapshot);
  return { state: finalState(input.local, input.snapshot, input.at), resolution: "resolved" };
}
