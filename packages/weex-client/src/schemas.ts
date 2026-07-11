import type { Candle, InstrumentRules, Market } from "@cryptobot-labs/trading-core";

import { WeexApiError } from "./errors";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function schemaError(message: string, cause?: unknown): WeexApiError {
  return new WeexApiError(message, { category: "schema", retryable: false, cause });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw schemaError(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function decimal(value: unknown, label: string, allowZero = false): string {
  if (typeof value !== "string" || !DECIMAL.test(value) || (!allowZero && !/[1-9]/.test(value))) {
    throw schemaError(`Invalid decimal string for ${label}`);
  }
  return value;
}

function timestamp(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw schemaError("Invalid candle timestamp");
  return parsed;
}

function compareDecimal(left: string, right: string): number {
  const [li, lf = ""] = left.split(".");
  const [ri, rf = ""] = right.split(".");
  if (li.length !== ri.length) return li.length < ri.length ? -1 : 1;
  if (li !== ri) return li < ri ? -1 : 1;
  const width = Math.max(lf.length, rf.length);
  return lf.padEnd(width, "0").localeCompare(rf.padEnd(width, "0"));
}

export function unwrapWeexData(body: unknown): unknown {
  const envelope = record(body, "WEEX response envelope");
  if (!("data" in envelope)) throw schemaError("WEEX response is missing data");
  if ("code" in envelope && !["0", "00000"].includes(String(envelope.code))) {
    throw schemaError("Unexpected WEEX success response code");
  }
  return envelope.data;
}

export function parseIntervalMs(interval: string): number {
  const match = /^(\d+)([mhdw])$/.exec(interval);
  if (!match) throw new WeexApiError("Unsupported candle interval", { category: "validation", retryable: false });
  const amount = Number(match[1]);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2] as "m" | "h" | "d" | "w"];
  const result = amount * unit;
  if (!Number.isSafeInteger(result) || result <= 0) throw new WeexApiError("Unsupported candle interval", { category: "validation", retryable: false });
  return result;
}

export function parseCandleRows(body: unknown, intervalMs: number, nowMs: number): Candle[] {
  const data = unwrapWeexData(body);
  if (!Array.isArray(data)) throw schemaError("Invalid WEEX candle collection");
  return data.map((raw, index) => {
    if (!Array.isArray(raw) || raw.length < 6 || raw.length > 8) throw schemaError(`Invalid candle row at ${index}`);
    const openTime = timestamp(raw[0]);
    const open = decimal(raw[1], "open");
    const high = decimal(raw[2], "high");
    const low = decimal(raw[3], "low");
    const close = decimal(raw[4], "close");
    const volume = decimal(raw[5], "volume", true);
    if ([open, close, low].some((price) => compareDecimal(high, price) < 0) ||
        [open, close, high].some((price) => compareDecimal(low, price) > 0)) {
      throw schemaError(`Invalid OHLC relationship at candle row ${index}`);
    }
    const closeTime = openTime + intervalMs - 1;
    return { openTime, closeTime, open, high, low, close, volume, complete: closeTime < nowMs };
  });
}

function requiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || !value) throw schemaError(`Invalid instrument ${key}`);
  return value;
}

export function parseInstrumentRules(body: unknown, market: Market, symbol: string): InstrumentRules {
  const data = unwrapWeexData(body);
  const container = Array.isArray(data) ? { symbols: data } : record(data, "exchangeInfo data");
  if (!Array.isArray(container.symbols)) throw schemaError("exchangeInfo symbols must be an array");
  const raw = container.symbols.find((candidate) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    return (candidate as Record<string, unknown>).symbol === symbol;
  });
  const instrument = record(raw, "exchangeInfo instrument");
  const tickSize = decimal(instrument.pricePrecision ?? instrument.tickSize, "pricePrecision");
  const stepSize = decimal(instrument.quantityPrecision ?? instrument.stepSize, "quantityPrecision");
  const minimumQuantity = decimal(instrument.minQuantity ?? instrument.minimumQuantity, "minQuantity");
  const minimumNotional = decimal(instrument.minNotional ?? instrument.minimumNotional, "minNotional", true);
  const maximumLeverage = instrument.maxLeverage === undefined
    ? undefined
    : decimal(instrument.maxLeverage, "maxLeverage");
  return {
    market,
    symbol,
    baseAsset: requiredString(instrument, "baseAsset"),
    quoteAsset: requiredString(instrument, "quoteAsset"),
    tickSize,
    stepSize,
    minimumQuantity,
    minimumNotional,
    ...(maximumLeverage === undefined ? {} : { maximumLeverage }),
  };
}
