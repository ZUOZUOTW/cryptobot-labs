import Decimal from "decimal.js";

import type { ExchangeOrderSnapshot, OrderStatus, TrackedOrder } from "./types";

const ExactDecimal = Decimal.clone({ precision: 96 });
const DECIMAL = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/u;
const TERMINAL = new Set<OrderStatus>(["filled", "cancelled", "rejected", "risk-rejected"]);
const RECONCILABLE = new Set<OrderStatus>([
  "submitting", "acknowledged", "partially-filled", "cancel-pending", "unknown", "reconciled",
  "filled", "cancelled", "rejected",
]);

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

function isDecimal(value: unknown, positive = false): value is string {
  if (typeof value !== "string" || !DECIMAL.test(value)) return false;
  const digits = value.replace(".", "").replace(/^0+/u, "");
  if (digits.length > 42) return false;
  return positive ? new ExactDecimal(value).gt(0) : true;
}

function validateIdentity(local: TrackedOrder, snapshot: ExchangeOrderSnapshot): void {
  if (snapshot.clientOrderId !== local.clientOrderId) throw new Error("client order id mismatch");
  if (snapshot.symbol !== local.approvedIntent.symbol) throw new Error("symbol mismatch");
  if (snapshot.side !== local.approvedIntent.side) throw new Error("side mismatch");
  if (snapshot.quantity !== local.approvedIntent.quantity) throw new Error("quantity mismatch");
  if (typeof snapshot.exchangeOrderId !== "string" || snapshot.exchangeOrderId.length === 0 || snapshot.exchangeOrderId.length > 128) {
    throw new TypeError("invalid exchange order id");
  }
  if (local.exchangeOrderId !== undefined && local.exchangeOrderId !== snapshot.exchangeOrderId) {
    throw new Error("exchange order id mismatch");
  }
}

function validateSnapshotDecimals(local: TrackedOrder, snapshot: ExchangeOrderSnapshot): void {
  if (!isDecimal(snapshot.cumulativeFilledQuantity)) throw new TypeError("invalid cumulative fill decimal");
  if (snapshot.averageFillPrice !== undefined && !isDecimal(snapshot.averageFillPrice, true)) {
    throw new TypeError("invalid average fill price decimal");
  }
  if (snapshot.fees !== undefined && !isDecimal(snapshot.fees)) throw new TypeError("invalid fees decimal");

  const cumulative = new ExactDecimal(snapshot.cumulativeFilledQuantity);
  if (cumulative.lt(local.cumulativeFilledQuantity)) throw new Error("stale cumulative fill snapshot");
  if (cumulative.gt(local.approvedIntent.quantity)) throw new Error("cumulative fill exceeds order quantity");
  if (cumulative.gt(0) && snapshot.averageFillPrice === undefined && local.averageFillPrice === undefined) {
    throw new TypeError("average fill price is required for a nonzero fill");
  }
}

interface MaterialState {
  readonly status: OrderStatus;
  readonly exchangeOrderId: string;
  readonly cumulativeFilledQuantity: string;
  readonly averageFillPrice: string | undefined;
  readonly fees: string | undefined;
  readonly reason: string | undefined;
}

function materialFromSnapshot(local: TrackedOrder, snapshot: ExchangeOrderSnapshot): MaterialState {
  const cumulative = new ExactDecimal(snapshot.cumulativeFilledQuantity);
  const quantity = new ExactDecimal(local.approvedIntent.quantity);
  let status: OrderStatus;
  let reason: string | undefined;

  switch (snapshot.status) {
    case "NEW":
      if (!cumulative.isZero()) throw new Error("NEW snapshot has a nonzero fill");
      status = "acknowledged";
      break;
    case "PARTIALLY_FILLED":
      if (!cumulative.gt(0) || !cumulative.lt(quantity)) throw new Error("invalid partial fill snapshot");
      status = "partially-filled";
      break;
    case "FILLED":
      if (!cumulative.eq(quantity)) throw new Error("FILLED snapshot is not fully filled");
      status = "filled";
      break;
    case "CANCELED":
      status = cumulative.eq(quantity) ? "filled" : "cancelled";
      break;
    case "REJECTED":
      if (!cumulative.isZero()) throw new Error("REJECTED snapshot has a fill");
      status = "rejected";
      reason = "exchange-rejected";
      break;
    default:
      throw new Error("unknown exchange status");
  }

  return {
    status,
    exchangeOrderId: snapshot.exchangeOrderId,
    cumulativeFilledQuantity: snapshot.cumulativeFilledQuantity,
    averageFillPrice: snapshot.averageFillPrice ?? local.averageFillPrice,
    fees: snapshot.fees ?? local.fees,
    reason,
  };
}

function sameMaterialState(local: TrackedOrder, next: MaterialState): boolean {
  return local.status === next.status &&
    local.exchangeOrderId === next.exchangeOrderId &&
    local.cumulativeFilledQuantity === next.cumulativeFilledQuantity &&
    local.averageFillPrice === next.averageFillPrice &&
    local.fees === next.fees &&
    local.reason === next.reason;
}

function reconcileSnapshot(local: TrackedOrder, snapshot: ExchangeOrderSnapshot, at: number): TrackedOrder {
  if (!RECONCILABLE.has(local.status)) throw new Error(`order status ${local.status} cannot be reconciled`);
  validateIdentity(local, snapshot);
  validateSnapshotDecimals(local, snapshot);
  const material = materialFromSnapshot(local, snapshot);
  if (sameMaterialState(local, material)) return local;
  if (TERMINAL.has(local.status)) throw new Error(`terminal order ${local.status} is immutable`);
  return Object.freeze({
    ...local,
    ...material,
    updatedAt: at,
    version: local.version + 1,
  });
}

export function reconcileOrder(input: ReconciliationInput): ReconciliationResult {
  if (typeof input !== "object" || input === null || !Number.isSafeInteger(input.at) || input.at < input.local.updatedAt) {
    throw new Error("invalid reconciliation time");
  }
  if (input.snapshot === null) {
    if (input.local.status !== "unknown") throw new Error("missing snapshot is only valid for unknown orders");
    return { state: input.local, resolution: "unresolved" };
  }
  return { state: reconcileSnapshot(input.local, input.snapshot, input.at), resolution: "resolved" };
}
