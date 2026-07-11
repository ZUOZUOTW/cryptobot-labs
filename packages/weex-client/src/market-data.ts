import type {
  Candle,
  DatasetValidation,
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

    if (request.market === "spot") {
      collected.push(...await this.fetchCandles(request));
    } else {
      let cursor = request.startTime;
      do {
        const page = await this.fetchCandles({ ...request, startTime: cursor });
        collected.push(...page);
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
    const complete = request.market === "futures" && boundariesCovered && validation.gaps.length === 0 &&
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
        ...(request.startTime === undefined ? {} : { requestedStartTime: request.startTime }),
        ...(request.endTime === undefined ? {} : { requestedEndTime: request.endTime }),
        ...(first === undefined ? {} : { returnedStartTime: first }),
        ...(last === undefined ? {} : { returnedEndTime: last + intervalMs }),
      },
    };
  }

  getInstrumentRules(market: Market, symbol: string): Promise<InstrumentRules> {
    return fetchInstrumentRules(this.transport, market, symbol);
  }
}
