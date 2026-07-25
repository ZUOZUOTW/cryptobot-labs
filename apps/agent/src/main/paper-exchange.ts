import type {
  ApprovedOrderIntent,
  CancelOutcome,
  ExchangeExecutionPort,
  ExchangeOrderQuery,
  ExchangeOrderSnapshot,
  ExchangeSubmitRequest,
  SubmitOutcome,
} from "@cryptobot-labs/trading-core";

const DECIMAL = /^(?:0|[1-9]\d{0,31})(?:\.\d{1,18})?$/;
const MAX_DECIMAL_PLACES = 18;

interface ParsedDecimal { readonly integer: bigint; readonly scale: number }

function parseDecimal(value: string, label: string, allowZero = true): ParsedDecimal {
  if (typeof value !== "string" || !DECIMAL.test(value)) throw new TypeError(`Invalid paper ${label}`);
  const [whole, fraction = ""] = value.split(".");
  const integer = BigInt(`${whole}${fraction}`);
  if (!allowZero && integer === 0n) throw new TypeError(`Invalid paper ${label}`);
  return { integer, scale: fraction.length };
}

function power(scale: number): bigint {
  return 10n ** BigInt(scale);
}

function assertRateBps(value: string, label: string, maximumInclusive = true): void {
  const parsed = parseDecimal(value, label);
  const maximum = 10_000n * power(parsed.scale);
  if (maximumInclusive ? parsed.integer > maximum : parsed.integer >= maximum) {
    throw new TypeError(`Invalid paper ${label}`);
  }
}

function rationalString(numerator: bigint, denominator: bigint, scale = MAX_DECIMAL_PLACES): string {
  if (denominator <= 0n || numerator < 0n) throw new TypeError("Invalid paper decimal operation");
  const factor = power(scale);
  const rounded = (numerator * factor + denominator / 2n) / denominator;
  const whole = rounded / factor;
  const fraction = (rounded % factor).toString().padStart(scale, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function adverseFill(price: string, side: "buy" | "sell", slippageBps: string): string {
  const parsedPrice = parseDecimal(price, "price", false);
  const slippage = parseDecimal(slippageBps, "slippage bps");
  const bpsScale = power(slippage.scale);
  const base = 10_000n * bpsScale;
  if (slippage.integer >= base) throw new TypeError("Invalid paper slippage bps");
  const multiplier = side === "buy" ? base + slippage.integer : base - slippage.integer;
  return rationalString(parsedPrice.integer * multiplier, power(parsedPrice.scale) * base);
}

function fees(price: string, quantity: string, feeBps: string): string {
  const parsedPrice = parseDecimal(price, "fill price", false);
  const parsedQuantity = parseDecimal(quantity, "quantity", false);
  const parsedFee = parseDecimal(feeBps, "fee bps");
  const denominator = power(parsedPrice.scale + parsedQuantity.scale + parsedFee.scale) * 10_000n;
  return rationalString(parsedPrice.integer * parsedQuantity.integer * parsedFee.integer, denominator);
}

function sameIntent(left: ApprovedOrderIntent, right: ApprovedOrderIntent): boolean {
  return left.symbol === right.symbol && left.side === right.side && left.quantity === right.quantity &&
    left.price === right.price && left.expectedSlippageBps === right.expectedSlippageBps &&
    left.reduceOnly === right.reduceOnly;
}

export interface PaperFillSnapshot extends ExchangeOrderSnapshot {
  readonly filledAt: number;
}

export interface PaperExchangeOptions {
  readonly slippageBps: string;
  readonly feeBps: string;
  readonly now?: () => number;
}

/** Immediate deterministic fills for CryptoBot Labs paper mode; never reaches WEEX private APIs. */
export class PaperExchange implements ExchangeExecutionPort {
  readonly #orders = new Map<string, { request: ExchangeSubmitRequest; snapshot: PaperFillSnapshot }>();
  readonly #slippageBps: string;
  readonly #feeBps: string;
  readonly #now: () => number;

  constructor(options: PaperExchangeOptions) {
    assertRateBps(options.slippageBps, "slippage bps", false);
    assertRateBps(options.feeBps, "fee bps");
    this.#slippageBps = options.slippageBps;
    this.#feeBps = options.feeBps;
    this.#now = options.now ?? Date.now;
  }

  async submit(request: ExchangeSubmitRequest): Promise<SubmitOutcome> {
    if ((request.target?.market !== "spot" && request.target?.market !== "futures") ||
        request.target.mode !== "paper" ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(request.clientOrderId) ||
        !/^[A-Z0-9]{4,34}$/.test(request.intent?.symbol) ||
        (request.intent.side !== "buy" && request.intent.side !== "sell") ||
        typeof request.intent.reduceOnly !== "boolean") {
      throw new TypeError("Invalid paper order request");
    }
    parseDecimal(request.intent.quantity, "quantity", false);
    parseDecimal(request.intent.price, "price", false);
    parseDecimal(request.intent.expectedSlippageBps, "expected slippage bps");
    const identity = `${request.target.market}:${request.clientOrderId}`;
    const existing = this.#orders.get(identity);
    if (existing) {
      return existing.request.target.market === request.target.market && sameIntent(existing.request.intent, request.intent)
        ? { status: "acknowledged", exchangeOrderId: existing.snapshot.exchangeOrderId }
        : { status: "rejected", reason: "client-order-id-conflict" };
    }
    const filledAt = this.#now();
    if (!Number.isSafeInteger(filledAt) || filledAt < 0) throw new TypeError("Invalid paper clock");
    const averageFillPrice = adverseFill(request.intent.price, request.intent.side, this.#slippageBps);
    const exchangeOrderId = `paper-${request.clientOrderId}`;
    const snapshot: PaperFillSnapshot = Object.freeze({
      clientOrderId: request.clientOrderId,
      exchangeOrderId,
      symbol: request.intent.symbol,
      side: request.intent.side,
      quantity: request.intent.quantity,
      status: "FILLED",
      cumulativeFilledQuantity: request.intent.quantity,
      averageFillPrice,
      fees: fees(averageFillPrice, request.intent.quantity, this.#feeBps),
      filledAt,
    });
    this.#orders.set(identity, {
      request: Object.freeze({
        target: Object.freeze({ ...request.target }),
        clientOrderId: request.clientOrderId,
        intent: Object.freeze({ ...request.intent }),
      }),
      snapshot,
    });
    return { status: "acknowledged", exchangeOrderId };
  }

  async findByClientOrderId(query: ExchangeOrderQuery): Promise<PaperFillSnapshot | null> {
    if (query.target.mode !== "paper") throw new TypeError("Paper exchange requires paper execution target");
    const stored = this.#orders.get(`${query.target.market}:${query.clientOrderId}`);
    if (!stored) return null;
    if (stored.snapshot.symbol !== query.symbol) throw new TypeError("Paper order identity mismatch");
    return stored.snapshot;
  }

  async cancel(query: ExchangeOrderQuery): Promise<CancelOutcome> {
    const stored = await this.findByClientOrderId(query);
    return { status: "rejected", reason: stored ? "paper-order-already-filled" : "paper-order-not-found" };
  }
}
