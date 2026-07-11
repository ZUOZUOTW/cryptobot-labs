import { parseBacktestJobCreateDto, safeJsonStringify } from "../../lib/control-plane/schemas";
import type { BacktestJobCreateDto } from "../../lib/control-plane/types";
import type { ControlPlaneDatabase } from "../index";
import { exactInput, hash, id, limit, time } from "./shared";

export type BacktestStatus = "queued" | "fetching-data" | "running" | "succeeded" | "failed";

export interface BacktestJobRecord {
  id: string;
  userId: string;
  strategyVersionId: string;
  status: BacktestStatus;
  evidenceLevel: "historical";
  requestJson: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface BacktestCursor { createdAt: number; id: string }

export interface BacktestDatasetInput {
  id: string;
  market: "spot" | "futures";
  symbol: string;
  interval: string;
  source: string;
  requestedStartAt: number;
  requestedEndAt: number;
  actualStartAt: number | null;
  actualEndAt: number | null;
  complete: boolean;
  gaps: unknown;
  checksum: string;
  createdAt: number;
}

export interface BacktestResultInput {
  id: string;
  initialCapital: string;
  feeRate: string;
  slippageRate: string;
  leverage: string;
  funding: unknown;
  metrics: unknown;
  provenance: unknown;
  equityCurve: unknown;
  engineVersion: string;
  configurationHash: string;
  strategyHash: string;
  scriptHash: string | null;
  createdAt: number;
}

export interface BacktestCompletionInput {
  completedAt: number;
  dataset: BacktestDatasetInput;
  result: BacktestResultInput;
}

const jobColumns = `id, user_id AS userId, strategy_version_id AS strategyVersionId,
  status, evidence_level AS evidenceLevel, request_json AS requestJson,
  error_code AS errorCode, error_message AS errorMessage, created_at AS createdAt,
  started_at AS startedAt, completed_at AS completedAt`;

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const STATUS_TRANSITIONS: Readonly<Record<BacktestStatus, readonly BacktestStatus[]>> = {
  queued: ["fetching-data"],
  "fetching-data": ["running"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

const text = (value: string, label: string, maximum: number): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
};

const decimal = (value: string, label: string): string => {
  if (typeof value !== "string" || value.length > 128 || !DECIMAL.test(value)) throw new Error(`${label} is invalid`);
  return value;
};

const optionalTime = (value: number | null, label: string): number | null => value === null ? null : time(value, label);

interface StoredCompletion {
  status: BacktestStatus;
  completedAt: number | null;
  datasetId: string | null;
  market: string | null;
  symbol: string | null;
  interval: string | null;
  source: string | null;
  requestedStartAt: number | null;
  requestedEndAt: number | null;
  actualStartAt: number | null;
  actualEndAt: number | null;
  complete: number | null;
  gapsJson: string | null;
  checksum: string | null;
  datasetCreatedAt: number | null;
  resultId: string | null;
  initialCapital: string | null;
  feeRate: string | null;
  slippageRate: string | null;
  leverage: string | null;
  fundingJson: string | null;
  metricsJson: string | null;
  provenanceJson: string | null;
  equityCurveJson: string | null;
  engineVersion: string | null;
  configurationHash: string | null;
  strategyHash: string | null;
  scriptHash: string | null;
  resultCreatedAt: number | null;
}

export function createBacktestRepository(database: ControlPlaneDatabase) {
  const getById = (userId: string, jobId: string): Promise<BacktestJobRecord | null> => database.prepare(`
    SELECT ${jobColumns} FROM backtest_jobs WHERE user_id = ? AND id = ?
  `).bind(id(userId, "userId"), id(jobId, "backtestJobId")).first<BacktestJobRecord>();

  const storedCompletion = (userId: string, jobId: string): Promise<StoredCompletion | null> => database.prepare(`
    SELECT j.status, j.completed_at AS completedAt,
      d.id AS datasetId, d.market, d.symbol, d.interval, d.source,
      d.requested_start_at AS requestedStartAt, d.requested_end_at AS requestedEndAt,
      d.actual_start_at AS actualStartAt, d.actual_end_at AS actualEndAt,
      d.complete, d.gaps_json AS gapsJson, d.checksum, d.created_at AS datasetCreatedAt,
      r.id AS resultId, r.initial_capital AS initialCapital, r.fee_rate AS feeRate,
      r.slippage_rate AS slippageRate, r.leverage, r.funding_json AS fundingJson,
      r.metrics_json AS metricsJson, r.provenance_json AS provenanceJson,
      r.equity_curve_json AS equityCurveJson, r.engine_version AS engineVersion,
      r.configuration_hash AS configurationHash, r.strategy_hash AS strategyHash,
      r.script_hash AS scriptHash, r.created_at AS resultCreatedAt
    FROM backtest_jobs j
    LEFT JOIN backtest_datasets d ON d.backtest_job_id = j.id AND d.user_id = j.user_id
    LEFT JOIN backtest_results r ON r.backtest_job_id = j.id AND r.user_id = j.user_id
    WHERE j.user_id = ? AND j.id = ?
  `).bind(userId, jobId).first<StoredCompletion>();

  return {
    async createJob(input: { id: string; userId: string; request: BacktestJobCreateDto; now: number }): Promise<BacktestJobRecord> {
      exactInput(input, ["id", "userId", "request", "now"]);
      const request = parseBacktestJobCreateDto(input.request);
      const row = await database.prepare(`
        INSERT INTO backtest_jobs
          (id, user_id, strategy_version_id, status, evidence_level, request_json, created_at)
        SELECT ?, user_id, id, 'queued', 'historical', ?, ? FROM strategy_versions
        WHERE user_id = ? AND id = ?
        RETURNING ${jobColumns}
      `).bind(id(input.id, "backtestJobId"), safeJsonStringify(request, "backtest request", 32_768),
        time(input.now, "now"), id(input.userId, "userId"), id(request.strategyVersionId, "strategyVersionId"))
        .first<BacktestJobRecord>();
      if (!row) throw new Error("owned strategy version not found");
      return row;
    },

    getById,

    async list(userId: string, options: { limit: number; cursor?: BacktestCursor }): Promise<{ items: BacktestJobRecord[]; nextCursor: BacktestCursor | null }> {
      exactInput(options, ["limit", "cursor"]);
      const owner = id(userId, "userId");
      const pageSize = limit(options.limit);
      const cursor = options.cursor;
      if (cursor !== undefined) exactInput(cursor, ["createdAt", "id"]);
      const cursorTime = cursor === undefined ? null : time(cursor.createdAt, "cursor.createdAt");
      const cursorId = cursor === undefined ? null : id(cursor.id, "cursor.id");
      const result = await database.prepare(`
        SELECT ${jobColumns} FROM backtest_jobs
        WHERE user_id = ? AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC LIMIT ?
      `).bind(owner, cursorTime, cursorTime, cursorTime, cursorId, pageSize + 1).all<BacktestJobRecord>();
      if (!result.success) throw new Error("backtest list failed");
      const more = result.results.length > pageSize;
      const items = result.results.slice(0, pageSize);
      const last = items.at(-1);
      return { items, nextCursor: more && last ? { createdAt: last.createdAt, id: last.id } : null };
    },

    async advanceStatus(userId: string, jobId: string, expected: BacktestStatus, next: BacktestStatus, nowValue: number): Promise<BacktestJobRecord | null> {
      if (!STATUS_TRANSITIONS[expected]?.includes(next)) throw new Error(`invalid backtest status transition: ${expected} -> ${next}`);
      const now = time(nowValue, "now");
      return database.prepare(`
        UPDATE backtest_jobs SET status = ?, started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END
        WHERE user_id = ? AND id = ? AND status = ?
        RETURNING ${jobColumns}
      `).bind(next, next, now, id(userId, "userId"), id(jobId, "backtestJobId"), expected).first<BacktestJobRecord>();
    },

    async completeSuccess(userId: string, jobId: string, input: BacktestCompletionInput): Promise<{ job: BacktestJobRecord; idempotent: boolean }> {
      exactInput(input, ["completedAt", "dataset", "result"]);
      exactInput(input.dataset, ["id", "market", "symbol", "interval", "source", "requestedStartAt", "requestedEndAt", "actualStartAt", "actualEndAt", "complete", "gaps", "checksum", "createdAt"]);
      exactInput(input.result, ["id", "initialCapital", "feeRate", "slippageRate", "leverage", "funding", "metrics", "provenance", "equityCurve", "engineVersion", "configurationHash", "strategyHash", "scriptHash", "createdAt"]);
      const owner = id(userId, "userId");
      const target = id(jobId, "backtestJobId");
      const completedAt = time(input.completedAt, "completedAt");
      const dataset = input.dataset;
      if (dataset.market !== "spot" && dataset.market !== "futures") throw new Error("dataset market is invalid");
      if (typeof dataset.complete !== "boolean") throw new Error("dataset complete must be boolean");
      const datasetId = id(dataset.id, "datasetId");
      const gapsJson = safeJsonStringify(dataset.gaps, "dataset gaps", 65_536);
      const result = input.result;
      const resultId = id(result.id, "resultId");
      const fundingJson = safeJsonStringify(result.funding, "funding", 65_536);
      const metricsJson = safeJsonStringify(result.metrics, "metrics", 65_536);
      const provenanceJson = safeJsonStringify(result.provenance, "provenance", 65_536);
      const equityCurveJson = safeJsonStringify(result.equityCurve, "equity curve", 1_048_576);
      const normalized = {
        market: dataset.market,
        symbol: text(dataset.symbol, "dataset symbol", 64),
        interval: text(dataset.interval, "dataset interval", 16),
        source: text(dataset.source, "dataset source", 256),
        requestedStartAt: time(dataset.requestedStartAt, "requestedStartAt"),
        requestedEndAt: time(dataset.requestedEndAt, "requestedEndAt"),
        actualStartAt: optionalTime(dataset.actualStartAt, "actualStartAt"),
        actualEndAt: optionalTime(dataset.actualEndAt, "actualEndAt"),
        complete: dataset.complete ? 1 : 0,
        checksum: hash(dataset.checksum),
        datasetCreatedAt: time(dataset.createdAt, "dataset.createdAt"),
        initialCapital: decimal(result.initialCapital, "initialCapital"),
        feeRate: decimal(result.feeRate, "feeRate"),
        slippageRate: decimal(result.slippageRate, "slippageRate"),
        leverage: decimal(result.leverage, "leverage"),
        engineVersion: text(result.engineVersion, "engineVersion", 64),
        configurationHash: hash(result.configurationHash),
        strategyHash: hash(result.strategyHash),
        scriptHash: result.scriptHash === null ? null : hash(result.scriptHash),
        resultCreatedAt: time(result.createdAt, "result.createdAt"),
      };

      const existing = await storedCompletion(owner, target);
      if (!existing) throw new Error("owned backtest job not found");
      if (existing.status === "succeeded") {
        const identical = existing.completedAt === completedAt
          && existing.datasetId === datasetId && existing.market === normalized.market
          && existing.symbol === normalized.symbol && existing.interval === normalized.interval
          && existing.source === normalized.source && existing.requestedStartAt === normalized.requestedStartAt
          && existing.requestedEndAt === normalized.requestedEndAt && existing.actualStartAt === normalized.actualStartAt
          && existing.actualEndAt === normalized.actualEndAt && existing.complete === normalized.complete
          && existing.gapsJson === gapsJson && existing.checksum === normalized.checksum
          && existing.datasetCreatedAt === normalized.datasetCreatedAt && existing.resultId === resultId
          && existing.initialCapital === normalized.initialCapital && existing.feeRate === normalized.feeRate
          && existing.slippageRate === normalized.slippageRate && existing.leverage === normalized.leverage
          && existing.fundingJson === fundingJson && existing.metricsJson === metricsJson
          && existing.provenanceJson === provenanceJson && existing.equityCurveJson === equityCurveJson
          && existing.engineVersion === normalized.engineVersion && existing.configurationHash === normalized.configurationHash
          && existing.strategyHash === normalized.strategyHash && existing.scriptHash === normalized.scriptHash
          && existing.resultCreatedAt === normalized.resultCreatedAt;
        if (!identical) throw new Error("backtest completion conflict");
        return { job: (await getById(owner, target))!, idempotent: true };
      }
      if (existing.status !== "running" || existing.datasetId !== null || existing.resultId !== null) {
        throw new Error("backtest job is not running or already has immutable output");
      }

      const batch = await database.batch([
        database.prepare(`
          INSERT INTO backtest_datasets
            (id, user_id, backtest_job_id, market, symbol, interval, source, requested_start_at,
             requested_end_at, actual_start_at, actual_end_at, complete, gaps_json, checksum, created_at)
          SELECT ?, user_id, id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM backtest_jobs
          WHERE user_id = ? AND id = ? AND status = 'running'
        `).bind(datasetId, normalized.market, normalized.symbol, normalized.interval, normalized.source,
          normalized.requestedStartAt, normalized.requestedEndAt, normalized.actualStartAt, normalized.actualEndAt,
          normalized.complete, gapsJson, normalized.checksum, normalized.datasetCreatedAt, owner, target),
        database.prepare(`
          INSERT INTO backtest_results
            (id, user_id, backtest_job_id, dataset_id, evidence_level, initial_capital, fee_rate,
             slippage_rate, leverage, funding_json, metrics_json, provenance_json, equity_curve_json,
             engine_version, configuration_hash, strategy_hash, script_hash, created_at)
          SELECT ?, j.user_id, j.id, d.id, 'historical', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          FROM backtest_jobs j JOIN backtest_datasets d ON d.backtest_job_id = j.id AND d.user_id = j.user_id
          WHERE j.user_id = ? AND j.id = ? AND j.status = 'running'
        `).bind(resultId, normalized.initialCapital, normalized.feeRate, normalized.slippageRate,
          normalized.leverage, fundingJson, metricsJson, provenanceJson, equityCurveJson, normalized.engineVersion,
          normalized.configurationHash, normalized.strategyHash, normalized.scriptHash, normalized.resultCreatedAt, owner, target),
        database.prepare(`
          UPDATE backtest_jobs SET status = 'succeeded', completed_at = ?, error_code = NULL, error_message = NULL
          WHERE user_id = ? AND id = ? AND status = 'running'
            AND EXISTS (SELECT 1 FROM backtest_datasets WHERE backtest_job_id = ? AND user_id = ?)
            AND EXISTS (SELECT 1 FROM backtest_results WHERE backtest_job_id = ? AND user_id = ?)
        `).bind(completedAt, owner, target, target, owner, target, owner),
      ]);
      if (batch.some((entry) => !entry.success) || !batch.every((entry) => (entry.meta.changes ?? 0) === 1)) {
        throw new Error("atomic backtest completion failed");
      }
      const job = await getById(owner, target);
      if (!job || job.status !== "succeeded") throw new Error("atomic backtest completion failed");
      return { job, idempotent: false };
    },

    async fail(userId: string, jobId: string, expected: BacktestStatus, input: { code: string; message: string; completedAt: number }): Promise<BacktestJobRecord | null> {
      exactInput(input, ["code", "message", "completedAt"]);
      const code = text(input.code, "error code", 64);
      const message = text(input.message, "error message", 512);
      if (expected !== "running") throw new Error("invalid backtest failure transition");
      return database.prepare(`
        UPDATE backtest_jobs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?
        WHERE user_id = ? AND id = ? AND status = 'running'
          AND NOT EXISTS (SELECT 1 FROM backtest_results WHERE backtest_job_id = ? AND user_id = ?)
        RETURNING ${jobColumns}
      `).bind(code, message, time(input.completedAt, "completedAt"), id(userId, "userId"),
        id(jobId, "backtestJobId"), jobId, userId).first<BacktestJobRecord>();
    },
  };
}
