import type { HistoricalBacktestRecord, HistoricalRequest } from "../components/backtests/BacktestResultCard";
import {
  attestHistoricalReportForConfig,
  historicalConfigurationHash,
  historicalScriptHash,
  historicalStrategyHash,
} from "./historical-evidence";
import type { BacktestReport, BotConfig, BotMetrics, EquityPoint } from "./types";

const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DAY_MS = 86_400_000;

export interface FormalBacktestEvidence {
  report: BacktestReport;
  strategyVersionId: string;
  backtestJobId: string;
}

const exactRequest = (record: HistoricalBacktestRecord): HistoricalRequest | null => {
  if (!record.request || record.request.strategyVersionId !== record.strategyVersionId) return null;
  const request = record.request;
  return request.market === "spot" || request.market === "futures" ? request : null;
};

const number = (value: string): number | null => {
  if (typeof value !== "string" || !DECIMAL.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const metric = (value: string, percentage = false): number | null => {
  const parsed = number(value);
  if (parsed === null) return null;
  const normalized = percentage ? parsed * 100 : parsed;
  return Number.isFinite(normalized) ? Number(normalized.toFixed(2)) : null;
};

function metricsFor(record: HistoricalBacktestRecord, startTime: number, endTime: number): BotMetrics | null {
  const metrics = record.result?.metrics;
  if (!metrics || !Number.isSafeInteger(metrics.trades) || metrics.trades < 0) return null;
  const totalReturn = metric(metrics.totalReturn, true);
  const annualizedReturn = metric(metrics.annualizedReturn, true);
  const maxDrawdown = metric(metrics.maxDrawdown, true);
  const winRate = metric(metrics.winRate, true);
  const profitFactor = metrics.profitFactor === null ? 0 : metric(metrics.profitFactor);
  const sharpe = metric(metrics.sharpe);
  if ([totalReturn, annualizedReturn, maxDrawdown, winRate, profitFactor, sharpe].some((value) => value === null)) return null;
  return {
    totalReturn: totalReturn!, annualizedReturn: annualizedReturn!, maxDrawdown: -Math.abs(maxDrawdown!),
    winRate: winRate!, profitFactor: profitFactor!, sharpe: sharpe!, trades: metrics.trades,
    runningDays: Math.max(1, Math.round((endTime - startTime) / DAY_MS)),
    // Formal result storage does not currently persist a separate stability statistic.
    stability: 0,
  };
}

function equityFor(record: HistoricalBacktestRecord, startTime: number, endTime: number): EquityPoint[] | null {
  const source = record.result?.equityCurve;
  if (!Array.isArray(source) || source.length < 2) return null;
  const maximumPoints = 48;
  const step = Math.max(1, Math.ceil(source.length / maximumPoints));
  let previous = -1;
  const normalized: Array<{ timestamp: number; value: number }> = [];
  for (const point of source) {
    const value = number(point.equity);
    if (!Number.isSafeInteger(point.timestamp) || point.timestamp <= previous
      || point.timestamp < startTime || point.timestamp > endTime || value === null || value < 0) return null;
    previous = point.timestamp;
    normalized.push({ timestamp: point.timestamp, value });
  }
  return normalized.filter((_, index) => index % step === 0 || index === normalized.length - 1).map(({ timestamp, value }) => ({
    label: new Date(timestamp).toISOString().slice(5, 10).replace("-", "/"),
    value: Number(value.toFixed(2)),
  }));
}

const emptyArray = (value: unknown): boolean => Array.isArray(value) && value.length === 0;

/**
 * Converts an authenticated, owner-scoped formal result to the portable report
 * shape only after every stored identity and content hash agrees with the exact
 * current config. The added report digest is a content binding, not a signature.
 */
export function formalBacktestToReport(
  record: HistoricalBacktestRecord,
  config: BotConfig,
  expectedConfigurationHash?: string,
): FormalBacktestEvidence | null {
  const request = exactRequest(record);
  const dataset = record.dataset;
  const result = record.result;
  const provenance = result?.provenance;
  if (record.status !== "succeeded" || record.evidenceLevel !== "historical"
    || !request || !dataset || !result || !provenance
    || !record.id || !record.strategyVersionId || record.completedAt === null
    || request.market !== config.market || request.symbol !== config.symbol || request.interval !== config.timeframe
    || number(request.leverage) !== config.leverage || request.startTime >= request.endTime
    || request.gapPolicy !== "fail"
    || dataset.market !== request.market || dataset.symbol !== request.symbol || dataset.interval !== request.interval
    || dataset.requestedStartAt !== request.startTime || dataset.requestedEndAt !== request.endTime
    || dataset.actualStartAt === null || dataset.actualEndAt === null
    || dataset.actualStartAt !== request.startTime || dataset.actualEndAt !== request.endTime - 1
    || dataset.actualStartAt >= dataset.actualEndAt || !dataset.complete || !emptyArray(dataset.gaps)
    || !HASH.test(dataset.checksum)
    || provenance.provider !== "WEEX" || provenance.sourceKind !== "public-api"
    || provenance.market !== request.market || provenance.symbol !== request.symbol || provenance.interval !== request.interval
    || provenance.requestedRange.startTime !== request.startTime || provenance.requestedRange.endTime !== request.endTime
    || provenance.fetchedRange.startTime !== dataset.actualStartAt || provenance.fetchedRange.endTime !== dataset.actualEndAt
    || !provenance.complete || provenance.gapCount !== 0 || provenance.duplicateCount !== 0
    || provenance.incompleteCount !== 0 || !emptyArray(provenance.gaps)
    || provenance.feeRate !== request.feeRate || provenance.slippageRate !== request.slippageRate
    || provenance.datasetDigest !== dataset.checksum || result.engineVersion !== provenance.engineVersion
    || result.configurationHash !== provenance.configHash || result.strategyHash !== provenance.strategyHash) return null;

  let configurationHash: string;
  let strategyHash: string;
  try {
    configurationHash = historicalConfigurationHash(config);
    strategyHash = historicalStrategyHash(config, configurationHash);
  } catch { return null; }
  if ((expectedConfigurationHash !== undefined && expectedConfigurationHash !== configurationHash)
    || result.configurationHash !== configurationHash || result.strategyHash !== strategyHash
    || result.scriptHash !== historicalScriptHash(config)) return null;

  const metrics = metricsFor(record, request.startTime, request.endTime);
  const equityCurve = equityFor(record, request.startTime, request.endTime);
  if (!metrics || !equityCurve || !Number.isSafeInteger(record.completedAt) || record.completedAt < 0) return null;
  const report = attestHistoricalReportForConfig({
    seed: dataset.checksum.slice(0, 8),
    generatedAt: new Date(record.completedAt).toISOString(),
    metrics,
    equityCurve,
    disclaimer: "WEEX 歷史行情回測，不代表未來績效",
  }, {
    level: "historical", provider: "WEEX", market: request.market, symbol: request.symbol,
    interval: request.interval, startTime: request.startTime, endTime: request.endTime,
    collectedAt: record.completedAt, candleCount: result.equityCurve.length, complete: true,
    feeRate: request.feeRate, slippageRate: request.slippageRate,
    fundingIncluded: request.fundingMode === "historical", gapPolicy: request.gapPolicy,
    datasetDigest: dataset.checksum, engineVersion: result.engineVersion,
  }, config);
  return { report, strategyVersionId: record.strategyVersionId, backtestJobId: record.id };
}
