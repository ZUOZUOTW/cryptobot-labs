import type { HistoricalBacktestRecord } from "../../components/backtests/BacktestResultCard";
import { formalBacktestToReport } from "../formal-backtest-report";
import {
  historicalConfigurationHash,
  historicalScriptHash,
} from "../historical-evidence";
import { parseBacktestJobCreateDto } from "../control-plane/schemas";
import type { BotConfig } from "../types";
import { validateConfig } from "../strategy-validation";

const HASH = /^[a-f0-9]{64}$/;

/** Raised when a persisted public/execution candidate no longer satisfies the
 * formal historical-evidence contract. Callers at public read boundaries can
 * map this narrowly to not-found without hiding unrelated storage failures. */
export class InvalidFormalBacktestEvidenceError extends Error {
  constructor() {
    super("published strategy formal evidence is invalid");
    this.name = "InvalidFormalBacktestEvidenceError";
  }
}

export interface FormalEvidenceGateRow {
  strategyVersionId: string;
  configHash: string;
  sourceHash: string | null;
  configJson: string | Record<string, unknown>;
  sourceCode: string | null;
  jobId: string;
  jobStatus: string;
  jobEvidenceLevel: string;
  requestJson: string | Record<string, unknown>;
  completedAt: number | null;
  datasetId: string;
  datasetMarket: string;
  datasetSymbol: string;
  datasetInterval: string;
  datasetSource: string;
  requestedStartAt: number;
  requestedEndAt: number;
  actualStartAt: number | null;
  actualEndAt: number | null;
  datasetComplete: number | boolean;
  gapsJson: string | unknown[];
  checksum: string;
  resultId: string;
  resultEvidenceLevel: string;
  initialCapital: string;
  feeRate: string;
  slippageRate: string;
  leverage: string;
  fundingJson: string | Record<string, unknown> | unknown[];
  metricsJson: string | Record<string, unknown>;
  provenanceJson: string | Record<string, unknown>;
  equityCurveJson: string | unknown[];
  engineVersion: string;
  configurationHash: string;
  strategyHash: string;
  scriptHash: string | null;
}

const parseJson = (value: unknown, maximum: number): unknown => {
  if (typeof value === "string") {
    if (new TextEncoder().encode(value).byteLength > maximum) {
      throw new Error("formal evidence JSON is invalid");
    }
    return JSON.parse(value) as unknown;
  }
  // The production Postgres adapter returns json/jsonb columns as parsed
  // values, while SQLite fixtures return text. Normalize both through the same
  // byte bound instead of silently rejecting every production publication.
  const encoded = JSON.stringify(value);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > maximum) {
    throw new Error("formal evidence JSON is invalid");
  }
  return value;
};

const record = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const emptyArray = (value: unknown): boolean => Array.isArray(value) && value.length === 0;
type HistoricalResult = NonNullable<HistoricalBacktestRecord["result"]>;

/**
 * Revalidates a persisted formal backtest before it can cross into a public or
 * execution trust boundary. This intentionally reuses the portable-report
 * adapter so those boundaries cannot drift to a weaker evidence definition.
 */
export function hasFormalBacktestEvidence(row: FormalEvidenceGateRow | null): boolean {
  if (!row || row.jobStatus !== "succeeded" || row.jobEvidenceLevel !== "historical"
    || row.resultEvidenceLevel !== "historical" || !HASH.test(row.configHash)
    || !HASH.test(row.checksum) || row.configurationHash !== row.configHash
    || row.strategyHash !== row.configHash || row.datasetComplete !== true && row.datasetComplete !== 1
    || row.completedAt === null || !Number.isSafeInteger(row.completedAt) || row.completedAt < 0) return false;

  try {
    const configValue = parseJson(row.configJson, 262_144);
    if (!record(configValue)) return false;
    const config = configValue as unknown as BotConfig;
    if (!validateConfig(config).valid || historicalConfigurationHash(config) !== row.configHash) return false;
    const expectedScriptHash = historicalScriptHash(config);
    if ((row.sourceCode === null) !== (row.sourceHash === null)
      || (row.sourceCode === null) !== (config.source === undefined)
      || (row.sourceCode !== null && config.source !== row.sourceCode)
      || row.sourceHash !== expectedScriptHash || row.scriptHash !== expectedScriptHash) return false;

    const request = parseBacktestJobCreateDto(parseJson(row.requestJson, 32_768));
    if (request.strategyVersionId !== row.strategyVersionId
      || request.initialCapital !== row.initialCapital || request.feeRate !== row.feeRate
      || request.slippageRate !== row.slippageRate || request.leverage !== row.leverage
      || request.gapPolicy !== "fail") return false;

    const gaps = parseJson(row.gapsJson, 65_536);
    const funding = parseJson(row.fundingJson, 262_144);
    const metrics = parseJson(row.metricsJson, 65_536);
    const provenance = parseJson(row.provenanceJson, 65_536);
    const equityCurve = parseJson(row.equityCurveJson, 524_288);
    const fundingRecord = record(funding);
    const provenanceRecord = record(provenance);
    if (!emptyArray(gaps) || !fundingRecord || !provenanceRecord) return false;

    const backtest: HistoricalBacktestRecord = {
      id: row.jobId,
      strategyVersionId: row.strategyVersionId,
      status: "succeeded",
      evidenceLevel: "historical",
      request,
      error: null,
      createdAt: 0,
      startedAt: 0,
      completedAt: row.completedAt,
      dataset: {
        id: row.datasetId,
        market: row.datasetMarket as "spot" | "futures",
        symbol: row.datasetSymbol,
        interval: row.datasetInterval,
        source: row.datasetSource,
        requestedStartAt: row.requestedStartAt,
        requestedEndAt: row.requestedEndAt,
        actualStartAt: row.actualStartAt,
        actualEndAt: row.actualEndAt,
        complete: true,
        gaps: gaps as unknown[],
        checksum: row.checksum,
      },
      result: {
        id: row.resultId,
        funding: fundingRecord,
        metrics: metrics as HistoricalResult["metrics"],
        provenance: provenanceRecord as unknown as HistoricalResult["provenance"],
        equityCurve: equityCurve as HistoricalResult["equityCurve"],
        engineVersion: row.engineVersion,
        configurationHash: row.configurationHash,
        strategyHash: row.strategyHash,
        scriptHash: row.scriptHash,
      },
    };
    return formalBacktestToReport(backtest, config, row.configHash) !== null;
  } catch {
    return false;
  }
}
