import { describe, expect, it } from "vitest";
import { BOT_CATALOG } from "../data/bots";
import {
  attestHistoricalReportForConfig,
  historicalConfigurationHash,
  historicalScriptHash,
  isVerifiedHistoricalReport,
  isVerifiedHistoricalReportForConfig,
  sha256Hex,
} from "../lib/historical-evidence";
import { formalBacktestToReport } from "../lib/formal-backtest-report";
import type { HistoricalBacktestRecord } from "../components/backtests/BacktestResultCard";
import type { BotConfig } from "../lib/types";

const bot = BOT_CATALOG.find(({ id }) => id === "momentum-forge")!;
const config: BotConfig = {
  id: bot.id, name: bot.name, exchange: bot.exchange, market: bot.market, symbol: bot.symbol,
  timeframe: bot.timeframe, logicMode: bot.logicMode, tradeDirection: bot.tradeDirection,
  leverage: bot.leverage, blocks: bot.blocks,
};
const datasetDigest = "d".repeat(64);

const reportFor = (candidate: BotConfig) => attestHistoricalReportForConfig({
  seed: datasetDigest.slice(0, 8), generatedAt: new Date(7_200_000).toISOString(),
  metrics: bot.metrics, equityCurve: bot.equityCurve,
  disclaimer: "WEEX 歷史行情回測，不代表未來績效",
}, {
  level: "historical", provider: "WEEX", market: candidate.market, symbol: candidate.symbol,
  interval: candidate.timeframe, startTime: 0, endTime: 7_200_000, collectedAt: 7_200_000,
  candleCount: 2, complete: true, feeRate: "0.001", slippageRate: "0.0005",
  fundingIncluded: false, gapPolicy: "fail", datasetDigest, engineVersion: "test",
}, candidate);

const formalRecord = (candidate: BotConfig): HistoricalBacktestRecord => {
  const configurationHash = historicalConfigurationHash(candidate);
  const scriptHash = historicalScriptHash(candidate);
  return {
    id: "job_1", strategyVersionId: "version_1", status: "succeeded", evidenceLevel: "historical",
    request: { strategyVersionId: "version_1", market: candidate.market, symbol: candidate.symbol,
      interval: candidate.timeframe, startTime: 0, endTime: 7_200_000, initialCapital: "10000",
      feeRate: "0.001", slippageRate: "0.0005", leverage: String(candidate.leverage),
      fundingMode: "none", gapPolicy: "fail" },
    error: null, createdAt: 1, startedAt: 2, completedAt: 7_200_000,
    dataset: { id: "dataset_1", market: candidate.market, symbol: candidate.symbol,
      interval: candidate.timeframe, source: "WEEX public API", requestedStartAt: 0,
      requestedEndAt: 7_200_000, actualStartAt: 0, actualEndAt: 7_199_999,
      complete: true, gaps: [], checksum: datasetDigest },
    result: {
      id: "result_1", funding: {}, metrics: { totalReturn: "0.1", annualizedReturn: "0.2",
        maxDrawdown: "0.05", winRate: "0.6", profitFactor: "1.5", sharpe: "1.2", trades: 4 },
      provenance: { provider: "WEEX", dataSource: "WEEX", sourceKind: "public-api",
        requestedRange: { startTime: 0, endTime: 7_200_000 }, fetchedRange: { startTime: 0, endTime: 7_199_999 },
        gaps: [], gapCount: 0, duplicateCount: 0, incompleteCount: 0, complete: true,
        feeRate: "0.001", slippageRate: "0.0005", fundingTreatment: { suppliedEvents: 0, appliedEvents: 0,
          netFunding: "0", convention: "long-pays-positive-short-receives-positive" },
        market: candidate.market, symbol: candidate.symbol, interval: candidate.timeframe,
        engineVersion: "test", configHash: configurationHash, strategyHash: configurationHash,
        datasetDigest, executionConvention: { signalEvaluation: "completed-candle-close",
          signalExecution: "next-candle-open", riskTrigger: "close-only-not-intrabar" },
        liquidationModel: { maintenanceMarginRate: "0", maximumSupportedLeverage: "500",
          check: "test", orderingAssumption: "test", model: "test" } },
      equityCurve: [{ timestamp: 3_599_999, equity: "10000" }, { timestamp: 7_199_999, equity: "11000" }],
      engineVersion: "test", configurationHash, strategyHash: configurationHash, scriptHash,
    },
  };
};

describe("historical evidence content binding", () => {
  it("uses a standards-compatible SHA-256 and canonicalizes optional undefined fields", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const withoutUndefined = JSON.parse(JSON.stringify(config)) as BotConfig;
    expect(historicalConfigurationHash(config)).toBe(historicalConfigurationHash(withoutUndefined));
  });

  it("rejects a same-market/symbol/timeframe report moved to another exact configuration", () => {
    const report = reportFor(config);
    const swapped = { ...config, leverage: config.leverage + 1 };
    expect(isVerifiedHistoricalReport(report)).toBe(true);
    expect(isVerifiedHistoricalReportForConfig(report, config)).toBe(true);
    expect(isVerifiedHistoricalReportForConfig(report, swapped)).toBe(false);
  });

  it.each(["metrics", "equity"] as const)("rejects %s tampering", (field) => {
    const report = reportFor(config);
    const tampered = field === "metrics"
      ? { ...report, metrics: { ...report.metrics, totalReturn: report.metrics.totalReturn + 1 } }
      : { ...report, equityCurve: report.equityCurve.map((point, index) => index ? point : { ...point, value: point.value + 1 }) };
    expect(isVerifiedHistoricalReport(tampered)).toBe(false);
  });

  it("accepts an exact formal source result and rejects config, source, result, and dataset swaps", () => {
    const source = "export const strategy={exchange:'WEEX'}; export default()=>({action:'hold',reason:'test'});";
    const sourceConfig = { ...config, blocks: [], source };
    const exact = formalRecord(sourceConfig);
    expect(formalBacktestToReport(exact, sourceConfig)?.report.evidence).toMatchObject({
      configurationHash: historicalConfigurationHash(sourceConfig),
      strategyHash: historicalConfigurationHash(sourceConfig),
      scriptHash: sha256Hex(source),
    });
    expect(formalBacktestToReport(exact, { ...sourceConfig, name: `${sourceConfig.name} v2` })).toBeNull();
    expect(formalBacktestToReport(exact, { ...sourceConfig, source: `${source}\n// changed` })).toBeNull();
    expect(formalBacktestToReport({ ...exact, result: { ...exact.result!, configurationHash: "a".repeat(64) } }, sourceConfig)).toBeNull();
    expect(formalBacktestToReport({ ...exact, dataset: { ...exact.dataset!, checksum: "a".repeat(64) } }, sourceConfig)).toBeNull();
  });
});
