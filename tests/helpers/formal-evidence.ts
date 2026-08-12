import { STRATEGY_PRESETS } from "../../data/strategies";
import { historicalConfigurationHash } from "../../lib/historical-evidence";
import type { FormalEvidenceGateRow } from "../../lib/server/formal-evidence-gate";

export function validFormalEvidenceRow(): FormalEvidenceGateRow {
  const config = STRATEGY_PRESETS[2]!;
  const configHash = historicalConfigurationHash(config);
  const checksum = "b".repeat(64);
  return {
    strategyVersionId: "version_1",
    configHash,
    sourceHash: null,
    configJson: JSON.stringify(config),
    sourceCode: null,
    jobId: "job_1",
    jobStatus: "succeeded",
    jobEvidenceLevel: "historical",
    requestJson: JSON.stringify({
      strategyVersionId: "version_1", market: config.market, symbol: config.symbol,
      interval: config.timeframe, startTime: 1_000, endTime: 3_000, initialCapital: "10000",
      feeRate: "0.001", slippageRate: "0.0005", leverage: String(config.leverage),
      fundingMode: "none", gapPolicy: "fail",
    }),
    completedAt: 4_000,
    datasetId: "dataset_1",
    datasetMarket: config.market,
    datasetSymbol: config.symbol,
    datasetInterval: config.timeframe,
    datasetSource: "WEEX public API",
    requestedStartAt: 1_000,
    requestedEndAt: 3_000,
    actualStartAt: 1_000,
    actualEndAt: 2_999,
    datasetComplete: 1,
    gapsJson: "[]",
    checksum,
    resultId: "result_1",
    resultEvidenceLevel: "historical",
    initialCapital: "10000",
    feeRate: "0.001",
    slippageRate: "0.0005",
    leverage: String(config.leverage),
    fundingJson: JSON.stringify({ mode: "none", events: [] }),
    metricsJson: JSON.stringify({ totalReturn: "0.1", annualizedReturn: "0.2", maxDrawdown: "0.05",
      winRate: "0.6", profitFactor: "1.5", sharpe: "1.2", trades: 4 }),
    provenanceJson: JSON.stringify({
      provider: "WEEX", dataSource: "WEEX", sourceKind: "public-api",
      requestedRange: { startTime: 1_000, endTime: 3_000 },
      fetchedRange: { startTime: 1_000, endTime: 2_999 }, gaps: [], gapCount: 0,
      duplicateCount: 0, incompleteCount: 0, complete: true, feeRate: "0.001",
      slippageRate: "0.0005", fundingTreatment: { suppliedEvents: 0, appliedEvents: 0,
        netFunding: "0", convention: "long-pays-positive-short-receives-positive" },
      market: config.market, symbol: config.symbol,
      interval: config.timeframe, engineVersion: "test", configHash, strategyHash: configHash,
      datasetDigest: checksum, fundingMode: "none", fundingCoverageComplete: true,
      executionConvention: { signalEvaluation: "completed-candle-close",
        signalExecution: "next-candle-open", riskTrigger: "close-only-not-intrabar" },
      liquidationModel: { maintenanceMarginRate: "0.02", maximumSupportedLeverage: "500",
        check: "funding-event-mark-immediately-then-candle-low-long-high-short",
        orderingAssumption: "funding-applied-at-event-timestamp-before-candle-wide-adverse-extreme",
        model: "fixed-conservative-not-weex-tier-exact" },
      maintenanceMarginAssumption: { rate: "0.02", model: "fixed-conservative-not-weex-tier-exact" },
    }),
    equityCurveJson: JSON.stringify([
      { timestamp: 1_000, equity: "10000", funding: "0" },
      { timestamp: 2_999, equity: "11000", funding: "0" },
    ]),
    engineVersion: "test",
    configurationHash: configHash,
    strategyHash: configHash,
    scriptHash: null,
  };
}

export function validHistoricalFundingEvidenceRow(): FormalEvidenceGateRow {
  const row = validFormalEvidenceRow();
  const request = JSON.parse(row.requestJson as string) as Record<string, unknown>;
  const provenance = JSON.parse(row.provenanceJson as string) as Record<string, unknown>;
  const equityCurve = JSON.parse(row.equityCurveJson as string) as Array<Record<string, unknown>>;
  return {
    ...row,
    requestJson: JSON.stringify({ ...request, fundingMode: "historical" }),
    fundingJson: JSON.stringify({
      mode: "historical",
      events: [{ timestamp: 2_000, rate: "0.0001", markPrice: "100" }],
      coverage: {
        requestedStartTime: 1_000,
        requestedEndTime: 3_000,
        returnedFundingStartTime: 2_000,
        returnedFundingEndTime: 2_000,
        fundingRangeCovered: true,
        requestedEvents: 1,
        matchedEvents: 1,
        missingMarkTimestamps: [],
      },
      provenance: {
        provider: "WEEX",
        sourceKind: "public-api",
        fundingEndpoint: "/capi/v2/market/getHistoryFundRate",
        markEndpoint: "/capi/v3/market/historyKlines",
        priceType: "MARK",
        collectedAt: 3_500,
        fundingLimit: 100,
        markMaxAgeMs: 14_400_000,
        markPages: 1,
        markCandles: 1,
        truncated: false,
      },
    }),
    provenanceJson: JSON.stringify({
      ...provenance,
      fundingMode: "historical",
      fundingTreatment: {
        convention: "long-pays-positive-short-receives-positive",
        suppliedEvents: 1,
        appliedEvents: 1,
        netFunding: "-1",
      },
    }),
    equityCurveJson: JSON.stringify(equityCurve.map((point, index) => (
      index === equityCurve.length - 1 ? { ...point, funding: "-1" } : point
    ))),
  };
}
