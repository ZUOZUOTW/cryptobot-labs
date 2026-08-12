import Decimal from "decimal.js";

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
const UNSIGNED_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DAY_MS = 86_400_000;
const MAX_ECMASCRIPT_TIMESTAMP = 8_640_000_000_000_000;
const MAX_HISTORICAL_LEVERAGE = 500;
const FUNDING_HISTORY_LIMIT = 100;
const FUNDING_MARK_PAGE_SIZE = 100;
const MAX_FUNDING_MARK_PAGES = 10;
const MAX_FUNDING_MARK_CANDLES = 1_000;
const DEFAULT_FUNDING_MARK_MAX_AGE_MS = 14_400_000;
const FUNDING_CONVENTION = "long-pays-positive-short-receives-positive";
const LIQUIDATION_MODEL = "fixed-conservative-not-weex-tier-exact";
const LIQUIDATION_CHECK = "funding-event-mark-immediately-then-candle-low-long-high-short";
const LIQUIDATION_ORDERING = "funding-applied-at-event-timestamp-before-candle-wide-adverse-extreme";

type UnknownRecord = Record<string, unknown>;

Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -1_000_000, toExpPos: 1_000_000 });

export interface FormalBacktestEvidence {
  report: BacktestReport;
  strategyVersionId: string;
  backtestJobId: string;
}

const exactRequest = (record: HistoricalBacktestRecord): HistoricalRequest | null => {
  if (!record.request || record.request.strategyVersionId !== record.strategyVersionId) return null;
  const request = record.request;
  if ((request.market !== "spot" && request.market !== "futures")
    || (request.fundingMode !== "none" && request.fundingMode !== "historical")
    || request.gapPolicy !== "fail"
    || !Number.isSafeInteger(request.startTime) || request.startTime < 0
    || !Number.isSafeInteger(request.endTime) || request.endTime <= request.startTime
    || request.endTime > MAX_ECMASCRIPT_TIMESTAMP
    || (request.fundingMode === "historical" && request.market !== "futures")) return null;
  return request;
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

const object = (value: unknown): UnknownRecord | null => (
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null
);

const exactShape = (
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const permitted = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => permitted.has(key));
};

const safeNonNegativeInteger = (value: unknown): value is number => (
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
);

const decimalText = (value: unknown, signed: boolean, maximum = 128): value is string => (
  typeof value === "string" && value.length > 0 && value.length <= maximum
  && (signed ? DECIMAL : UNSIGNED_DECIMAL).test(value)
);

const canonicalDecimal = (value: string): string => {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction] = unsigned.split(".");
  const normalizedFraction = fraction?.replace(/0+$/, "");
  const normalized = normalizedFraction ? `${integer}.${normalizedFraction}` : integer!;
  return /^0(?:\.0+)?$/.test(unsigned) ? "0" : `${negative ? "-" : ""}${normalized}`;
};

const engineDecimal = (value: unknown, signed = false): value is string => {
  if (!decimalText(value, signed)) return false;
  const significantDigits = value.replace(/^-/, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length;
  return canonicalDecimal(value) === value && significantDigits <= 40;
};

const engineDecimalString = (value: Decimal.Value): string => {
  const decimal = new Decimal(value);
  if (decimal.isZero()) return "0";
  const fixed = decimal.toSignificantDigits(40, Decimal.ROUND_HALF_UP).toFixed();
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
};

interface ValidEconomics {
  feeRate: string;
  slippageRate: string;
  maintenanceMarginRate: string;
}

const validateEconomics = (request: HistoricalRequest, config: BotConfig): ValidEconomics | null => {
  if (!decimalText(request.initialCapital, false, 32) || !decimalText(request.feeRate, false, 32)
    || !decimalText(request.slippageRate, false, 32) || !decimalText(request.leverage, false, 32)) return null;
  const initialCapital = Number(request.initialCapital);
  const feeRate = Number(request.feeRate);
  const slippageRate = Number(request.slippageRate);
  const leverage = Number(request.leverage);
  if (!Number.isFinite(initialCapital) || !Number.isFinite(feeRate) || !Number.isFinite(slippageRate)
    || !Number.isFinite(leverage) || initialCapital <= 0 || initialCapital > 100_000_000
    || feeRate < 0 || feeRate > 0.05 || slippageRate < 0 || slippageRate > 0.1
    || leverage <= 0 || leverage > MAX_HISTORICAL_LEVERAGE
    || leverage !== config.leverage || (request.market === "spot" && leverage !== 1)
    || leverage * feeRate >= 1) return null;
  return {
    feeRate: canonicalDecimal(request.feeRate),
    slippageRate: canonicalDecimal(request.slippageRate),
    maintenanceMarginRate: request.market === "spot" ? "0" : String(Math.min(0.02, 0.5 / leverage)),
  };
};

interface ValidFundingEvidence {
  mode: "none" | "historical";
  eventCount: number;
  events: Array<{ timestamp: number; rate: string; markPrice: string }>;
}

const validateFundingEvidence = (
  value: unknown,
  request: HistoricalRequest,
  completedAt: number,
): ValidFundingEvidence | null => {
  const funding = object(value);
  if (!funding || !exactShape(funding, ["mode", "events"], funding.mode === "historical"
    ? ["coverage", "provenance"] : [])) return null;
  if (funding.mode === "none") {
    return request.fundingMode === "none" && emptyArray(funding.events)
      ? { mode: "none", eventCount: 0, events: [] } : null;
  }
  if (funding.mode !== "historical" || request.fundingMode !== "historical" || request.market !== "futures"
    || !Array.isArray(funding.events) || funding.events.length > FUNDING_HISTORY_LIMIT) return null;

  let previousTimestamp = -1;
  for (const candidate of funding.events) {
    const event = object(candidate);
    if (!event || !exactShape(event, ["timestamp", "rate", "markPrice"])
      || !safeNonNegativeInteger(event.timestamp) || event.timestamp < request.startTime
      || event.timestamp >= request.endTime || event.timestamp <= previousTimestamp
      || !decimalText(event.rate, true) || !decimalText(event.markPrice, false)
      || !Number.isFinite(Number(event.markPrice)) || Number(event.markPrice) <= 0) return null;
    previousTimestamp = event.timestamp;
  }

  const coverage = object(funding.coverage);
  if (!coverage || !exactShape(coverage, ["requestedStartTime", "requestedEndTime", "fundingRangeCovered",
    "requestedEvents", "matchedEvents", "missingMarkTimestamps"],
  ["returnedFundingStartTime", "returnedFundingEndTime"])
    || coverage.requestedStartTime !== request.startTime || coverage.requestedEndTime !== request.endTime
    || coverage.fundingRangeCovered !== true || coverage.requestedEvents !== funding.events.length
    || coverage.matchedEvents !== funding.events.length || !emptyArray(coverage.missingMarkTimestamps)) return null;
  const hasReturnedStart = Object.hasOwn(coverage, "returnedFundingStartTime");
  const hasReturnedEnd = Object.hasOwn(coverage, "returnedFundingEndTime");
  if (hasReturnedStart !== hasReturnedEnd) return null;
  if (hasReturnedStart) {
    if (!safeNonNegativeInteger(coverage.returnedFundingStartTime)
      || !safeNonNegativeInteger(coverage.returnedFundingEndTime)
      || coverage.returnedFundingStartTime > coverage.returnedFundingEndTime
      || funding.events.some((candidate) => {
        const timestamp = object(candidate)?.timestamp;
        return typeof timestamp !== "number" || timestamp < (coverage.returnedFundingStartTime as number)
          || timestamp > (coverage.returnedFundingEndTime as number);
      })) return null;
  } else if (funding.events.length > 0) return null;

  const provenance = object(funding.provenance);
  if (!provenance || !exactShape(provenance, ["provider", "sourceKind", "fundingEndpoint", "markEndpoint",
    "priceType", "collectedAt", "fundingLimit", "markMaxAgeMs", "markPages", "markCandles", "truncated"])
    || provenance.provider !== "WEEX" || provenance.sourceKind !== "public-api"
    || provenance.fundingEndpoint !== "/capi/v2/market/getHistoryFundRate"
    || provenance.markEndpoint !== "/capi/v3/market/historyKlines" || provenance.priceType !== "MARK"
    || !safeNonNegativeInteger(provenance.collectedAt) || provenance.collectedAt > completedAt
    || provenance.fundingLimit !== FUNDING_HISTORY_LIMIT
    || provenance.markMaxAgeMs !== DEFAULT_FUNDING_MARK_MAX_AGE_MS
    || !safeNonNegativeInteger(provenance.markPages) || provenance.markPages > MAX_FUNDING_MARK_PAGES
    || !safeNonNegativeInteger(provenance.markCandles) || provenance.markCandles > MAX_FUNDING_MARK_CANDLES
    || provenance.markCandles > provenance.markPages * FUNDING_MARK_PAGE_SIZE || provenance.truncated !== false
    || (funding.events.length === 0
      ? provenance.markPages !== 0 || provenance.markCandles !== 0
      : provenance.markPages === 0 || provenance.markCandles === 0)) return null;
  return { mode: "historical", eventCount: funding.events.length,
    events: funding.events as Array<{ timestamp: number; rate: string; markPrice: string }> };
};

const expectedFundingTreatment = (
  equityCurve: unknown,
  funding: ValidFundingEvidence,
): { minimumAppliedEvents: number; maximumAppliedEvents: number; netFunding: string } | null => {
  if (!Array.isArray(equityCurve)) return null;
  let fundingCursor = 0;
  let minimumAppliedEvents = 0;
  let maximumAppliedEvents = 0;
  let netFunding = new Decimal(0);
  let previousTimestamp = -1;
  for (const candidate of equityCurve) {
    const point = object(candidate);
    if (!point || !exactShape(point, ["timestamp", "equity"], ["funding"])
      || !safeNonNegativeInteger(point.timestamp) || point.timestamp <= previousTimestamp
      || !engineDecimal(point.equity, false)
      || !Object.hasOwn(point, "funding") || !engineDecimal(point.funding, true)) return null;
    previousTimestamp = point.timestamp;
    const periodFunding = point.funding as string;
    const periodEvents: ValidFundingEvidence["events"] = [];
    while (fundingCursor < funding.events.length && funding.events[fundingCursor]!.timestamp <= point.timestamp) {
      periodEvents.push(funding.events[fundingCursor]!);
      fundingCursor += 1;
    }
    if (funding.mode === "none" && periodFunding !== "0") return null;
    if (periodEvents.length === 0 && periodFunding !== "0") return null;
    if (periodFunding !== "0") {
      minimumAppliedEvents += 1;
      maximumAppliedEvents += periodEvents.length;
    } else if (periodEvents.length !== 1 || canonicalDecimal(periodEvents[0]!.rate) === "0") {
      // A sole non-zero rate cannot be applied to a positive-sized position and
      // still produce zero funding. Multiple events can legitimately net to zero,
      // and zero-rate events are invisible in the aggregate curve.
      maximumAppliedEvents += periodEvents.length;
    }
    netFunding = netFunding.plus(periodFunding);
  }
  if (fundingCursor !== funding.events.length || minimumAppliedEvents > funding.eventCount) return null;
  return { minimumAppliedEvents, maximumAppliedEvents, netFunding: engineDecimalString(netFunding) };
};

const validateExecutionAndFundingProvenance = (
  value: unknown,
  request: HistoricalRequest,
  economics: ValidEconomics,
  funding: ValidFundingEvidence,
  expectedFunding: { minimumAppliedEvents: number; maximumAppliedEvents: number; netFunding: string },
): value is NonNullable<HistoricalBacktestRecord["result"]>["provenance"] => {
  const provenance = object(value);
  if (!provenance || !exactShape(provenance, ["provider", "dataSource", "sourceKind", "requestedRange",
    "fetchedRange", "gaps", "gapCount", "duplicateCount", "incompleteCount", "complete", "feeRate",
    "slippageRate", "fundingTreatment", "market", "symbol", "interval", "engineVersion", "configHash",
    "strategyHash", "datasetDigest", "fundingMode", "fundingCoverageComplete", "executionConvention",
    "liquidationModel", "maintenanceMarginAssumption"])) return false;
  const treatment = object(provenance.fundingTreatment);
  const execution = object(provenance.executionConvention);
  const liquidation = object(provenance.liquidationModel);
  const maintenance = object(provenance.maintenanceMarginAssumption);
  const requestedRange = object(provenance.requestedRange);
  const fetchedRange = object(provenance.fetchedRange);
  if (!treatment || !execution || !liquidation || !maintenance || !requestedRange || !fetchedRange
    || !exactShape(requestedRange, ["startTime", "endTime"])
    || !exactShape(fetchedRange, ["startTime", "endTime"])
    || requestedRange.startTime !== request.startTime || requestedRange.endTime !== request.endTime
    || !exactShape(treatment, ["convention", "suppliedEvents", "appliedEvents", "netFunding"])
    || treatment.convention !== FUNDING_CONVENTION || treatment.suppliedEvents !== funding.eventCount
    || !safeNonNegativeInteger(treatment.appliedEvents) || treatment.appliedEvents < expectedFunding.minimumAppliedEvents
    || treatment.appliedEvents > expectedFunding.maximumAppliedEvents
    || treatment.netFunding !== expectedFunding.netFunding
    || !exactShape(execution, ["signalEvaluation", "signalExecution", "riskTrigger"])
    || execution.signalEvaluation !== "completed-candle-close" || execution.signalExecution !== "next-candle-open"
    || execution.riskTrigger !== "close-only-not-intrabar"
    || !exactShape(liquidation, ["maintenanceMarginRate", "maximumSupportedLeverage", "check",
      "orderingAssumption", "model"])
    || liquidation.maintenanceMarginRate !== economics.maintenanceMarginRate
    || liquidation.maximumSupportedLeverage !== String(MAX_HISTORICAL_LEVERAGE)
    || liquidation.check !== LIQUIDATION_CHECK || liquidation.orderingAssumption !== LIQUIDATION_ORDERING
    || liquidation.model !== LIQUIDATION_MODEL
    || !exactShape(maintenance, ["rate", "model"])
    || maintenance.rate !== economics.maintenanceMarginRate || maintenance.model !== LIQUIDATION_MODEL
    || provenance.fundingMode !== funding.mode || provenance.fundingMode !== request.fundingMode
    || provenance.fundingCoverageComplete !== true || provenance.feeRate !== economics.feeRate
    || provenance.slippageRate !== economics.slippageRate
    || provenance.provider !== "WEEX" || provenance.dataSource !== "WEEX"
    || provenance.sourceKind !== "public-api" || typeof provenance.engineVersion !== "string"
    || provenance.engineVersion.length < 1 || provenance.engineVersion.length > 128) return false;
  return true;
};

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
  const completedAt = record.completedAt;
  const requestedRange = object(provenance?.requestedRange);
  const fetchedRange = object(provenance?.fetchedRange);
  if (record.status !== "succeeded" || record.evidenceLevel !== "historical"
    || !request || !dataset || !result || !provenance || !requestedRange || !fetchedRange
    || !record.id || !record.strategyVersionId || completedAt === null
    || !Number.isSafeInteger(completedAt) || completedAt < 0 || completedAt > MAX_ECMASCRIPT_TIMESTAMP
    || request.market !== config.market || request.symbol !== config.symbol || request.interval !== config.timeframe
    || number(request.leverage) !== config.leverage || request.startTime >= request.endTime
    || dataset.market !== request.market || dataset.symbol !== request.symbol || dataset.interval !== request.interval
    || dataset.requestedStartAt !== request.startTime || dataset.requestedEndAt !== request.endTime
    || dataset.actualStartAt === null || dataset.actualEndAt === null
    || dataset.actualStartAt !== request.startTime || dataset.actualEndAt !== request.endTime - 1
    || dataset.actualStartAt >= dataset.actualEndAt || !dataset.complete || !emptyArray(dataset.gaps)
    || !HASH.test(dataset.checksum)
    || provenance.provider !== "WEEX" || provenance.sourceKind !== "public-api"
    || provenance.market !== request.market || provenance.symbol !== request.symbol || provenance.interval !== request.interval
    || requestedRange.startTime !== request.startTime || requestedRange.endTime !== request.endTime
    || fetchedRange.startTime !== dataset.actualStartAt || fetchedRange.endTime !== dataset.actualEndAt
    || !provenance.complete || provenance.gapCount !== 0 || provenance.duplicateCount !== 0
    || provenance.incompleteCount !== 0 || !emptyArray(provenance.gaps)
    || provenance.datasetDigest !== dataset.checksum || result.engineVersion !== provenance.engineVersion
    || result.configurationHash !== provenance.configHash || result.strategyHash !== provenance.strategyHash) return null;

  const economics = validateEconomics(request, config);
  const funding = Number.isSafeInteger(completedAt) && completedAt >= 0
    ? validateFundingEvidence(result.funding, request, completedAt) : null;
  const expectedFunding = funding ? expectedFundingTreatment(result.equityCurve, funding) : null;
  if (!economics || !funding || !expectedFunding
    || !validateExecutionAndFundingProvenance(provenance, request, economics, funding, expectedFunding)) return null;

  let configurationHash: string;
  let strategyHash: string;
  let scriptHash: string | null;
  try {
    configurationHash = historicalConfigurationHash(config);
    strategyHash = historicalStrategyHash(config, configurationHash);
    scriptHash = historicalScriptHash(config);
  } catch { return null; }
  if ((expectedConfigurationHash !== undefined && expectedConfigurationHash !== configurationHash)
    || result.configurationHash !== configurationHash || result.strategyHash !== strategyHash
    || result.scriptHash !== scriptHash) return null;

  const metrics = metricsFor(record, request.startTime, request.endTime);
  const equityCurve = equityFor(record, request.startTime, request.endTime);
  if (!metrics || !equityCurve || !Number.isSafeInteger(completedAt) || completedAt < 0) return null;
  const report = attestHistoricalReportForConfig({
    seed: dataset.checksum.slice(0, 8),
    generatedAt: new Date(completedAt).toISOString(),
    metrics,
    equityCurve,
    disclaimer: "WEEX 歷史行情回測，不代表未來績效",
  }, {
    level: "historical", provider: "WEEX", market: request.market, symbol: request.symbol,
    interval: request.interval, startTime: request.startTime, endTime: request.endTime,
    collectedAt: completedAt, candleCount: result.equityCurve.length, complete: true,
    feeRate: economics.feeRate, slippageRate: economics.slippageRate,
    fundingIncluded: funding.mode === "historical", gapPolicy: request.gapPolicy,
    datasetDigest: dataset.checksum, engineVersion: result.engineVersion,
  }, config);
  return { report, strategyVersionId: record.strategyVersionId, backtestJobId: record.id };
}
