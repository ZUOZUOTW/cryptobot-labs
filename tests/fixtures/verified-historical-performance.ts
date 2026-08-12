import { attestHistoricalReportForConfig } from "../../lib/historical-evidence";
import type {
  BotDefinition,
  BotMetrics,
  EquityPoint,
  WeexHistoricalPerformance,
} from "../../lib/types";

interface FixtureOptions {
  metrics?: BotMetrics;
  equityCurve?: EquityPoint[];
  collectedAt?: number;
  datasetDigest?: string;
}

export function verifiedHistoricalPerformance(
  bot: BotDefinition,
  options: FixtureOptions = {},
): WeexHistoricalPerformance {
  const collectedAt = options.collectedAt ?? 1_754_438_400_000;
  const datasetDigest = options.datasetDigest ?? "d".repeat(64);
  const report = attestHistoricalReportForConfig({
    seed: datasetDigest.slice(0, 8),
    generatedAt: new Date(collectedAt).toISOString(),
    metrics: options.metrics ?? bot.metrics,
    equityCurve: options.equityCurve ?? bot.equityCurve,
    disclaimer: "WEEX 歷史行情回測，不代表未來績效",
  }, {
    level: "historical",
    provider: "WEEX",
    market: bot.market,
    symbol: bot.symbol,
    interval: bot.timeframe,
    startTime: collectedAt - 30 * 24 * 60 * 60 * 1_000,
    endTime: collectedAt,
    collectedAt,
    candleCount: bot.market === "spot" ? 180 : 720,
    complete: true,
    feeRate: "0.001",
    slippageRate: "0.0005",
    fundingIncluded: false,
    gapPolicy: "fail",
    datasetDigest,
    engineVersion: "test",
  }, bot);
  return {
    metrics: report.metrics,
    equityCurve: report.equityCurve,
    generatedAt: report.generatedAt,
    disclaimer: report.disclaimer as "WEEX 歷史行情回測，不代表未來績效",
    evidence: report.evidence!,
  };
}
