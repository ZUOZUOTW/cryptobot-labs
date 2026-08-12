import { safeCanonicalJsonStringify } from "./control-plane/schemas";
import type {
  BacktestReport,
  BotConfig,
  WeexHistoricalEvidence,
  WeexHistoricalPerformance,
} from "./types";

export const HISTORICAL_ATTESTATION_SCHEME = "sha256-content-binding-v1" as const;
const HASH = /^[a-f0-9]{64}$/;
const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const rotateRight = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

/** Browser-safe synchronous SHA-256 used only for content binding, never as an authenticity signature. */
export function sha256Hex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const before15 = words[index - 15]!;
      const before2 = words[index - 2]!;
      const sigma0 = rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
      const sigma1 = rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choose = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + sum1 + choose + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + temporary1) >>> 0;
      d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, "0")).join("");
}

const configurationPayload = (config: BotConfig): BotConfig => ({
  id: config.id,
  name: config.name,
  exchange: config.exchange,
  market: config.market,
  symbol: config.symbol,
  timeframe: config.timeframe,
  logicMode: config.logicMode,
  ...(config.tradeDirection === undefined ? {} : { tradeDirection: config.tradeDirection }),
  leverage: config.leverage,
  blocks: config.blocks.map((block) => ({
    id: block.id,
    name: block.name,
    group: block.group,
    description: block.description,
    parameters: block.parameters.map((parameter) => ({
      key: parameter.key,
      label: parameter.label,
      value: parameter.value,
      min: parameter.min,
      max: parameter.max,
      step: parameter.step,
      ...(parameter.suffix === undefined ? {} : { suffix: parameter.suffix }),
    })),
  })),
  ...(config.source === undefined ? {} : { source: config.source }),
});

export const historicalConfigurationHash = (config: BotConfig): string => sha256Hex(
  safeCanonicalJsonStringify(configurationPayload(config), "public historical config", 262_144),
);

export const historicalStrategyHash = (_config: BotConfig, configurationHash: string): string => configurationHash;

export const historicalScriptHash = (config: BotConfig): string | null => (
  config.source === undefined ? null : sha256Hex(config.source)
);

type UnattestedHistoricalEvidence = Omit<WeexHistoricalEvidence, "attestation">;

const attestationPayload = (
  report: Omit<BacktestReport, "evidence">,
  evidence: UnattestedHistoricalEvidence,
): unknown => ({
  evidence,
  report: {
    seed: report.seed,
    generatedAt: report.generatedAt,
    metrics: report.metrics,
    equityCurve: report.equityCurve,
    ...(report.directionalMetrics === undefined ? {} : { directionalMetrics: report.directionalMetrics }),
    disclaimer: report.disclaimer,
  },
});

export const historicalReportDigest = (
  report: Omit<BacktestReport, "evidence">,
  evidence: UnattestedHistoricalEvidence,
): string => sha256Hex(safeCanonicalJsonStringify(
  attestationPayload(report, evidence),
  "public historical report binding",
  524_288,
));

export function attestHistoricalReport(
  report: Omit<BacktestReport, "evidence">,
  evidence: UnattestedHistoricalEvidence,
): BacktestReport {
  return {
    ...report,
    evidence: {
      ...evidence,
      attestation: {
        scheme: HISTORICAL_ATTESTATION_SCHEME,
        digest: historicalReportDigest(report, evidence),
      },
    },
  };
}

export function attestHistoricalReportForConfig(
  report: Omit<BacktestReport, "evidence">,
  evidence: Omit<UnattestedHistoricalEvidence, "configurationHash" | "strategyHash" | "scriptHash">,
  config: BotConfig,
): BacktestReport {
  const configurationHash = historicalConfigurationHash(config);
  const strategyHash = historicalStrategyHash(config, configurationHash);
  return attestHistoricalReport(report, {
    ...evidence,
    configurationHash,
    strategyHash,
    scriptHash: historicalScriptHash(config),
  });
}

const finiteMetrics = (report: BacktestReport): boolean => Object.values(report.metrics)
  .every((value) => typeof value === "number" && Number.isFinite(value));

export function isVerifiedHistoricalReport(report: BacktestReport): boolean {
  const evidence = report.evidence;
  if (!evidence || evidence.level !== "historical" || evidence.provider !== "WEEX" || !evidence.complete
    || evidence.startTime >= evidence.endTime || evidence.candleCount < 2
    || report.disclaimer !== "WEEX 歷史行情回測，不代表未來績效"
    || report.generatedAt !== new Date(evidence.collectedAt).toISOString()
    || !HASH.test(evidence.datasetDigest) || report.seed !== evidence.datasetDigest.slice(0, 8)
    || !HASH.test(evidence.configurationHash) || !HASH.test(evidence.strategyHash)
    || (evidence.scriptHash !== null && !HASH.test(evidence.scriptHash))
    || (evidence.gapPolicy !== "fail" && evidence.gapPolicy !== "disclose")
    || evidence.attestation?.scheme !== HISTORICAL_ATTESTATION_SCHEME
    || !HASH.test(evidence.attestation.digest)
    || !finiteMetrics(report)
    || !report.equityCurve.every(({ label, value }) => typeof label === "string" && Number.isFinite(value))) return false;
  try {
    const unattested = { ...evidence };
    delete (unattested as Partial<WeexHistoricalEvidence>).attestation;
    const reportWithoutEvidence = { ...report };
    delete (reportWithoutEvidence as Partial<BacktestReport>).evidence;
    return historicalReportDigest(reportWithoutEvidence, unattested) === evidence.attestation.digest;
  } catch {
    return false;
  }
}

export function isVerifiedHistoricalReportForConfig(report: BacktestReport, config: BotConfig): boolean {
  if (!isVerifiedHistoricalReport(report)) return false;
  const evidence = report.evidence!;
  try {
    const configurationHash = historicalConfigurationHash(config);
    const strategyHash = historicalStrategyHash(config, configurationHash);
    return evidence.market === config.market
      && evidence.symbol === config.symbol
      && evidence.interval === config.timeframe
      && evidence.configurationHash === configurationHash
      && evidence.strategyHash === strategyHash
      && evidence.scriptHash === historicalScriptHash(config);
  } catch {
    return false;
  }
}

export const performanceAsReport = (performance: WeexHistoricalPerformance): BacktestReport => ({
  seed: performance.evidence.datasetDigest.slice(0, 8),
  generatedAt: performance.generatedAt,
  metrics: performance.metrics,
  equityCurve: performance.equityCurve,
  ...(performance.directionalMetrics === undefined ? {} : { directionalMetrics: performance.directionalMetrics }),
  disclaimer: performance.disclaimer,
  evidence: performance.evidence,
});
