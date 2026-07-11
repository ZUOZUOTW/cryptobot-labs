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
import { MAX_FUTURES_HISTORY_CANDLES, MAX_FUTURES_HISTORY_RANGE_MS, parseIntervalMs } from "../../packages/weex-client/src";

export const HISTORICAL_ENGINE_VERSION = "cryptobot-labs-historical-v1";
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_SPOT_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;

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
  collectHistoricalCandles(request: BacktestJobCreateDto): Promise<HistoricalDataset>;
  collectHistoricalFunding(request: { market: "futures"; symbol: string; startTime: number; endTime: number;
    strict: true }): Promise<HistoricalFundingDataset>;
};

export interface HistoricalBacktestService {
  create(userId: string, idempotencyKey: string, request: BacktestJobCreateDto): Promise<{
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

const assertRange = (request: BacktestJobCreateDto, now: number): void => {
  if (request.startTime < 0 || request.endTime > now) throw new HistoricalBacktestProblem(422, "invalid_historical_range");
  let intervalMs: number;
  try { intervalMs = parseIntervalMs(request.interval); }
  catch { throw new HistoricalBacktestProblem(422, "invalid_historical_interval"); }
  const range = request.endTime - request.startTime;
  const maximumRange = request.market === "futures" ? MAX_FUTURES_HISTORY_RANGE_MS : MAX_SPOT_RANGE_MS;
  if (range > maximumRange || Math.ceil(range / intervalMs) > MAX_FUTURES_HISTORY_CANDLES || range < intervalMs * 2) {
    throw new HistoricalBacktestProblem(422, "invalid_historical_range");
  }
};

const assertDataset = (dataset: HistoricalDataset, request: BacktestJobCreateDto): void => {
  const first = dataset.candles[0]?.openTime;
  const last = dataset.candles.at(-1)?.closeTime;
  const structural = dataset.request.market === request.market && dataset.request.symbol === request.symbol
    && dataset.request.interval === request.interval && dataset.candles.length >= 2
    && dataset.candles.length <= MAX_FUTURES_HISTORY_CANDLES
    && dataset.request.startTime === request.startTime && dataset.request.endTime === request.endTime
    && dataset.intervalMs === parseIntervalMs(request.interval)
    && dataset.validation.ordered && dataset.validation.duplicates.length === 0
    && dataset.validation.incompleteCount === 0 && !dataset.provenance.truncated
    && first !== undefined && first <= request.startTime && last !== undefined && last >= request.endTime;
  const disclosedGapsOnly = request.gapPolicy === "disclose" && dataset.validation.gaps.length > 0;
  if (!structural || (!dataset.complete && !disclosedGapsOnly)
    || (request.gapPolicy === "fail" && dataset.validation.gaps.length > 0)) {
    throw new HistoricalBacktestProblem(422, "historical_dataset_incomplete");
  }
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

export function createHistoricalBacktestService(dependencies: {
  backtests: BacktestRepository; strategies: StrategyRepository; marketData: PublicMarketClient;
  now(): number; newId(prefix: "job" | "idem" | "dataset" | "result"): string;
}): HistoricalBacktestService {
  return {
    async create(userId, idempotencyKey, candidate) {
      if (!ID.test(userId) || !IDEMPOTENCY_KEY.test(idempotencyKey)) throw new HistoricalBacktestProblem(400, "invalid_request");
      let request: BacktestJobCreateDto;
      try { request = parseBacktestJobCreateDto(candidate); }
      catch { throw new HistoricalBacktestProblem(400, "invalid_request"); }
      const now = safeTime(dependencies.now);
      assertRange(request, now);
      const version = await dependencies.strategies.getOwned(userId, request.strategyVersionId);
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
        const dataset = await dependencies.marketData.collectHistoricalCandles(request);
        assertDataset(dataset, request);
        let funding: HistoricalFundingDataset | null = null;
        if (request.fundingMode === "historical") {
          funding = await dependencies.marketData.collectHistoricalFunding({ market: "futures", symbol: request.symbol,
            startTime: request.startTime, endTime: request.endTime, strict: true });
          if (!funding.complete) throw new HistoricalBacktestProblem(422, "historical_funding_incomplete");
        }
        phase = "running";
        if (!await dependencies.backtests.advanceStatus(userId, created.job.id, "fetching-data", phase, safeTime(dependencies.now))) {
          throw new Error("backtest could not enter running state");
        }
        // Evaluators are stateful by design; every run receives a fresh instance.
        const evaluator = createVisualHistoricalEvaluator(integrity.config);
        const result: HistoricalBacktestResult = await runHistoricalBacktest({ dataset, evaluator,
          initialCapital: request.initialCapital, feeRate: request.feeRate, slippageRate: request.slippageRate,
          leverage: request.leverage, funding: funding?.funding ?? [], gapPolicy: request.gapPolicy,
          engineVersion: HISTORICAL_ENGINE_VERSION, configHash: integrity.configHash, strategyHash: integrity.strategyHash });
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
              fundingCoverageComplete: funding?.complete ?? true },
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
      try {
        requireSameOrigin(request, dependencies.originPolicy);
        const authenticated = await requireApiUser(request, dependencies.auth);
        if (!authenticated.ok) return authenticated.response;
        const key = request.headers.get("idempotency-key") ?? "";
        if (!IDEMPOTENCY_KEY.test(key)) throw new HttpProblem(400, "invalid_request");
        const input = await readStrictJson(request, { maximumBytes: 32_768, parse: parseBacktestJobCreateDto });
        const created = await dependencies.service.create(authenticated.user.id, key, input);
        return jsonResponse({ backtest: "datasetId" in created.job ? publicDetail(created.job) : created.job,
          idempotent: created.idempotent }, { status: created.idempotent ? 200 : 201 });
      } catch (error) { return failureResponse(error); }
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
        return jsonResponse({ items: result.items, nextCursor: result.nextCursor === null ? null
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
