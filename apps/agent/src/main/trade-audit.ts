import type { ExecutionMode, Market } from "@cryptobot-labs/trading-core";

type AuditBase<C extends TradeAuditCategory, E extends string, P> = Readonly<{
  version: 1;
  id: string;
  category: C;
  event: E;
  deploymentId: string;
  configurationVersion: string;
  correlationId: string;
  occurredAt: number;
  mode: ExecutionMode;
  market: Market;
  symbol: string;
  payload: Readonly<P>;
}>;

export type TradeAuditCategory = "signal" | "risk" | "order" | "fill" | "api" | "key" | "emergency";

export type TradeAuditEvent =
  | AuditBase<"signal", "proposed" | "discarded", {
      signalId: string;
      scriptHash: string;
      action: "buy" | "sell" | "close" | "hold";
      reasonCode: string;
    }>
  | AuditBase<"risk", "accepted" | "rejected", {
      signalId: string;
      decisionCode: string;
    }>
  | AuditBase<"order", "submitted" | "accepted" | "rejected" | "unknown" | "cancelled", {
      clientOrderId: string;
      exchangeOrderId: string | null;
      statusCode: string;
    }>
  | AuditBase<"fill", "partial" | "filled", {
      clientOrderId: string;
      exchangeOrderId: string;
      fillId: string;
      quantity: string;
      price: string;
    }>
  | AuditBase<"api", "request-succeeded" | "request-failed", {
      endpointId: string;
      httpStatus: number | null;
      errorCode: string | null;
    }>
  | AuditBase<"key", "configured" | "rotated" | "erased" | "verification-failed", {
      maskedApiKeySuffix: string | null;
    }>
  | AuditBase<"emergency", "latched" | "cancel-complete" | "close-complete" | "failed", {
      outcomeCode: string;
      unresolvedCount: number;
    }>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CODE = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const SYMBOL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/u;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/u;
const MASKED_SUFFIX = /^\*{4}[A-Za-z0-9]{4}$/u;
const MODES: readonly ExecutionMode[] = ["paper", "futures-demo", "live"];
const MARKETS: readonly Market[] = ["spot", "futures"];
const CATEGORIES: readonly TradeAuditCategory[] = [
  "signal", "risk", "order", "fill", "api", "key", "emergency",
];
const ENVELOPE_KEYS = [
  "version", "id", "category", "event", "deploymentId", "configurationVersion",
  "correlationId", "occurredAt", "mode", "market", "symbol", "payload",
] as const;

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} is invalid`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${label} is invalid`);
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor) || !descriptor.enumerable) throw new Error(`${label} is invalid`);
    result[key] = descriptor.value;
  }
  return result;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length ||
      actual.some((key, index) => key !== sortedExpected[index])) throw new Error(`${label} is invalid`);
}

function matching(value: unknown, expression: RegExp, label: string): string {
  if (typeof value !== "string" || !expression.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function nullableMatching(value: unknown, expression: RegExp, label: string): string | null {
  return value === null ? null : matching(value, expression, label);
}

function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`${label} is invalid`);
  return value as T;
}

function parsePayload(category: TradeAuditCategory, event: string, input: unknown): object {
  const payload = plainRecord(input, "Trade audit payload");
  switch (category) {
    case "signal":
      oneOf(event, ["proposed", "discarded"], "Signal audit event");
      exactKeys(payload, ["signalId", "scriptHash", "action", "reasonCode"], "Signal audit payload");
      return {
        signalId: matching(payload.signalId, ID, "Signal id"),
        scriptHash: matching(payload.scriptHash, HASH, "Signal script hash"),
        action: oneOf(payload.action, ["buy", "sell", "close", "hold"], "Signal action"),
        reasonCode: matching(payload.reasonCode, CODE, "Signal reason code"),
      };
    case "risk":
      oneOf(event, ["accepted", "rejected"], "Risk audit event");
      exactKeys(payload, ["signalId", "decisionCode"], "Risk audit payload");
      return {
        signalId: matching(payload.signalId, ID, "Risk signal id"),
        decisionCode: matching(payload.decisionCode, CODE, "Risk decision code"),
      };
    case "order":
      oneOf(event, ["submitted", "accepted", "rejected", "unknown", "cancelled"], "Order audit event");
      exactKeys(payload, ["clientOrderId", "exchangeOrderId", "statusCode"], "Order audit payload");
      return {
        clientOrderId: matching(payload.clientOrderId, ID, "Client order id"),
        exchangeOrderId: nullableMatching(payload.exchangeOrderId, ID, "Exchange order id"),
        statusCode: matching(payload.statusCode, CODE, "Order status code"),
      };
    case "fill":
      oneOf(event, ["partial", "filled"], "Fill audit event");
      exactKeys(payload, ["clientOrderId", "exchangeOrderId", "fillId", "quantity", "price"], "Fill audit payload");
      return {
        clientOrderId: matching(payload.clientOrderId, ID, "Fill client order id"),
        exchangeOrderId: matching(payload.exchangeOrderId, ID, "Fill exchange order id"),
        fillId: matching(payload.fillId, ID, "Fill id"),
        quantity: matching(payload.quantity, DECIMAL, "Fill quantity"),
        price: matching(payload.price, DECIMAL, "Fill price"),
      };
    case "api":
      oneOf(event, ["request-succeeded", "request-failed"], "API audit event");
      exactKeys(payload, ["endpointId", "httpStatus", "errorCode"], "API audit payload");
      return {
        endpointId: matching(payload.endpointId, CODE, "API endpoint id"),
        httpStatus: payload.httpStatus === null ? null : integer(payload.httpStatus, "HTTP status", 100, 599),
        errorCode: nullableMatching(payload.errorCode, CODE, "API error code"),
      };
    case "key":
      oneOf(event, ["configured", "rotated", "erased", "verification-failed"], "Key audit event");
      exactKeys(payload, ["maskedApiKeySuffix"], "Key audit payload");
      return {
        maskedApiKeySuffix: nullableMatching(
          payload.maskedApiKeySuffix,
          MASKED_SUFFIX,
          "Masked API key suffix",
        ),
      };
    case "emergency":
      oneOf(event, ["latched", "cancel-complete", "close-complete", "failed"], "Emergency audit event");
      exactKeys(payload, ["outcomeCode", "unresolvedCount"], "Emergency audit payload");
      return {
        outcomeCode: matching(payload.outcomeCode, CODE, "Emergency outcome code"),
        unresolvedCount: integer(payload.unresolvedCount, "Emergency unresolved count", 0, 1_000_000),
      };
  }
}

/**
 * Validates and detaches an audit event. Exact, category-specific fields make
 * credentials, headers, signatures and arbitrary exchange responses impossible
 * to serialize through this contract.
 */
export function validateTradeAuditEvent(input: unknown): TradeAuditEvent {
  const envelope = plainRecord(input, "Trade audit event");
  exactKeys(envelope, ENVELOPE_KEYS, "Trade audit event");
  if (envelope.version !== 1) throw new Error("Trade audit version is unsupported");
  const category = oneOf(envelope.category, CATEGORIES, "Trade audit category");
  if (typeof envelope.event !== "string") throw new Error("Trade audit event is invalid");
  const mode = oneOf(envelope.mode, MODES, "Trade audit mode");
  const market = oneOf(envelope.market, MARKETS, "Trade audit market");
  if (mode === "futures-demo" && market !== "futures") throw new Error("Trade audit target is invalid");
  const event = {
    version: 1,
    id: matching(envelope.id, ID, "Trade audit id"),
    category,
    event: envelope.event,
    deploymentId: matching(envelope.deploymentId, ID, "Trade audit deployment id"),
    configurationVersion: matching(
      envelope.configurationVersion,
      ID,
      "Trade audit configuration version",
    ),
    correlationId: matching(envelope.correlationId, ID, "Trade audit correlation id"),
    occurredAt: integer(envelope.occurredAt, "Trade audit timestamp"),
    mode,
    market,
    symbol: matching(envelope.symbol, SYMBOL, "Trade audit symbol"),
    payload: Object.freeze(parsePayload(category, envelope.event, envelope.payload)),
  };
  return Object.freeze(event) as TradeAuditEvent;
}
