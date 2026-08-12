import { describe, expect, it } from "vitest";
import { hasFormalBacktestEvidence } from "../lib/server/formal-evidence-gate";
import { historicalConfigurationHash, sha256Hex } from "../lib/historical-evidence";
import type { FormalEvidenceGateRow } from "../lib/server/formal-evidence-gate";
import type { BotConfig } from "../lib/types";
import { validFormalEvidenceRow, validHistoricalFundingEvidenceRow } from "./helpers/formal-evidence";

const changeJsonObject = (
  row: FormalEvidenceGateRow,
  key: "requestJson" | "fundingJson" | "provenanceJson",
  change: (value: Record<string, unknown>) => Record<string, unknown>,
): FormalEvidenceGateRow => ({
  ...row,
  [key]: JSON.stringify(change(JSON.parse(row[key] as string) as Record<string, unknown>)),
});

describe("formal evidence boundary gate", () => {
  it("accepts the exact persisted shape produced by a formal backtest", () => {
    expect(hasFormalBacktestEvidence(validFormalEvidenceRow())).toBe(true);
  });

  it("accepts the parsed json/jsonb values returned by the production Postgres adapter", () => {
    const row = validFormalEvidenceRow();
    expect(hasFormalBacktestEvidence({
      ...row,
      configJson: JSON.parse(row.configJson as string) as Record<string, unknown>,
      requestJson: JSON.parse(row.requestJson as string) as Record<string, unknown>,
      gapsJson: JSON.parse(row.gapsJson as string) as unknown[],
      fundingJson: JSON.parse(row.fundingJson as string) as Record<string, unknown>,
      metricsJson: JSON.parse(row.metricsJson as string) as Record<string, unknown>,
      provenanceJson: JSON.parse(row.provenanceJson as string) as Record<string, unknown>,
      equityCurveJson: JSON.parse(row.equityCurveJson as string) as unknown[],
    })).toBe(true);
  });

  it("accepts the exact persisted historical-funding contract produced by the current service", () => {
    expect(hasFormalBacktestEvidence(validHistoricalFundingEvidenceRow())).toBe(true);
  });

  it("accepts the current source strategy storage contract with source in config_json and source_code", () => {
    const row = validFormalEvidenceRow();
    const config = JSON.parse(row.configJson as string) as BotConfig;
    const source = `export const strategy={exchange:"WEEX",market:${JSON.stringify(config.market)},symbol:${JSON.stringify(config.symbol)},timeframe:${JSON.stringify(config.timeframe)}};\nexport default()=>({action:"hold",reason:"test"});`;
    const sourceConfig = { ...config, source };
    const configHash = historicalConfigurationHash(sourceConfig);
    const provenance = { ...JSON.parse(row.provenanceJson as string), configHash, strategyHash: configHash };
    expect(hasFormalBacktestEvidence({
      ...row,
      configJson: JSON.stringify(sourceConfig),
      configHash,
      configurationHash: configHash,
      strategyHash: configHash,
      sourceCode: source,
      sourceHash: sha256Hex(source),
      scriptHash: sha256Hex(source),
      provenanceJson: JSON.stringify(provenance),
    })).toBe(true);
  });

  it.each([
    ["request", (row: ReturnType<typeof validFormalEvidenceRow>) => ({ ...row,
      requestJson: JSON.stringify({ ...JSON.parse(row.requestJson as string), symbol: "ETHUSDT" }) })],
    ["dataset identity", (row: ReturnType<typeof validFormalEvidenceRow>) => ({ ...row, datasetSymbol: "ETHUSDT" })],
    ["coverage", (row: ReturnType<typeof validFormalEvidenceRow>) => ({ ...row, actualEndAt: 2_998 })],
    ["gaps", (row: ReturnType<typeof validFormalEvidenceRow>) => ({ ...row, gapsJson: "[{}]" })],
    ["checksum", (row: ReturnType<typeof validFormalEvidenceRow>) => ({ ...row, checksum: "c".repeat(64) })],
    ["provenance", (row: ReturnType<typeof validFormalEvidenceRow>) => ({ ...row, provenanceJson: "{}" })],
    ["configuration hash", (row: ReturnType<typeof validFormalEvidenceRow>) => ({ ...row,
      configurationHash: "c".repeat(64) })],
    ["strategy hash", (row: ReturnType<typeof validFormalEvidenceRow>) => ({ ...row,
      strategyHash: "c".repeat(64) })],
    ["script hash", (row: ReturnType<typeof validFormalEvidenceRow>) => ({ ...row,
      scriptHash: "c".repeat(64) })],
  ])("rejects tampered %s evidence", (_label, mutate) => {
    expect(hasFormalBacktestEvidence(mutate(validFormalEvidenceRow()))).toBe(false);
  });

  it.each([
    ["invalid funding mode", (row: FormalEvidenceGateRow) => changeJsonObject(row, "requestJson",
      (request) => ({ ...request, fundingMode: "claimed" }))],
    ["invalid market", (row: FormalEvidenceGateRow) => changeJsonObject(row, "requestJson",
      (request) => ({ ...request, market: "options" }))],
    ["none payload with extra historical claims", (row: FormalEvidenceGateRow) => changeJsonObject(row, "fundingJson",
      (funding) => ({ ...funding, coverage: {} }))],
    ["request-only historical funding claim", (row: FormalEvidenceGateRow) => {
      const claimed = changeJsonObject(row, "requestJson", (request) => ({ ...request, fundingMode: "historical" }));
      return changeJsonObject(claimed, "provenanceJson", (provenance) => ({ ...provenance, fundingMode: "historical" }));
    }],
  ])("rejects %s instead of trusting request JSON", (_label, mutate) => {
    expect(hasFormalBacktestEvidence(mutate(validFormalEvidenceRow()))).toBe(false);
  });

  it.each([
    ["event outside the request range", (funding: Record<string, unknown>) => ({ ...funding,
      events: [{ timestamp: 3_000, rate: "0.0001", markPrice: "100" }] })],
    ["non-positive event mark", (funding: Record<string, unknown>) => ({ ...funding,
      events: [{ timestamp: 2_000, rate: "0.0001", markPrice: "0" }] })],
    ["incomplete coverage counts", (funding: Record<string, unknown>) => ({ ...funding,
      coverage: { ...(funding.coverage as Record<string, unknown>), matchedEvents: 0 } })],
    ["missing mark coverage", (funding: Record<string, unknown>) => ({ ...funding,
      coverage: { ...(funding.coverage as Record<string, unknown>), missingMarkTimestamps: [2_000] } })],
    ["private funding provenance", (funding: Record<string, unknown>) => ({ ...funding,
      provenance: { ...(funding.provenance as Record<string, unknown>), fundingEndpoint: "/private/funding" } })],
    ["truncated funding provenance", (funding: Record<string, unknown>) => ({ ...funding,
      provenance: { ...(funding.provenance as Record<string, unknown>), truncated: true } })],
    ["unexpected funding field", (funding: Record<string, unknown>) => ({ ...funding, trusted: true })],
  ])("rejects historical funding with %s", (_label, mutate) => {
    const row = changeJsonObject(validHistoricalFundingEvidenceRow(), "fundingJson", mutate);
    expect(hasFormalBacktestEvidence(row)).toBe(false);
  });

  it.each([
    ["supplied event count", (provenance: Record<string, unknown>) => ({ ...provenance,
      fundingTreatment: { ...(provenance.fundingTreatment as Record<string, unknown>), suppliedEvents: 0 } })],
    ["applied event count", (provenance: Record<string, unknown>) => ({ ...provenance,
      fundingTreatment: { ...(provenance.fundingTreatment as Record<string, unknown>), appliedEvents: 0 } })],
    ["applied events over supplied events", (provenance: Record<string, unknown>) => ({ ...provenance,
      fundingTreatment: { ...(provenance.fundingTreatment as Record<string, unknown>), appliedEvents: 2 } })],
    ["net funding aggregate", (provenance: Record<string, unknown>) => ({ ...provenance,
      fundingTreatment: { ...(provenance.fundingTreatment as Record<string, unknown>), netFunding: "1" } })],
    ["funding convention", (provenance: Record<string, unknown>) => ({ ...provenance,
      fundingTreatment: { ...(provenance.fundingTreatment as Record<string, unknown>), convention: "exchange-pays-all" } })],
    ["funding mode", (provenance: Record<string, unknown>) => ({ ...provenance, fundingMode: "none" })],
    ["funding coverage", (provenance: Record<string, unknown>) => ({ ...provenance, fundingCoverageComplete: false })],
    ["execution convention", (provenance: Record<string, unknown>) => ({ ...provenance,
      executionConvention: { ...(provenance.executionConvention as Record<string, unknown>),
        signalExecution: "same-candle-close" } })],
    ["liquidation maintenance rate", (provenance: Record<string, unknown>) => ({ ...provenance,
      liquidationModel: { ...(provenance.liquidationModel as Record<string, unknown>), maintenanceMarginRate: "0" } })],
    ["liquidation check", (provenance: Record<string, unknown>) => ({ ...provenance,
      liquidationModel: { ...(provenance.liquidationModel as Record<string, unknown>), check: "close-only" } })],
    ["maintenance assumption", (provenance: Record<string, unknown>) => ({ ...provenance,
      maintenanceMarginAssumption: { ...(provenance.maintenanceMarginAssumption as Record<string, unknown>), rate: "0" } })],
  ])("rejects tampered %s semantics", (_label, mutate) => {
    const row = changeJsonObject(validHistoricalFundingEvidenceRow(), "provenanceJson", mutate);
    expect(hasFormalBacktestEvidence(row)).toBe(false);
  });
});
