import Decimal from "decimal.js";

import type {
  ApprovedOrderIntent,
  CreateTrackedOrderInput,
  OrderEvent,
  TrackedOrder,
} from "./types";

const ExactDecimal = Decimal.clone({ precision: 96 });
const DECIMAL = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/u;
const ID = /^[A-Za-z0-9_.:@/+\-]{1,128}$/u;
const CLIENT_ID = /^[A-Za-z0-9_-]{1,36}$/u;
const TERMINAL = new Set(["filled", "cancelled", "rejected", "risk-rejected"]);

function decimal(value: unknown, positive = false): value is string {
  if (typeof value !== "string" || !DECIMAL.test(value)) return false;
  const digits = value.replace(".", "").replace(/^0+/u, "");
  if (digits.length > 42) return false;
  return positive ? new ExactDecimal(value).gt(0) : true;
}

function timestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function reason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256;
}

function validateIntent(intent: unknown): asserts intent is ApprovedOrderIntent {
  if (typeof intent !== "object" || intent === null || Array.isArray(intent)) throw new TypeError("invalid approved intent");
  const value = intent as Record<string, unknown>;
  if (typeof value.symbol !== "string" || value.symbol.length < 3 || value.symbol.length > 64) throw new TypeError("invalid symbol");
  if (value.side !== "buy" && value.side !== "sell") throw new TypeError("invalid side");
  if (!decimal(value.quantity, true)) throw new TypeError("invalid quantity");
  if (!decimal(value.price, true)) throw new TypeError("invalid price");
  if (!decimal(value.expectedSlippageBps)) throw new TypeError("invalid slippage");
  if (typeof value.reduceOnly !== "boolean") throw new TypeError("invalid reduce-only flag");
}

export function createTrackedOrder(input: CreateTrackedOrderInput): TrackedOrder {
  if (typeof input !== "object" || input === null) throw new TypeError("invalid tracked order input");
  if (!ID.test(input.deploymentId)) throw new TypeError("invalid deployment id");
  if (!CLIENT_ID.test(input.clientOrderId)) throw new TypeError("invalid client order id");
  if (!timestamp(input.at)) throw new TypeError("invalid timestamp");
  validateIntent(input.approvedIntent);
  const approvedIntent = Object.freeze({ ...input.approvedIntent });
  return Object.freeze({
    deploymentId: input.deploymentId,
    clientOrderId: input.clientOrderId,
    approvedIntent,
    status: "proposed",
    createdAt: input.at,
    updatedAt: input.at,
    cumulativeFilledQuantity: "0",
    version: 0,
  });
}

function update(order: TrackedOrder, at: number, values: Partial<TrackedOrder>): TrackedOrder {
  return Object.freeze({ ...order, ...values, updatedAt: at, version: order.version + 1 });
}

function identicalTerminalDuplicate(order: TrackedOrder, event: OrderEvent): boolean {
  if (order.status === "risk-rejected" && event.type === "risk-rejected") return event.reason === order.reason;
  if (order.status === "rejected" && event.type === "submit-rejected") return event.reason === order.reason;
  if (order.status === "cancelled" && event.type === "cancel-acknowledged") return true;
  if (order.status === "filled" && event.type === "fill-snapshot") {
    return event.cumulativeFilledQuantity === order.cumulativeFilledQuantity &&
      event.averageFillPrice === order.averageFillPrice && event.fees === order.fees;
  }
  return false;
}

function assertFill(order: TrackedOrder, event: Extract<OrderEvent, { type: "fill-snapshot" }>): void {
  if (!decimal(event.cumulativeFilledQuantity)) throw new TypeError("invalid cumulative fill");
  if (event.averageFillPrice !== undefined && !decimal(event.averageFillPrice, true)) throw new TypeError("invalid average fill price");
  if (event.fees !== undefined && !decimal(event.fees)) throw new TypeError("invalid fees");
  const current = new ExactDecimal(order.cumulativeFilledQuantity);
  const next = new ExactDecimal(event.cumulativeFilledQuantity);
  const quantity = new ExactDecimal(order.approvedIntent.quantity);
  if (next.lt(current)) throw new Error("stale cumulative fill snapshot");
  if (next.gt(quantity)) throw new Error("cumulative fill exceeds order quantity");
  if (next.gt(current)) {
    if (event.averageFillPrice === undefined) {
      throw new TypeError("fresh average fill price is required when cumulative fill increases");
    }
    if (event.fees === undefined) {
      throw new TypeError("fresh fees are required when cumulative fill increases");
    }
  }
}

export function transitionOrder(order: TrackedOrder, event: OrderEvent): TrackedOrder {
  if (typeof order !== "object" || order === null || typeof event !== "object" || event === null) throw new TypeError("invalid order transition");
  if (!timestamp(event.at)) throw new TypeError("invalid event timestamp");
  if (event.at < order.updatedAt) throw new Error("event time cannot move backward");
  if (TERMINAL.has(order.status)) {
    if (identicalTerminalDuplicate(order, event)) return order;
    throw new Error(`terminal order ${order.status} is immutable`);
  }

  switch (event.type) {
    case "risk-rejected":
      if (order.status !== "proposed" || !reason(event.reason)) throw new Error("illegal risk rejection");
      return update(order, event.at, { status: "risk-rejected", reason: event.reason });
    case "submit-start":
    case "submit-started":
      if (order.status !== "proposed") throw new Error("illegal submit start");
      return update(order, event.at, { status: "submitting" });
    case "submit-acknowledged":
      if (!ID.test(event.exchangeOrderId)) throw new Error("illegal submit acknowledgement");
      if (order.status === "submitting") {
        return update(order, event.at, { status: "acknowledged", exchangeOrderId: event.exchangeOrderId });
      }
      if (["acknowledged", "partially-filled", "cancel-pending"].includes(order.status)) {
        if (order.exchangeOrderId === event.exchangeOrderId) return order;
        throw new Error("exchange order id mismatch on acknowledgement replay");
      }
      throw new Error("illegal submit acknowledgement");
    case "submit-rejected":
      if (order.status !== "submitting" || !reason(event.reason)) throw new Error("illegal submit rejection");
      return update(order, event.at, { status: "rejected", reason: event.reason });
    case "submit-timeout":
      if (order.status !== "submitting") throw new Error("illegal submit timeout");
      return update(order, event.at, { status: "unknown", reason: "submit-timeout" });
    case "fill-snapshot": { // Exchange cumulative snapshots are authoritative but monotonic.
      if (!["submitting", "acknowledged", "partially-filled", "cancel-pending", "unknown", "reconciled"].includes(order.status)) throw new Error("illegal fill snapshot");
      assertFill(order, event);
      if (event.cumulativeFilledQuantity === order.cumulativeFilledQuantity &&
          (event.averageFillPrice ?? order.averageFillPrice) === order.averageFillPrice &&
          (event.fees ?? order.fees) === order.fees) return order;
      const complete = new ExactDecimal(event.cumulativeFilledQuantity).eq(order.approvedIntent.quantity);
      const zero = new ExactDecimal(event.cumulativeFilledQuantity).eq(0);
      return update(order, event.at, {
        status: complete
          ? "filled"
          : order.status === "cancel-pending"
            ? "cancel-pending"
            : zero
              ? (order.status === "unknown" ? "unknown" : "acknowledged")
              : "partially-filled",
        cumulativeFilledQuantity: event.cumulativeFilledQuantity,
        averageFillPrice: event.averageFillPrice ?? order.averageFillPrice,
        fees: event.fees ?? order.fees,
      });
    }
    case "cancel-request":
    case "cancel-requested":
      if (order.status !== "acknowledged" && order.status !== "partially-filled") throw new Error("illegal cancel request");
      return update(order, event.at, { status: "cancel-pending", cancelAttemptedAt: event.at });
    case "cancel-acknowledged":
      if (order.status !== "cancel-pending") throw new Error("illegal cancel acknowledgement");
      return update(order, event.at, { status: "cancelled" });
    case "cancel-rejected":
      if (order.status !== "cancel-pending") throw new Error("illegal cancel rejection");
      if (event.reason !== undefined && !reason(event.reason)) throw new TypeError("invalid cancel rejection reason");
      return update(order, event.at, {
        status: new ExactDecimal(order.cumulativeFilledQuantity).gt(0) ? "partially-filled" : "acknowledged",
        cancelAttemptedAt: undefined,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
      });
    case "reconciliation-missing":
      if (order.status !== "unknown") throw new Error("illegal missing reconciliation");
      return order;
  }
}
