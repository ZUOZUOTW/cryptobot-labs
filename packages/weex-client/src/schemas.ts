import type { Candle, InstrumentRules } from "@cryptobot-labs/trading-core";

import { WeexApiError } from "./errors";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function schemaError(message: string): WeexApiError {
  return new WeexApiError(message, { category: "schema", retryable: false });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw schemaError(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function requiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || !value) throw schemaError(`Invalid instrument ${key}`);
  return value;
}

function requiredArray(source: Record<string, unknown>, key: string): unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) throw schemaError(`Invalid exchangeInfo ${key}`);
  return value;
}

function decimalString(value: unknown, label: string, allowZero = false): string {
  if (typeof value !== "string" || !DECIMAL.test(value) || (!allowZero && !/[1-9]/.test(value))) {
    throw schemaError(`Invalid decimal string for ${label}`);
  }
  return value;
}

function decimalValue(value: unknown, label: string, allowZero = false): string {
  if (typeof value === "string") return decimalString(value, label, allowZero);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw schemaError(`Invalid decimal for ${label}`);
  }
  return String(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw schemaError(`Invalid ${label}`);
  return value as number;
}

function timestamp(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw schemaError(`Invalid ${label}`);
  return parsed;
}

function compareDecimal(left: string, right: string): number {
  const [li, lf = ""] = left.split(".");
  const [ri, rf = ""] = right.split(".");
  if (li.length !== ri.length) return li.length < ri.length ? -1 : 1;
  if (li !== ri) return li < ri ? -1 : 1;
  const width = Math.max(lf.length, rf.length);
  const normalizedLeft = lf.padEnd(width, "0");
  const normalizedRight = rf.padEnd(width, "0");
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft < normalizedRight ? -1 : 1;
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

function parseDocumentedCandleTuple(raw: unknown, index: number, nowMs: number, market: "spot" | "futures"): Candle {
  if (!Array.isArray(raw) || raw.length !== 11) throw schemaError(`Invalid ${market} candle row length at ${index}`);
  const openTime = timestamp(raw[0], "candle open time");
  const open = decimalString(raw[1], "open");
  const high = decimalString(raw[2], "high");
  const low = decimalString(raw[3], "low");
  const close = decimalString(raw[4], "close");
  const volume = decimalString(raw[5], "volume", true);
  const closeTime = timestamp(raw[6], "candle close time");
  decimalString(raw[7], "quote volume", true);
  nonNegativeInteger(raw[8], "trade count");
  decimalString(raw[9], "taker buy base volume", true);
  decimalString(raw[10], "taker buy quote volume", true);
  if (closeTime <= openTime) throw schemaError(`Invalid ${market} candle time range at ${index}`);
  if ([open, close, low].some((price) => compareDecimal(high, price) < 0) ||
      [open, close, high].some((price) => compareDecimal(low, price) > 0)) {
    throw schemaError(`Invalid OHLC relationship at ${market} candle row ${index}`);
  }
  return { openTime, closeTime, open, high, low, close, volume, complete: closeTime < nowMs };
}

function parseCandleCollection(body: unknown, nowMs: number, market: "spot" | "futures"): Candle[] {
  if (!Array.isArray(body)) throw schemaError(`Invalid ${market} candle collection`);
  return body.map((row, index) => parseDocumentedCandleTuple(row, index, nowMs, market));
}

export function parseSpotCandleRows(body: unknown, nowMs: number): Candle[] {
  return parseCandleCollection(body, nowMs, "spot");
}

export function parseFuturesCandleRows(body: unknown, nowMs: number): Candle[] {
  return parseCandleCollection(body, nowMs, "futures");
}

function findInstrument(symbols: unknown[], symbol: string, market: string): Record<string, unknown> {
  const candidate = symbols.find((value) => value !== null && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).symbol === symbol);
  return record(candidate, `${market} exchangeInfo instrument`);
}

export function parseSpotInstrumentRules(body: unknown, symbol: string): InstrumentRules {
  const exchangeInfo = record(body, "spot exchangeInfo");
  requiredString(exchangeInfo, "timezone");
  timestamp(exchangeInfo.serverTime, "spot serverTime");
  requiredArray(exchangeInfo, "rateLimits");
  const instrument = findInstrument(requiredArray(exchangeInfo, "symbols"), symbol, "spot");
  requiredString(instrument, "status");
  nonNegativeInteger(instrument.baseAssetPrecision, "baseAssetPrecision");
  nonNegativeInteger(instrument.quoteAssetPrecision, "quoteAssetPrecision");
  return {
    market: "spot",
    symbol,
    baseAsset: requiredString(instrument, "baseAsset"),
    quoteAsset: requiredString(instrument, "quoteAsset"),
    tickSize: decimalString(instrument.tickSize, "tickSize"),
    stepSize: decimalString(instrument.stepSize, "stepSize"),
    minimumQuantity: decimalString(instrument.minTradeAmount, "minTradeAmount"),
  };
}

function precisionStep(value: unknown, label: string): string {
  const precision = nonNegativeInteger(value, label);
  if (precision > 18) throw schemaError(`Invalid ${label}`);
  return precision === 0 ? "1" : `0.${"0".repeat(precision - 1)}1`;
}

export function parseFuturesInstrumentRules(body: unknown, symbol: string): InstrumentRules {
  const exchangeInfo = record(body, "futures exchangeInfo");
  requiredArray(exchangeInfo, "assets");
  requiredArray(exchangeInfo, "rateLimits");
  const instrument = findInstrument(requiredArray(exchangeInfo, "symbols"), symbol, "futures");
  requiredString(instrument, "displaySymbol");
  requiredString(instrument, "marginAsset");
  nonNegativeInteger(instrument.baseAssetPrecision, "baseAssetPrecision");
  nonNegativeInteger(instrument.quotePrecision, "quotePrecision");
  decimalValue(instrument.contractVal, "contractVal");
  if (!Array.isArray(instrument.delivery) || typeof instrument.forwardContractFlag !== "boolean") {
    throw schemaError("Invalid futures contract metadata");
  }
  return {
    market: "futures",
    symbol,
    baseAsset: requiredString(instrument, "baseAsset"),
    quoteAsset: requiredString(instrument, "quoteAsset"),
    tickSize: precisionStep(instrument.pricePrecision, "pricePrecision"),
    stepSize: precisionStep(instrument.quantityPrecision, "quantityPrecision"),
    minimumQuantity: decimalValue(instrument.minOrderSize, "minOrderSize"),
    maximumLeverage: String(nonNegativeInteger(instrument.maxLeverage, "maxLeverage")),
  };
}
