import type { BacktestJobCreateDto } from "../control-plane/types";
import { parseBacktestJobCreateDto, safeCanonicalJsonStringify } from "../control-plane/schemas";
import type { BotConfig } from "../types";
import { createVisualHistoricalEvaluator } from "../historical-strategy";
import type { ApiAuthDependencies } from "./auth";
import { requireApiUser } from "./auth";
import { HttpProblem, errorResponse, jsonResponse, readStrictJson } from "./http";
import type { OriginPolicy } from "./origin";
import { requireSameOrigin } from "./origin";
import type {
  BacktestCursor, BacktestDetailRecord, BacktestJobRecord, BacktestStatus, OwnedStrategyVersionRecord,
} from "../../db/repositories";
import type { HistoricalDataset, HistoricalBacktestResult } from "../../packages/trading-core/src";
import { runHistoricalBacktest } from "../../packages/trading-core/src";
import type { HistoricalFundingDataset } from "../../packages/weex-client/src";
import {
  DEFAULT_FUNDING_MARK_MAX_AGE_MS, FUNDING_HISTORY_LIMIT, FUNDING_MARK_PAGE_SIZE,
  MAX_FUNDING_MARK_CANDLES, MAX_FUNDING_MARK_PAGES, MAX_FUTURES_HISTORY_CANDLES,
  MAX_FUTURES_HISTORY_RANGE_MS, MAX_SPOT_HISTORY_CANDLES, parseIntervalMs, validateCandleDataset,
} from "../../packages/weex-client/src";

export const HISTORICAL_ENGINE_VERSION = "cryptobot-labs-historical-v1";
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const DATA_ENDPOINTS = {
  spot: "/api/v3/market/klines",
  futures: "/capi/v3/market/historyKlines",
} as const;
const MAINTENANCE_MARGIN_RATE = { spot: "0", futures: "0.02" } as const;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

type BacktestRepository = {
  createIdempotent(input: { id: string; idempotencyId: string; idempotencyKey: string; requestHash: string;
    userId: string; request: BacktestJobCreateDto; now: number }): Promise<{ job: BacktestJobRecord; idempotent: boolean }>;
  advanceStatus(userId: string, jobId: string, expected: BacktestStatus, next: BacktestStatus, now: number): Promise<BacktestJobRecord | null>;
  fail(userId: string, jobId: string, expected: BacktestStatus,
    input: { code: string; message: string; completedAt: number }): Promise<BacktestJobRecord | null>;
  completeSuccess(userId: string, jobId: string, input: {
    completedAt: number;
    dataset: { id: string; market: "spot" | "futures"; symbol: string; interval: string; source: string;
      requestedStartAt: number; requestedEndAt: number; actualStartAt: number | null; actualEndAt: number | null;
      complete: boolean; gaps: unknown; checksum: string; createdAt: number };
    result: { id: string; initialCapital: string; feeRate: string; slippageRate: string; leverage: string;
      funding: unknown; metrics: unknown; provenance: unknown; equityCurve: unknown; engineVersion: string;
      configurationHash: string; strategyHash: string; scriptHash: string | null; createdAt: number };
  }): Promise<{ job: BacktestJobRecord; idempotent: boolean }>;
  getDetail(userId: string, jobId: string): Promise<BacktestDetailRecord | null>;
  list(userId: string, options: { limit: number; cursor?: BacktestCursor }): Promise<{
    items: BacktestJobRecord[]; nextCursor: BacktestCursor | null;
  }>;
};

type StrategyRepository = { getOwned(userId: string, strategyVersionId: string): Promise<OwnedStrategyVersionRecord | null> };
type PublicMarketClient = {
  collectHistoricalCandles(request: BacktestJobCreateDto, signal?: AbortSignal): Promise<HistoricalDataset>;
  collectHistoricalFunding(request: { market: "futures"; symbol: string; startTime: number; endTime: number;
    strict: true }, signal?: AbortSignal): Promise<HistoricalFundingDataset>;
};

export interface HistoricalBacktestService {
  create(userId: string, idempotencyKey: string, request: BacktestJobCreateDto, signal?: AbortSignal): Promise<{
    job: BacktestDetailRecord | BacktestJobRecord; idempotent: boolean;
  }>;
  get(userId: string, jobId: string): Promise<BacktestDetailRecord | null>;
  list(userId: string, options: { limit: number; cursor?: BacktestCursor }): Promise<{
    items: BacktestJobRecord[]; nextCursor: BacktestCursor | null;
  }>;
}

export class HistoricalBacktestProblem extends Error {
  constructor(readonly status: number, readonly code: string, message = code) {
    super(message);
    this.name = "HistoricalBacktestProblem";
  }
}

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const safeTime = (now: () => number): number => {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("clock returned invalid time");
  return value;
};

const assertId = (value: string, label: string): string => {
  if (!ID.test(value)) throw new Error(`${label} generator returned invalid id`);
  return value;
};

const parseStoredConfig = async (version: OwnedStrategyVersionRecord): Promise<{
  config: BotConfig; configHash: string; strategyHash: string;
}> => {
  if (typeof version.configJson !== "string" || version.configJson.length > 262_144
    || !HASH.test(version.configHash)) throw new HistoricalBacktestProblem(500, "strategy_integrity_failed");
  if (version.sourceCode !== null || version.sourceHash !== null) {
    throw new HistoricalBacktestProblem(422, "custom_strategy_runtime_unavailable");
  }
  let candidate: unknown;
  try { candidate = JSON.parse(version.configJson); }
  catch { throw new HistoricalBacktestProblem(500, "strategy_integrity_failed"); }
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new HistoricalBacktestProblem(500, "strategy_integrity_failed");
  }
  const config = candidate as BotConfig;
  if (Object.hasOwn(config as object, "source")) {
    throw new HistoricalBacktestProblem(422, "custom_strategy_runtime_unavailable");
  }
  // Creating the evaluator is also the authoritative strict BotConfig validation.
  try { createVisualHistoricalEvaluator(config); }
  catch { throw new HistoricalBacktestProblem(422, "invalid_strategy_configuration"); }
  const canonical = safeCanonicalJsonStringify(config, "strategy configuration", 262_144);
  const actualHash = await sha256(canonical);
  if (actualHash !== version.configHash) throw new HistoricalBacktestProblem(500, "strategy_integrity_failed");
  return { config, configHash: actualHash, strategyHash: actualHash };
};

const assertRequestMatches = (request: BacktestJobCreateDto, version: OwnedStrategyVersionRecord, config: BotConfig): void => {
  if (request.market !== version.market || request.market !== config.market
    || request.symbol !== version.symbol || request.symbol !== config.symbol
    || request.interval !== config.timeframe || Number(request.leverage) !== config.leverage) {
    throw new HistoricalBacktestProblem(422, "strategy_request_mismatch");
  }
  if (request.fundingMode === "historical" && request.market !== "futures") {
    throw new HistoricalBacktestProblem(422, "historical_funding_requires_futures");
  }
};

const decimalNumber = (value: string, label: string): number => {
  if (typeof value !== "string" || value.length > 32 || !DECIMAL.test(value)) {
    throw new HistoricalBacktestProblem(422, "invalid_economic_parameters", label);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HistoricalBacktestProblem(422, "invalid_economic_parameters", label);
  return parsed;
};

const assertEconomics = (request: BacktestJobCreateDto): void => {
  const capital = decimalNumber(request.initialCapital, "initialCapital");
  const fee = decimalNumber(request.feeRate, "feeRate");
  const slippage = decimalNumber(request.slippageRate, "slippageRate");
  const leverage = decimalNumber(request.leverage, "leverage");
  if (capital <= 0 || capital > 100_000_000 || fee < 0 || fee > 0.05 || slippage < 0 || slippage > 0.1
    || leverage <= 0 || leverage > 20 || (request.market === "spot" && leverage !== 1)
    || leverage * fee >= 1) {
    throw new HistoricalBacktestProblem(422, "invalid_economic_parameters");
  }
};

const assertRange = (request: BacktestJobCreateDto, now: number): void => {
  if (request.startTime < 0 || request.endTime > now) throw new HistoricalBacktestProblem(422, "invalid_historical_range");
  let intervalMs: number;
  try { intervalMs = parseIntervalMs(request.interval); }
  catch { throw new HistoricalBacktestProblem(422, "invalid_historical_interval"); }
  const range = request.endTime - request.startTime;
  const maximumCandles = Math.min(2_000,
    request.market === "futures" ? MAX_FUTURES_HISTORY_CANDLES : MAX_SPOT_HISTORY_CANDLES);
  if ((request.market === "futures" && range > MAX_FUTURES_HISTORY_RANGE_MS)
    || !Number.isSafeInteger(range / intervalMs) || range / intervalMs > maximumCandles || range < intervalMs * 2) {
    throw new HistoricalBacktestProblem(422, "invalid_historical_range");
  }
};

const normalizeDataset = (dataset: HistoricalDataset, request: BacktestJobCreateDto): HistoricalDataset => {
  const intervalMs = parseIntervalMs(request.interval);
  const endpoint = DATA_ENDPOINTS[request.market];
  const provenance = dataset?.provenance;
  const requestMatches = dataset?.request?.market === request.market && dataset.request.symbol === request.symbol
    && dataset.request.interval === request.interval && dataset.request.startTime === request.startTime
    && dataset.request.endTime === request.endTime;
  const provenanceMatches = provenance?.provider === "WEEX" && provenance.sourceKind === "public-api"
    && provenance.endpoint === endpoint && provenance.requestedStartTime === request.startTime
    && provenance.requestedEndTime === request.endTime && typeof provenance.singleResponse === "boolean"
    && typeof provenance.paginated === "boolean" && provenance.singleResponse !== provenance.paginated
    && provenance.truncated === false && provenance.terminationReason === undefined
    && Number.isSafeInteger(provenance.collectedAt) && provenance.collectedAt >= 0
    && Number.isSafeInteger(provenance.returnedStartTime) && provenance.returnedStartTime! <= request.startTime
    && Number.isSafeInteger(provenance.returnedEndTime) && provenance.returnedEndTime! >= request.endTime;
  if (!requestMatches || !provenanceMatches || dataset.intervalMs !== intervalMs || !Array.isArray(dataset.candles)) {
    throw new HistoricalBacktestProblem(422, "historical_dataset_incomplete");
  }
  const candles = dataset.candles.filter(({ openTime }) => openTime >= request.startTime && openTime < request.endTime)
    .map((candle) => ({ ...candle }));
  if (candles.length < 2 || candles.length > (request.market === "spot" ? MAX_SPOT_HISTORY_CANDLES : MAX_FUTURES_HISTORY_CANDLES)
    || candles.some(({ openTime, closeTime }) => (openTime - request.startTime) % intervalMs !== 0
      || closeTime !== openTime + intervalMs - 1 || closeTime >= request.endTime)) {
    throw new HistoricalBacktestProblem(422, "historical_dataset_incomplete");
  }
  const validation = validateCandleDataset(candles, intervalMs);
  const stepAligned = candles.every((candle, index) => index === 0 || (() => {
    const delta = candle.openTime - candles[index - 1]!.openTime;
    return delta === intervalMs || (request.gapPolicy === "disclose" && delta > intervalMs && delta % intervalMs === 0);
  })());
  const first = candles[0]?.openTime;
  const last = candles.at(-1)?.closeTime;
  const exactCoverage = first === request.startTime && last === request.endTime - 1 && stepAligned
    && validation.ordered && validation.duplicates.length === 0 && validation.incompleteCount === 0;
  const complete = exactCoverage && validation.gaps.length === 0;
  if (!exactCoverage || (request.gapPolicy === "fail" && !complete)) {
    throw new HistoricalBacktestProblem(422, "historical_dataset_incomplete");
  }
  return {
    request: { market: request.market, symbol: request.symbol, interval: request.interval,
      startTime: request.startTime, endTime: request.endTime },
    candles, intervalMs, complete, validation,
    provenance: { ...provenance, endpoint, requestedStartTime: request.startTime, requestedEndTime: request.endTime,
      returnedStartTime: first, returnedEndTime: last + 1 },
  };
};

const normalizeFunding = (dataset: HistoricalFundingDataset, request: BacktestJobCreateDto): HistoricalFundingDataset => {
  const provenance = dataset?.provenance;
  const coverage = dataset?.coverage;
  const events = Array.isArray(dataset?.funding) ? dataset.funding : null;
  const exactRequest = dataset?.request?.market === "futures" && dataset.request.symbol === request.symbol
    && dataset.request.startTime === request.startTime && dataset.request.endTime === request.endTime
    && dataset.request.strict === true;
  const exactProvenance = provenance?.provider === "WEEX" && provenance.sourceKind === "public-api"
    && provenance.fundingEndpoint === "/capi/v2/market/getHistoryFundRate"
    && provenance.markEndpoint === "/capi/v3/market/historyKlines" && provenance.priceType === "MARK"
    && provenance.truncated === false && provenance.terminationReason === undefined
    && Number.isSafeInteger(provenance.collectedAt) && provenance.collectedAt >= 0
    && provenance.fundingLimit === FUNDING_HISTORY_LIMIT
    && Number.isSafeInteger(provenance.markPages) && provenance.markPages >= 0
    && provenance.markPages <= MAX_FUNDING_MARK_PAGES
    && Number.isSafeInteger(provenance.markCandles) && provenance.markCandles >= 0
    && provenance.markCandles <= MAX_FUNDING_MARK_CANDLES
    && provenance.markCandles <= provenance.markPages * FUNDING_MARK_PAGE_SIZE
    && Number.isSafeInteger(provenance.markMaxAgeMs) && provenance.markMaxAgeMs > 0
    && provenance.markMaxAgeMs <= DEFAULT_FUNDING_MARK_MAX_AGE_MS;
  const exactCoverage = coverage?.requestedStartTime === request.startTime && coverage.requestedEndTime === request.endTime
    && coverage.fundingRangeCovered === true && Array.isArray(coverage.missingMarkTimestamps)
    && coverage.missingMarkTimestamps.length === 0 && Number.isSafeInteger(coverage.requestedEvents)
    && coverage.requestedEvents >= 0 && events !== null && coverage.matchedEvents === events.length
    && coverage.requestedEvents === coverage.matchedEvents;
  const markCollectionConsistent = events !== null && (events.length === 0
    ? provenance?.markPages === 0 && provenance.markCandles === 0
    : (provenance?.markPages ?? 0) > 0 && (provenance?.markCandles ?? 0) > 0);
  const eventsValid = events !== null && events.length <= FUNDING_HISTORY_LIMIT
    && events.every((event, index) => event !== null && typeof event === "object"
      && Number.isSafeInteger(event.timestamp) && event.timestamp >= request.startTime && event.timestamp < request.endTime
      && (index === 0 || event.timestamp > events[index - 1]!.timestamp)
      && typeof event.rate === "string" && event.rate.length <= 128 && SIGNED_DECIMAL.test(event.rate)
      && typeof event.markPrice === "string" && event.markPrice.length <= 128
      && DECIMAL.test(event.markPrice) && Number(event.markPrice) > 0);
  if (!exactRequest || !exactProvenance || !exactCoverage || !markCollectionConsistent
    || !eventsValid || dataset.complete !== true) {
    throw new HistoricalBacktestProblem(422, "historical_funding_incomplete");
  }
  return dataset;
};

const failureClass = (error: unknown, phase: BacktestStatus): { code: string; message: string; httpStatus: number } => {
  if (error instanceof HistoricalBacktestProblem) {
    return { code: error.code.slice(0, 64), message: error.code.slice(0, 512), httpStatus: error.status };
  }
  return phase === "fetching-data"
    ? { code: "data_fetch_failed", message: "WEEX public historical data could not be collected.", httpStatus: 502 }
    : { code: "backtest_execution_failed", message: "The historical backtest could not be completed.", httpStatus: 422 };
};

const publicDetail = (record: BacktestDetailRecord): Record<string, unknown> => ({
  id: record.id, strategyVersionId: record.strategyVersionId, status: record.status,
  evidenceLevel: record.evidenceLevel, request: JSON.parse(record.requestJson),
  error: record.errorCode === null ? null : { code: record.errorCode, message: record.errorMessage },
  createdAt: record.createdAt, startedAt: record.startedAt, completedAt: record.completedAt,
  dataset: record.datasetId === null ? null : {
    id: record.datasetId, market: record.datasetMarket, symbol: record.datasetSymbol, interval: record.datasetInterval,
    source: record.datasetSource, requestedStartAt: record.requestedStartAt, requestedEndAt: record.requestedEndAt,
    actualStartAt: record.actualStartAt, actualEndAt: record.actualEndAt, complete: record.datasetComplete === 1,
    gaps: JSON.parse(record.gapsJson!), checksum: record.checksum,
  },
  result: record.resultId === null ? null : {
    id: record.resultId, funding: JSON.parse(record.fundingJson!), metrics: JSON.parse(record.metricsJson!),
    provenance: JSON.parse(record.provenanceJson!), equityCurve: JSON.parse(record.equityCurveJson!),
    engineVersion: record.engineVersion, configurationHash: record.configurationHash,
    strategyHash: record.strategyHash, scriptHash: record.scriptHash,
  },
});

const publicSummary = (record: BacktestJobRecord): Record<string, unknown> => ({
  id: record.id,
  strategyVersionId: record.strategyVersionId,
  status: record.status,
  evidenceLevel: record.evidenceLevel,
  request: JSON.parse(record.requestJson),
  error: record.errorCode === null ? null : { code: record.errorCode, message: record.errorMessage },
  createdAt: record.createdAt,
  startedAt: record.startedAt,
  completedAt: record.completedAt,
});

export function createHistoricalBacktestService(dependencies: {
  backtests: BacktestRepository; strategies: StrategyRepository; marketData: PublicMarketClient;
  now(): number; newId(prefix: "job" | "idem" | "dataset" | "result"): string;
}): HistoricalBacktestService {
  return {
    async create(userId, idempotencyKey, candidate, signal) {
      signal?.throwIfAborted();
      if (!ID.test(userId) || !IDEMPOTENCY_KEY.test(idempotencyKey)) throw new HistoricalBacktestProblem(400, "invalid_request");
      let request: BacktestJobCreateDto;
      try { request = parseBacktestJobCreateDto(candidate); }
      catch { throw new HistoricalBacktestProblem(400, "invalid_request"); }
      const now = safeTime(dependencies.now);
      assertEconomics(request);
      assertRange(request, now);
      const version = await dependencies.strategies.getOwned(userId, request.strategyVersionId);
      signal?.throwIfAborted();
      if (!version) throw new HistoricalBacktestProblem(404, "not_found");
      const integrity = await parseStoredConfig(version);
      assertRequestMatches(request, version, integrity.config);
      const requestHash = await sha256(safeCanonicalJsonStringify(request, "backtest request", 32_768));
      let created: { job: BacktestJobRecord; idempotent: boolean };
      try {
        created = await dependencies.backtests.createIdempotent({
          id: assertId(dependencies.newId("job"), "job"),
          idempotencyId: assertId(dependencies.newId("idem"), "idempotency"), idempotencyKey,
          requestHash, userId, request, now,
        });
      } catch (error) {
        if (error instanceof Error && /idempotency key request conflict/i.test(error.message)) {
          throw new HistoricalBacktestProblem(409, "conflict");
        }
        throw error;
      }
      if (created.idempotent) {
        return { job: await dependencies.backtests.getDetail(userId, created.job.id) ?? created.job, idempotent: true };
      }

      let phase: BacktestStatus = "fetching-data";
      const fetching = await dependencies.backtests.advanceStatus(userId, created.job.id, "queued", phase, now);
      if (!fetching) throw new Error("new backtest could not enter fetching-data state");
      try {
        signal?.throwIfAborted();
        const dataset = normalizeDataset(await dependencies.marketData.collectHistoricalCandles(request, signal), request);
        signal?.throwIfAborted();
        let funding: HistoricalFundingDataset | null = null;
        if (request.fundingMode === "historical") {
          funding = normalizeFunding(await dependencies.marketData.collectHistoricalFunding({ market: "futures", symbol: request.symbol,
            startTime: request.startTime, endTime: request.endTime, strict: true }, signal), request);
        }
        signal?.throwIfAborted();
        phase = "running";
        if (!await dependencies.backtests.advanceStatus(userId, created.job.id, "fetching-data", phase, safeTime(dependencies.now))) {
          throw new Error("backtest could not enter running state");
        }
        // Evaluators are stateful by design; every run receives a fresh instance.
        const evaluator = createVisualHistoricalEvaluator(integrity.config);
        const result: HistoricalBacktestResult = await runHistoricalBacktest({ dataset, evaluator,
          initialCapital: request.initialCapital, feeRate: request.feeRate, slippageRate: request.slippageRate,
          leverage: request.leverage, funding: funding?.funding ?? [], gapPolicy: request.gapPolicy,
          maintenanceMarginRate: MAINTENANCE_MARGIN_RATE[request.market],
          engineVersion: HISTORICAL_ENGINE_VERSION, configHash: integrity.configHash, strategyHash: integrity.strategyHash });
        signal?.throwIfAborted();
        const completedAt = safeTime(dependencies.now);
        await dependencies.backtests.completeSuccess(userId, created.job.id, {
          completedAt,
          dataset: {
            id: assertId(dependencies.newId("dataset"), "dataset"), market: request.market, symbol: request.symbol,
            interval: request.interval, source: `WEEX ${dataset.provenance.endpoint}`,
            requestedStartAt: request.startTime, requestedEndAt: request.endTime,
            actualStartAt: dataset.candles[0]?.openTime ?? null, actualEndAt: dataset.candles.at(-1)?.closeTime ?? null,
            complete: dataset.complete, gaps: dataset.validation.gaps, checksum: result.provenance.datasetDigest, createdAt: completedAt,
          },
          result: {
            id: assertId(dependencies.newId("result"), "result"), initialCapital: request.initialCapital,
            feeRate: request.feeRate, slippageRate: request.slippageRate, leverage: request.leverage,
            funding: funding === null ? { mode: "none", events: [] }
              : { mode: "historical", events: funding.funding, coverage: funding.coverage, provenance: funding.provenance },
            metrics: result.metrics,
            provenance: { ...result.provenance, fundingMode: request.fundingMode,
              fundingCoverageComplete: funding?.complete ?? true,
              maintenanceMarginAssumption: { rate: MAINTENANCE_MARGIN_RATE[request.market],
                model: "fixed-conservative-not-weex-tier-exact" } },
            equityCurve: result.equityCurve, engineVersion: HISTORICAL_ENGINE_VERSION,
            configurationHash: integrity.configHash, strategyHash: integrity.strategyHash,
            scriptHash: null, createdAt: completedAt,
          },
        });
        const detail = await dependencies.backtests.getDetail(userId, created.job.id);
        if (!detail) throw new Error("completed backtest disappeared");
        return { job: detail, idempotent: false };
      } catch (error) {
        const failure = failureClass(error, phase);
        await dependencies.backtests.fail(userId, created.job.id, phase, {
          code: failure.code, message: failure.message, completedAt: safeTime(dependencies.now),
        });
        throw new HistoricalBacktestProblem(failure.httpStatus, failure.code);
      }
    },
    get: (userId, jobId) => dependencies.backtests.getDetail(userId, jobId),
    list: (userId, options) => dependencies.backtests.list(userId, options),
  };
}

const parseCursor = (value: string | null): BacktestCursor | undefined => {
  if (value === null) return undefined;
  const match = /^(0|[1-9]\d{0,15}):([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/.exec(value);
  if (!match) throw new HttpProblem(400, "invalid_request");
  const createdAt = Number(match[1]);
  if (!Number.isSafeInteger(createdAt)) throw new HttpProblem(400, "invalid_request");
  return { createdAt, id: match[2]! };
};

const failureResponse = (error: unknown): Response => {
  if (error instanceof HistoricalBacktestProblem) return errorResponse(error, { status: error.status, code: error.code });
  if (error instanceof HttpProblem) return errorResponse(error, { status: error.status, code: error.code });
  return errorResponse(error, { status: 500, code: "internal" });
};

export function createHistoricalBacktestHandlers(dependencies: {
  auth: ApiAuthDependencies; originPolicy: OriginPolicy; service: HistoricalBacktestService;
}) {
  return {
    post: async (request: Request): Promise<Response> => {
      const controller = new AbortController();
      const abort = () => controller.abort(request.signal.reason);
      if (request.signal.aborted) abort(); else request.signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("backtest workflow deadline exceeded")), 25_000);
      try {
        requireSameOrigin(request, dependencies.originPolicy);
        const authenticated = await requireApiUser(request, dependencies.auth);
        if (!authenticated.ok) return authenticated.response;
        const key = request.headers.get("idempotency-key") ?? "";
        if (!IDEMPOTENCY_KEY.test(key)) throw new HttpProblem(400, "invalid_request");
        const input = await readStrictJson(request, { maximumBytes: 32_768, parse: parseBacktestJobCreateDto });
        const created = await dependencies.service.create(authenticated.user.id, key, input, controller.signal);
        return jsonResponse({ backtest: "datasetId" in created.job ? publicDetail(created.job) : created.job,
          idempotent: created.idempotent }, { status: created.idempotent ? 200 : 201 });
      } catch (error) { return failureResponse(error); }
      finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); }
    },
    list: async (request: Request): Promise<Response> => {
      try {
        const authenticated = await requireApiUser(request, dependencies.auth);
        if (!authenticated.ok) return authenticated.response;
        const url = new URL(request.url);
        if ([...url.searchParams.keys()].some((key) => key !== "limit" && key !== "cursor")) throw new HttpProblem(400, "invalid_request");
        const limitValue = url.searchParams.get("limit") ?? "20";
        if (!/^[1-9]\d{0,2}$/.test(limitValue)) throw new HttpProblem(400, "invalid_request");
        const limit = Number(limitValue);
        if (limit > 100) throw new HttpProblem(400, "invalid_request");
        const result = await dependencies.service.list(authenticated.user.id, { limit,
          ...(parseCursor(url.searchParams.get("cursor")) ? { cursor: parseCursor(url.searchParams.get("cursor")) } : {}) });
        return jsonResponse({ items: result.items.map(publicSummary), nextCursor: result.nextCursor === null ? null
          : `${result.nextCursor.createdAt}:${result.nextCursor.id}` });
      } catch (error) { return failureResponse(error); }
    },
    get: async (request: Request, jobId: string): Promise<Response> => {
      try {
        const authenticated = await requireApiUser(request, dependencies.auth);
        if (!authenticated.ok) return authenticated.response;
        if (!ID.test(jobId)) throw new HttpProblem(400, "invalid_request");
        const detail = await dependencies.service.get(authenticated.user.id, jobId);
        if (!detail) throw new HttpProblem(404, "not_found");
        return jsonResponse({ backtest: publicDetail(detail) });
      } catch (error) { return failureResponse(error); }
    },
  };
}
