import type {
  Candle,
  DatasetValidation,
  FundingEvent,
  HistoricalCandleRequest,
  HistoricalDataset,
  InstrumentRules,
  Market,
} from "@cryptobot-labs/trading-core";

import { WeexApiError } from "./errors";
import { fetchInstrumentRules } from "./instruments";
import { parseFuturesCandleRows, parseIntervalMs, parseSpotCandleRows } from "./schemas";
import type { HttpTransport } from "./transport";

const ENDPOINTS = {
  spot: {
    origin: "https://api-spot.weex.com",
    path: "/api/v3/market/klines",
  },
  futures: {
    origin: "https://api-contract.weex.com",
    path: "/capi/v3/market/historyKlines",
  },
} as const;

export const MAX_FUTURES_HISTORY_PAGES = 100;
export const MAX_FUTURES_HISTORY_CANDLES = 10_000;
export const MAX_FUTURES_HISTORY_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;

const FUNDING_ENDPOINT = "/capi/v2/market/getHistoryFundRate";
const MARK_ENDPOINT = "/capi/v3/market/historyKlines";
const FUTURES_ORIGIN = "https://api-contract.weex.com";
const FUNDING_LIMIT = 100;
const MARK_INTERVAL = "4h";
const MARK_INTERVAL_MS = 4 * 60 * 60 * 1_000;
export const DEFAULT_FUNDING_MARK_MAX_AGE_MS = MARK_INTERVAL_MS;
export const MAX_FUNDING_MARK_PAGES = 10;
export const MAX_FUNDING_MARK_CANDLES = MAX_FUNDING_MARK_PAGES * 100;
export const MAX_FUNDING_HISTORY_RANGE_MS = MAX_FUNDING_MARK_CANDLES * MARK_INTERVAL_MS;

export interface HistoricalFundingRequest {
  market: Market;
  symbol: string;
  startTime: number;
  endTime: number;
  strict?: boolean;
  maxMarkAgeMs?: number;
}

export interface HistoricalFundingCoverage {
  requestedStartTime: number;
  requestedEndTime: number;
  returnedFundingStartTime?: number;
  returnedFundingEndTime?: number;
  fundingRangeCovered: boolean;
  requestedEvents: number;
  matchedEvents: number;
  missingMarkTimestamps: readonly number[];
}

export interface HistoricalFundingDataset {
  request: Readonly<HistoricalFundingRequest>;
  funding: readonly FundingEvent[];
  complete: boolean;
  coverage: HistoricalFundingCoverage;
  provenance: {
    provider: "WEEX";
    sourceKind: "public-api";
    fundingEndpoint: typeof FUNDING_ENDPOINT;
    markEndpoint: typeof MARK_ENDPOINT;
    priceType: "MARK";
    collectedAt: number;
    fundingLimit: typeof FUNDING_LIMIT;
    markMaxAgeMs: number;
    markPages: number;
    markCandles: number;
    truncated: boolean;
    terminationReason?: "mark-page-limit" | "mark-candle-limit";
  };
}

interface RawFundingEvent {
  timestamp: number;
  rate: string;
}

const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_MARK_PAGE_ROWS = 100;
const MAX_NUMERIC_STRING_LENGTH = 128;

function validationError(message: string): WeexApiError {
  return new WeexApiError(message, { category: "validation", retryable: false });
}

function schemaError(message: string): WeexApiError {
  return new WeexApiError(message, { category: "schema", retryable: false });
}

function normalizeFundingSymbols(symbol: string): { v2: string; v3: string } {
  if (typeof symbol !== "string" || symbol.length > 34) throw validationError("Invalid futures symbol");
  const normalized = symbol.toLowerCase();
  const core = normalized.startsWith("cmt_") ? normalized.slice(4) : normalized;
  if (!/^[a-z0-9]{4,30}$/.test(core)) throw validationError("Invalid futures symbol");
  return { v2: `cmt_${core}`, v3: core.toUpperCase() };
}

function validateFundingRequest(
  request: HistoricalFundingRequest,
  nowMs: number,
): { symbols: { v2: string; v3: string }; maxMarkAgeMs: number } {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw validationError("Invalid clock snapshot");
  if (request.market !== "futures") throw validationError("Funding history is available only for futures");
  const symbols = normalizeFundingSymbols(request.symbol);
  if (!Number.isSafeInteger(request.startTime) || request.startTime < 0 ||
      !Number.isSafeInteger(request.endTime) || request.endTime <= request.startTime || request.endTime > nowMs) {
    throw validationError("Invalid funding history range");
  }
  if (request.endTime - request.startTime > MAX_FUNDING_HISTORY_RANGE_MS) {
    throw validationError("Funding history range exceeds the safe collection limit");
  }
  const maxMarkAgeMs = request.maxMarkAgeMs ?? DEFAULT_FUNDING_MARK_MAX_AGE_MS;
  if (!Number.isSafeInteger(maxMarkAgeMs) || maxMarkAgeMs <= 0 || maxMarkAgeMs > MAX_FUNDING_HISTORY_RANGE_MS) {
    throw validationError("Invalid funding MARK maximum age");
  }
  if (request.endTime > Number.MAX_SAFE_INTEGER - maxMarkAgeMs) throw validationError("Unsafe funding history range");
  return { symbols, maxMarkAgeMs };
}

function parseFundingRows(body: unknown, expectedSymbol: string): RawFundingEvent[] {
  if (!Array.isArray(body)) throw schemaError("Invalid funding history collection");
  if (body.length > FUNDING_LIMIT) throw schemaError("Funding history exceeds the documented limit");
  const byTime = new Map<number, RawFundingEvent>();
  for (const [index, value] of body.entries()) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw schemaError(`Invalid funding history row at ${index}`);
    }
    const row = value as Record<string, unknown>;
    const keys = Object.keys(row).sort();
    if (keys.length !== 3 || keys[0] !== "fundingRate" || keys[1] !== "fundingTime" || keys[2] !== "symbol") {
      throw schemaError(`Invalid funding history fields at ${index}`);
    }
    if (typeof row.symbol !== "string" || row.symbol.length > 34 || row.symbol !== expectedSymbol) {
      throw schemaError(`Unexpected funding symbol at ${index}`);
    }
    if (typeof row.fundingRate !== "string" || row.fundingRate.length > MAX_NUMERIC_STRING_LENGTH ||
        !SIGNED_DECIMAL.test(row.fundingRate)) {
      throw schemaError(`Invalid funding rate at ${index}`);
    }
    const timestamp = typeof row.fundingTime === "number"
      ? row.fundingTime
      : typeof row.fundingTime === "string" && row.fundingTime.length <= 16 && /^\d+$/.test(row.fundingTime)
        ? Number(row.fundingTime) : NaN;
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw schemaError(`Invalid funding time at ${index}`);
    const current = byTime.get(timestamp);
    if (current && current.rate !== row.fundingRate) throw schemaError(`Conflicting funding rows at ${timestamp}`);
    byTime.set(timestamp, { timestamp, rate: row.fundingRate });
  }
  return [...byTime.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function preflightMarkRows(body: unknown): unknown[] {
  if (!Array.isArray(body)) throw schemaError("Invalid MARK candle collection");
  if (body.length > MAX_MARK_PAGE_ROWS) throw schemaError("MARK candle page exceeds the documented limit");
  for (const [index, row] of body.entries()) {
    if (!Array.isArray(row)) continue;
    for (const field of [1, 2, 3, 4, 5, 7, 9, 10]) {
      const value = row[field];
      if (typeof value === "string" && value.length > MAX_NUMERIC_STRING_LENGTH) {
        throw schemaError(`MARK numeric field exceeds the safe length at row ${index}`);
      }
    }
    for (const field of [0, 6]) {
      const value = row[field];
      if (typeof value === "string" && value.length > 16) {
        throw schemaError(`MARK timestamp exceeds the safe length at row ${index}`);
      }
    }
  }
  return body;
}

function mergeMarkCandles(candles: readonly Candle[]): Candle[] {
  const byOpenTime = new Map<number, Candle>();
  for (const candle of candles) {
    const current = byOpenTime.get(candle.openTime);
    if (current && (current.closeTime !== candle.closeTime || current.close !== candle.close)) {
      throw schemaError(`Conflicting MARK candles at ${candle.openTime}`);
    }
    byOpenTime.set(candle.openTime, candle);
  }
  return [...byOpenTime.values()].sort((left, right) => left.closeTime - right.closeTime);
}

function validateRequest(request: HistoricalCandleRequest): void {
  if (!request.symbol || !request.interval) {
    throw new WeexApiError("Symbol and interval are required", { category: "validation", retryable: false });
  }
  parseIntervalMs(request.interval);
  for (const value of [request.startTime, request.endTime]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new WeexApiError("Invalid historical timestamp", { category: "validation", retryable: false });
    }
  }
  if (request.startTime !== undefined && request.endTime !== undefined && request.endTime <= request.startTime) {
    throw new WeexApiError("Historical endTime must be after startTime", { category: "validation", retryable: false });
  }
  if (request.market === "futures" && request.limit !== undefined &&
      (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100)) {
    throw new WeexApiError("Futures history limit must be between 1 and 100", { category: "validation", retryable: false });
  }
  if (request.market === "futures" && request.startTime !== undefined && request.endTime !== undefined &&
      request.endTime - request.startTime > MAX_FUTURES_HISTORY_RANGE_MS) {
    throw new WeexApiError("Futures history range exceeds the safe collection limit", {
      category: "validation", retryable: false,
    });
  }
}

function candleUrl(request: HistoricalCandleRequest): string {
  validateRequest(request);
  const endpoint = ENDPOINTS[request.market];
  const query = new URLSearchParams({ symbol: request.symbol, interval: request.interval });
  if (request.market === "futures") {
    if (request.startTime !== undefined) query.set("startTime", String(request.startTime));
    if (request.endTime !== undefined) query.set("endTime", String(request.endTime));
    query.set("limit", String(request.limit ?? 100));
  }
  return `${endpoint.origin}${endpoint.path}?${query}`;
}

export function validateCandleDataset(candles: readonly Candle[], intervalMs: number): DatasetValidation {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new TypeError("intervalMs must be a positive safe integer");
  }
  const duplicates: number[] = [];
  const seen = new Set<number>();
  let ordered = true;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    if (seen.has(candle.openTime) && !duplicates.includes(candle.openTime)) duplicates.push(candle.openTime);
    seen.add(candle.openTime);
    if (index > 0 && candles[index - 1]!.openTime > candle.openTime) ordered = false;
  }
  const uniqueTimes = [...seen].sort((left, right) => left - right);
  const gaps: { from: number; to: number }[] = [];
  for (let index = 1; index < uniqueTimes.length; index += 1) {
    const expected = uniqueTimes[index - 1]! + intervalMs;
    if (uniqueTimes[index]! > expected) gaps.push({ from: expected, to: uniqueTimes[index]! - 1 });
  }
  return {
    duplicates: duplicates.sort((left, right) => left - right),
    ordered,
    gaps,
    incompleteCount: candles.filter((candle) => !candle.complete).length,
  };
}

function mergeCandles(candles: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of candles) byTime.set(candle.openTime, candle);
  return [...byTime.values()].sort((left, right) => left.openTime - right.openTime);
}

export class WeexPublicClient {
  constructor(
    private readonly transport: HttpTransport,
    private readonly now: () => number = Date.now,
  ) {}

  async fetchCandles(request: HistoricalCandleRequest): Promise<readonly Candle[]> {
    const response = await this.transport.send({
      method: "GET",
      url: candleUrl(request),
      headers: { Accept: "application/json" },
    });
    return request.market === "spot"
      ? parseSpotCandleRows(response.body, this.now())
      : parseFuturesCandleRows(response.body, this.now());
  }

  async collectHistoricalCandles(request: HistoricalCandleRequest): Promise<HistoricalDataset> {
    validateRequest(request);
    const intervalMs = parseIntervalMs(request.interval);
    const collected: Candle[] = [];
    let paginated = false;
    let terminationReason: "page-limit" | "candle-limit" | undefined;

    if (request.market === "spot") {
      collected.push(...await this.fetchCandles(request));
    } else {
      let cursor = request.startTime;
      let pageCount = 0;
      do {
        if (pageCount >= MAX_FUTURES_HISTORY_PAGES) {
          terminationReason = "page-limit";
          break;
        }
        const page = await this.fetchCandles({ ...request, startTime: cursor });
        pageCount += 1;
        const remainingCapacity = MAX_FUTURES_HISTORY_CANDLES - collected.length;
        collected.push(...page.slice(0, remainingCapacity));
        if (page.length > remainingCapacity || collected.length >= MAX_FUTURES_HISTORY_CANDLES) {
          terminationReason = "candle-limit";
          break;
        }
        if (page.length === 0 || request.endTime === undefined) break;
        const maximumOpenTime = Math.max(...page.map((candle) => candle.openTime));
        const nextCursor = maximumOpenTime + intervalMs;
        if (cursor !== undefined && nextCursor <= cursor) break;
        cursor = nextCursor;
        if (cursor >= request.endTime) break;
        paginated = true;
        if (page.length < (request.limit ?? 100)) break;
      } while (true);
    }

    const validation = validateCandleDataset(collected, intervalMs);
    const candles = mergeCandles(collected).filter((candle) => candle.complete);
    const first = candles[0]?.openTime;
    const last = candles.at(-1)?.openTime;
    const boundariesCovered = request.startTime !== undefined && request.endTime !== undefined &&
      first !== undefined && last !== undefined && first <= request.startTime && last + intervalMs >= request.endTime;
    const complete = request.market === "futures" && terminationReason === undefined && boundariesCovered && validation.gaps.length === 0 &&
      validation.incompleteCount === 0;
    const endpoint = ENDPOINTS[request.market].path;
    return {
      request: { ...request },
      candles,
      intervalMs,
      complete,
      validation,
      provenance: {
        provider: "WEEX",
        sourceKind: "public-api",
        endpoint,
        collectedAt: this.now(),
        singleResponse: request.market === "spot" || !paginated,
        paginated,
        truncated: terminationReason !== undefined,
        ...(terminationReason === undefined ? {} : { terminationReason }),
        ...(request.startTime === undefined ? {} : { requestedStartTime: request.startTime }),
        ...(request.endTime === undefined ? {} : { requestedEndTime: request.endTime }),
        ...(first === undefined ? {} : { returnedStartTime: first }),
        ...(last === undefined ? {} : { returnedEndTime: last + intervalMs }),
      },
    };
  }

  async collectHistoricalFunding(request: HistoricalFundingRequest): Promise<HistoricalFundingDataset> {
    const nowMs = this.now();
    const { symbols, maxMarkAgeMs } = validateFundingRequest(request, nowMs);
    const fundingUrl = new URL(FUNDING_ENDPOINT, FUTURES_ORIGIN);
    fundingUrl.searchParams.set("symbol", symbols.v2);
    fundingUrl.searchParams.set("limit", String(FUNDING_LIMIT));
    const fundingResponse = await this.transport.send({
      method: "GET",
      url: fundingUrl.toString(),
      headers: { Accept: "application/json" },
    });
    const allFunding = parseFundingRows(fundingResponse.body, symbols.v2);
    const returnedFundingStartTime = allFunding[0]?.timestamp;
    const returnedFundingEndTime = allFunding.at(-1)?.timestamp;
    // A full latest-100 response whose first event is newer than the requested
    // boundary cannot prove the omitted older portion. A shorter response is
    // treated as the complete exchange history available from this endpoint.
    const fundingRangeCovered = allFunding.length < FUNDING_LIMIT ||
      (returnedFundingStartTime !== undefined && returnedFundingStartTime <= request.startTime);
    const requestedFunding = allFunding.filter(({ timestamp }) =>
      timestamp >= request.startTime && timestamp < request.endTime);

    const markCandles: Candle[] = [];
    let markPages = 0;
    let cursor = Math.max(0, request.startTime - maxMarkAgeMs);
    let terminationReason: "mark-page-limit" | "mark-candle-limit" | undefined;
    while (requestedFunding.length > 0 && cursor < request.endTime) {
      if (markPages >= MAX_FUNDING_MARK_PAGES) {
        terminationReason = "mark-page-limit";
        break;
      }
      const markUrl = new URL(MARK_ENDPOINT, FUTURES_ORIGIN);
      markUrl.searchParams.set("symbol", symbols.v3);
      markUrl.searchParams.set("interval", MARK_INTERVAL);
      markUrl.searchParams.set("startTime", String(cursor));
      markUrl.searchParams.set("endTime", String(request.endTime));
      markUrl.searchParams.set("limit", "100");
      markUrl.searchParams.set("priceType", "MARK");
      const response = await this.transport.send({
        method: "GET",
        url: markUrl.toString(),
        headers: { Accept: "application/json" },
      });
      const page = parseFuturesCandleRows(preflightMarkRows(response.body), nowMs);
      markPages += 1;
      const capacity = MAX_FUNDING_MARK_CANDLES - markCandles.length;
      markCandles.push(...page.slice(0, capacity));
      if (page.length > capacity || markCandles.length >= MAX_FUNDING_MARK_CANDLES) {
        terminationReason = "mark-candle-limit";
        break;
      }
      if (page.length < 100) break;
      const maximumOpenTime = Math.max(...page.map(({ openTime }) => openTime));
      const nextCursor = maximumOpenTime + MARK_INTERVAL_MS;
      if (!Number.isSafeInteger(nextCursor) || nextCursor <= cursor) break;
      cursor = nextCursor;
    }

    const marks = mergeMarkCandles(markCandles);
    const missingMarkTimestamps: number[] = [];
    const funding: FundingEvent[] = [];
    for (const event of requestedFunding) {
      let candidate: Candle | undefined;
      for (const candle of marks) {
        if (candle.closeTime > event.timestamp) break;
        candidate = candle;
      }
      if (!candidate || event.timestamp - candidate.closeTime > maxMarkAgeMs) {
        missingMarkTimestamps.push(event.timestamp);
        continue;
      }
      funding.push({ timestamp: event.timestamp, rate: event.rate, markPrice: candidate.close });
    }

    const complete = fundingRangeCovered && terminationReason === undefined &&
      missingMarkTimestamps.length === 0 && funding.length === requestedFunding.length;
    const result: HistoricalFundingDataset = {
      request: { ...request },
      funding,
      complete,
      coverage: {
        requestedStartTime: request.startTime,
        requestedEndTime: request.endTime,
        ...(returnedFundingStartTime === undefined ? {} : { returnedFundingStartTime }),
        ...(returnedFundingEndTime === undefined ? {} : { returnedFundingEndTime }),
        fundingRangeCovered,
        requestedEvents: requestedFunding.length,
        matchedEvents: funding.length,
        missingMarkTimestamps,
      },
      provenance: {
        provider: "WEEX",
        sourceKind: "public-api",
        fundingEndpoint: FUNDING_ENDPOINT,
        markEndpoint: MARK_ENDPOINT,
        priceType: "MARK",
        collectedAt: nowMs,
        fundingLimit: FUNDING_LIMIT,
        markMaxAgeMs: maxMarkAgeMs,
        markPages,
        markCandles: marks.length,
        truncated: terminationReason !== undefined,
        ...(terminationReason === undefined ? {} : { terminationReason }),
      },
    };
    if (request.strict && !complete) throw validationError("Incomplete WEEX funding history coverage");
    return result;
  }

  getInstrumentRules(market: Market, symbol: string): Promise<InstrumentRules> {
    return fetchInstrumentRules(this.transport, market, symbol);
  }
}
