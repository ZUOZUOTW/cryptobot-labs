import type {
  ExchangeOrderSnapshot,
  ExchangeOrderStatus,
} from "@cryptobot-labs/trading-core";

import { WeexApiError, mapWeexError } from "./errors";

const DECIMAL = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;
const SYMBOL = /^[A-Z0-9_]{3,32}$/;
const MAX_COLLECTION = 500;

function schema(message: string): WeexApiError {
  return new WeexApiError(message, { category: "schema", retryable: false });
}

export function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

export function isCanonicalPositiveDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL.test(value) && /[1-9]/.test(value);
}

export function isCanonicalNonnegativeDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL.test(value);
}

export function isPrivateSymbol(value: unknown): value is string {
  return typeof value === "string" && value === value.toUpperCase() && SYMBOL.test(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw schema(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function reasonFrom(body: Record<string, unknown>): string {
  const candidate = body.message ?? body.msg ?? body.error ?? body.code;
  if ((typeof candidate === "string" || typeof candidate === "number") && String(candidate).length <= 200) {
    return String(candidate);
  }
  return "WEEX rejected the request";
}

function isSuccessCode(code: unknown): boolean {
  return code === undefined || code === 0 || code === "0" || code === 200 || code === "200" || code === "00000";
}

export type BodyEnvelope =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly reason: string };

/** Unwrap only the documented/common V3 envelope variants; never coerce failure into success. */
export function unwrapPrivateBody(body: unknown): BodyEnvelope {
  if (Array.isArray(body)) return { ok: true, data: body };
  const source = record(body, "WEEX private response");
  if (source.success === false || !isSuccessCode(source.code)) {
    return { ok: false, reason: reasonFrom(source) };
  }
  if (source.success !== undefined && typeof source.success !== "boolean") {
    throw schema("Invalid WEEX success flag");
  }
  return { ok: true, data: Object.hasOwn(source, "data") ? source.data : source };
}

function requiredString(source: Record<string, unknown>, keys: readonly string[], label: string): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 128) return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  }
  throw schema(`Invalid ${label}`);
}

function optionalDecimal(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    if (source[key] === undefined) continue;
    if (!isCanonicalNonnegativeDecimal(source[key])) throw schema(`Invalid ${key}`);
    return source[key] as string;
  }
  return undefined;
}

function normalizeStatus(value: unknown): ExchangeOrderStatus {
  if (typeof value !== "string") throw schema("Invalid order status");
  const status = value.toUpperCase();
  if (status === "NEW" || status === "OPEN") return "NEW";
  if (status === "PARTIALLY_FILLED" || status === "PARTIAL_FILLED") return "PARTIALLY_FILLED";
  if (status === "FILLED") return "FILLED";
  if (status === "CANCELED" || status === "CANCELLED") return "CANCELED";
  if (status === "REJECTED") return "REJECTED";
  throw schema("Unknown order status");
}

export interface ExpectedOrderIdentity {
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly side?: "buy" | "sell";
  readonly quantity?: string;
}

export function parseOrderSnapshot(value: unknown, expected: ExpectedOrderIdentity): ExchangeOrderSnapshot {
  const source = record(value, "order snapshot");
  const clientOrderId = requiredString(source, ["clientOrderId", "origClientOrderId"], "client order id");
  const exchangeOrderId = requiredString(source, ["orderId"], "exchange order id");
  const symbol = requiredString(source, ["symbol"], "order symbol").toUpperCase();
  const rawSide = requiredString(source, ["side"], "order side").toUpperCase();
  if (rawSide !== "BUY" && rawSide !== "SELL") throw schema("Invalid order side");
  const side = rawSide === "BUY" ? "buy" : "sell";
  const quantity = requiredString(source, ["origQty", "quantity", "size"], "order quantity");
  if (!isCanonicalPositiveDecimal(quantity)) throw schema("Invalid order quantity");
  if (clientOrderId !== expected.clientOrderId || symbol !== expected.symbol ||
      (expected.side !== undefined && side !== expected.side) ||
      (expected.quantity !== undefined && quantity !== expected.quantity)) {
    throw schema("Order identity mismatch");
  }
  const cumulativeFilledQuantity = optionalDecimal(source, ["executedQty", "cumQty", "filledQty"]) ?? "0";
  const averageFillPrice = optionalDecimal(source, ["avgPrice", "averagePrice"]);
  return {
    clientOrderId, exchangeOrderId, symbol, side, quantity,
    status: normalizeStatus(source.status), cumulativeFilledQuantity,
    ...(averageFillPrice === undefined ? {} : { averageFillPrice }),
  };
}

export function parseOrderCollection(body: unknown): unknown[] {
  const unwrapped = unwrapPrivateBody(body);
  if (!unwrapped.ok) throw mapWeexError(400, { code: "-1045", message: unwrapped.reason });
  let value = unwrapped.data;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    value = source.orders ?? source.orderList ?? source.list ?? source.rows;
  }
  if (!Array.isArray(value) || value.length > MAX_COLLECTION) throw schema("Invalid order collection");
  return value;
}

export function parseAcknowledgedOrder(body: unknown, expectedClientOrderId: string): string | { rejected: string } {
  const unwrapped = unwrapPrivateBody(body);
  if (!unwrapped.ok) return { rejected: unwrapped.reason };
  const source = record(unwrapped.data, "order acknowledgement");
  const orderId = requiredString(source, ["orderId"], "exchange order id");
  const returnedClientId = source.clientOrderId ?? source.origClientOrderId;
  if (returnedClientId !== undefined && returnedClientId !== expectedClientOrderId) {
    throw schema("Order acknowledgement identity mismatch");
  }
  return orderId;
}

export function parseCancellation(body: unknown, expected: ExpectedOrderIdentity): { cancelled: true } | { rejected: string } {
  const unwrapped = unwrapPrivateBody(body);
  if (!unwrapped.ok) return { rejected: unwrapped.reason };
  const source = record(unwrapped.data, "order cancellation");
  const returnedClientId = source.clientOrderId ?? source.origClientOrderId;
  const returnedSymbol = source.symbol;
  if ((returnedClientId !== undefined && returnedClientId !== expected.clientOrderId) ||
      (returnedSymbol !== undefined && returnedSymbol !== expected.symbol)) {
    throw schema("Cancellation identity mismatch");
  }
  if (returnedClientId === undefined && source.orderId === undefined && source.success !== true) {
    throw schema("Invalid cancellation acknowledgement");
  }
  return { cancelled: true };
}
