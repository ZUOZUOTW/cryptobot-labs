import type { Market } from "@cryptobot-labs/trading-core";

const DECIMAL = /^(?:0|[1-9]\d{0,31})(?:\.\d{1,18})?$/;

export type MarketStreamErrorCode = "missing" | "stale" | "out-of-order" | "invalid" | "clock";

export class MarketStreamError extends Error {
  constructor(readonly code: MarketStreamErrorCode, message: string) {
    super(message);
    this.name = "MarketStreamError";
  }
}

export interface MarketQuote {
  readonly market: Market;
  readonly symbol: string;
  readonly bid: string;
  readonly ask: string;
  readonly last: string;
  readonly exchangeTimestamp: number;
  readonly receivedAt: number;
}

function key(market: Market, symbol: string): string {
  return `${market}:${symbol}`;
}

function compareDecimal(left: string, right: string): number {
  const [leftInteger = "", leftFraction = ""] = left.split(".");
  const [rightInteger = "", rightFraction = ""] = right.split(".");
  if (leftInteger.length !== rightInteger.length) {
    return leftInteger.length < rightInteger.length ? -1 : 1;
  }
  const integerComparison = leftInteger.localeCompare(rightInteger);
  if (integerComparison !== 0) return integerComparison;
  const width = Math.max(leftFraction.length, rightFraction.length);
  return leftFraction.padEnd(width, "0").localeCompare(rightFraction.padEnd(width, "0"));
}

function validateQuote(quote: MarketQuote): MarketQuote {
  if ((quote.market !== "spot" && quote.market !== "futures") ||
      !/^[A-Z0-9]{4,34}$/.test(quote.symbol) ||
      !DECIMAL.test(quote.bid) || !DECIMAL.test(quote.ask) || !DECIMAL.test(quote.last) ||
      compareDecimal(quote.bid, "0") <= 0 || compareDecimal(quote.ask, "0") <= 0 ||
      compareDecimal(quote.last, "0") <= 0 || compareDecimal(quote.bid, quote.ask) > 0 ||
      !Number.isSafeInteger(quote.exchangeTimestamp) || quote.exchangeTimestamp < 0 ||
      !Number.isSafeInteger(quote.receivedAt) || quote.receivedAt < quote.exchangeTimestamp) {
    throw new MarketStreamError("invalid", "Invalid market quote");
  }
  return Object.freeze({ ...quote });
}

/** Keeps only normalized public prices and rejects time travel. */
export class MarketStreamState {
  readonly #quotes = new Map<string, MarketQuote>();

  record(next: MarketQuote): void {
    const quote = validateQuote(next);
    const identity = key(quote.market, quote.symbol);
    const current = this.#quotes.get(identity);
    if (current && (quote.exchangeTimestamp < current.exchangeTimestamp || quote.receivedAt < current.receivedAt)) {
      throw new MarketStreamError("out-of-order", "Market quote is out of order");
    }
    this.#quotes.set(identity, quote);
  }

  snapshot(market: Market, symbol: string): MarketQuote | null {
    return this.#quotes.get(key(market, symbol)) ?? null;
  }

  requireFresh(market: Market, symbol: string, now: number, maximumAgeMs: number): MarketQuote {
    if (!Number.isSafeInteger(now) || now < 0 ||
        !Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 0) {
      throw new MarketStreamError("invalid", "Invalid market freshness check");
    }
    const quote = this.snapshot(market, symbol);
    if (!quote) throw new MarketStreamError("missing", "Market data is unavailable");
    const age = now - quote.receivedAt;
    if (age < 0 || age > maximumAgeMs) throw new MarketStreamError("stale", "Market data is stale");
    return quote;
  }
}

export interface ClockSyncSnapshot {
  readonly synchronizedAt: number;
  readonly driftMs: number;
}

export class ClockFreshnessGuard {
  #snapshot: ClockSyncSnapshot | null = null;

  record(snapshot: ClockSyncSnapshot): void {
    if (!Number.isSafeInteger(snapshot.synchronizedAt) || snapshot.synchronizedAt < 0 ||
        !Number.isFinite(snapshot.driftMs)) {
      throw new MarketStreamError("invalid", "Invalid clock synchronization sample");
    }
    if (this.#snapshot && snapshot.synchronizedAt < this.#snapshot.synchronizedAt) {
      throw new MarketStreamError("out-of-order", "Clock synchronization sample is out of order");
    }
    this.#snapshot = Object.freeze({ ...snapshot });
  }

  requireFresh(now: number, maximumAgeMs = 30_000, maximumDriftMs = 1_000): ClockSyncSnapshot {
    if (!Number.isSafeInteger(now) || now < 0 ||
        !Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 0 ||
        !Number.isFinite(maximumDriftMs) || maximumDriftMs < 0) {
      throw new MarketStreamError("invalid", "Invalid clock freshness check");
    }
    const current = this.#snapshot;
    if (!current) throw new MarketStreamError("missing", "Clock has never been synchronized");
    const age = now - current.synchronizedAt;
    if (age < 0 || age > maximumAgeMs) throw new MarketStreamError("stale", "Clock synchronization is stale");
    if (Math.abs(current.driftMs) > maximumDriftMs) {
      throw new MarketStreamError("clock", "Clock drift exceeds the execution limit");
    }
    return current;
  }
}
