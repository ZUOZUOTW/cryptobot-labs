import { BOT_CATALOG } from "../../data/bots";
import { createVisualHistoricalEvaluator } from "../historical-strategy";
import { safeCanonicalJsonStringify } from "../control-plane/schemas";
import type {
  BacktestReport, BotConfig, BotMetrics, EquityPoint, WeexHistoricalPerformance,
} from "../types";
import { validateConfig } from "../strategy-validation";
import {
  BACKTEST_SANDBOX_BUDGET,
  createQuickJsStrategySandbox,
  runHistoricalBacktest,
  type HistoricalBacktestResult,
  type HistoricalDataset,
  type StrategyEvaluator,
  type StrategySandbox,
} from "../../packages/trading-core/src";
import {
  MAX_FUTURES_HISTORY_RANGE_MS,
  MAX_SPOT_HISTORY_CANDLES,
  WeexPublicClient,
  createFetchTransport,
  parseIntervalMs,
  validateCandleDataset,
} from "../../packages/weex-client/src";
import type { PublicHistoricalBacktestAssumptions } from "../weex-historical-client";

export const PUBLIC_HISTORICAL_ENGINE_VERSION = "cryptobot-labs-weex-public-v1";
export const WEEX_HISTORICAL_DISCLAIMER = "WEEX 歷史行情回測，不代表未來績效" as const;
export const PUBLIC_HISTORICAL_FEE_RATE = "0.001";
export const PUBLIC_HISTORICAL_SLIPPAGE_RATE = "0.0005";
const DAY_MS = 24 * 60 * 60 * 1_000;
const TARGET_RANGE_MS = 30 * DAY_MS;
const DATA_LAG_ALLOWANCE_MS = 2 * 60 * 1_000;
const MAX_PUBLIC_CANDLES = 720;

export interface PublicHistoricalPerformanceDependencies {
  marketData?: Pick<WeexPublicClient, "collectHistoricalCandles" | "collectHistoricalFunding">;
  now?: () => number;
  createSandbox?: () => Promise<StrategySandbox>;
}

const DEFAULT_ASSUMPTIONS: PublicHistoricalBacktestAssumptions = {
  feeRate: PUBLIC_HISTORICAL_FEE_RATE,
  slippageRate: PUBLIC_HISTORICAL_SLIPPAGE_RATE,
  fundingMode: "none",
  gapPolicy: "fail",
};

const round = (value: number): number => Number(value.toFixed(2));
const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

function exactDataset(dataset: HistoricalDataset, config: BotConfig, startTime: number, endTime: number, gapPolicy: "fail" | "disclose"): HistoricalDataset {
  const intervalMs = parseIntervalMs(config.timeframe);
  const candles = dataset.candles
    .filter((candle) => candle.openTime >= startTime && candle.openTime < endTime)
    .map((candle) => ({ ...candle }));
  const validation = validateCandleDataset(candles, intervalMs);
  const first = candles[0]?.openTime;
  const last = candles.at(-1)?.closeTime;
  const exactCoverage = first === startTime && last === endTime - 1
    && candles.every((candle, index) => index === 0 || candle.openTime - candles[index - 1]!.openTime === intervalMs)
    && validation.ordered && validation.duplicates.length === 0
    && (gapPolicy === "disclose" || (validation.gaps.length === 0 && validation.incompleteCount === 0));
  if (!exactCoverage || candles.length < 2) throw new Error("WEEX 歷史行情未完整覆蓋指定回測區間");
  return {
    request: { market: config.market, symbol: config.symbol, interval: config.timeframe, startTime, endTime },
    candles,
    intervalMs,
    complete: true,
    validation,
    provenance: {
      ...dataset.provenance,
      requestedStartTime: startTime,
      requestedEndTime: endTime,
      returnedStartTime: first,
      returnedEndTime: last + 1,
      truncated: false,
    },
  };
}

function historicalWindow(config: BotConfig, now: number): { startTime: number; endTime: number; limit: number } {
  const intervalMs = parseIntervalMs(config.timeframe);
  const endTime = Math.floor((now - DATA_LAG_ALLOWANCE_MS) / intervalMs) * intervalMs;
  const rangeLimit = Math.max(2, Math.floor(MAX_FUTURES_HISTORY_RANGE_MS / intervalMs));
  const target = Math.max(2, Math.floor(TARGET_RANGE_MS / intervalMs));
  const candleCount = Math.min(MAX_PUBLIC_CANDLES, rangeLimit, config.market === "spot" ? MAX_SPOT_HISTORY_CANDLES : Infinity, target);
  if (!Number.isSafeInteger(endTime) || endTime <= 0 || candleCount < 2) throw new Error("無法建立 WEEX 歷史行情區間");
  return { startTime: endTime - candleCount * intervalMs, endTime, limit: config.market === "spot" ? 1_000 : 100 };
}

function stabilityScore(result: HistoricalBacktestResult): number {
  const values = result.equityCurve.map(({ equity }) => Number(equity)).filter(Number.isFinite);
  if (values.length < 2) return 0;
  const returns = values.slice(1).map((value, index) => values[index]! === 0 ? 0 : value / values[index]! - 1);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const deviation = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length);
  const positiveRatio = returns.filter((value) => value > 0).length / returns.length;
  const volatilityScore = Math.max(0, 1 - deviation * Math.sqrt(returns.length));
  const drawdownScore = Math.max(0, 1 - Math.abs(Number(result.metrics.maxDrawdown)) / 100);
  return round(Math.min(100, Math.max(0, volatilityScore * 50 + positiveRatio * 25 + drawdownScore * 25)));
}

function metrics(result: HistoricalBacktestResult, startTime: number, endTime: number): BotMetrics {
  return {
    totalReturn: round(Number(result.metrics.totalReturn) * 100),
    annualizedReturn: round(Number(result.metrics.annualizedReturn) * 100),
    maxDrawdown: round(-Number(result.metrics.maxDrawdown) * 100),
    winRate: round(Number(result.metrics.winRate) * 100),
    profitFactor: result.metrics.profitFactor === null ? 0 : round(Number(result.metrics.profitFactor)),
    sharpe: round(Number(result.metrics.sharpe)),
    trades: result.metrics.trades,
    runningDays: Math.max(1, Math.round((endTime - startTime) / DAY_MS)),
    stability: stabilityScore(result),
  };
}

function chartPoints(result: HistoricalBacktestResult, initialCapital: number): EquityPoint[] {
  const maximumPoints = 48;
  const step = Math.max(1, Math.ceil(result.equityCurve.length / maximumPoints));
  const selected = result.equityCurve.filter((_, index) => index % step === 0 || index === result.equityCurve.length - 1);
  return selected.map(({ timestamp, equity }) => ({
    label: new Date(timestamp).toISOString().slice(5, 10).replace("-", "/"),
    value: round(Number(equity) / initialCapital * 100),
  }));
}

async function evaluatorFor(config: BotConfig, createSandbox?: () => Promise<StrategySandbox>): Promise<{
  evaluator: StrategyEvaluator; sandbox: StrategySandbox | null; strategyHash: string;
}> {
  const configHash = await sha256(safeCanonicalJsonStringify(config, "public historical config", 262_144));
  if (config.source === undefined) return { evaluator: createVisualHistoricalEvaluator(config), sandbox: null, strategyHash: configHash };
  const visualPolicy = createVisualHistoricalEvaluator({ ...config, source: undefined });
  const sourceHash = await sha256(config.source);
  const sandbox = await (createSandbox ?? (() => createQuickJsStrategySandbox(BACKTEST_SANDBOX_BUDGET)))();
  return {
    sandbox,
    strategyHash: sourceHash,
    evaluator: {
      maximumLookback: 1024,
      riskPolicy: visualPolicy.riskPolicy,
      evaluate: async (input) => {
        const evaluated = await sandbox.evaluate({ source: config.source!, input, now: input.now, randomSeed: `${sourceHash}:${input.now}` });
        if (evaluated.scriptHash !== sourceHash) throw new Error("JavaScript 策略完整性驗證失敗");
        return evaluated.signal;
      },
    },
  };
}

export async function runWeexHistoricalPerformance(
  config: BotConfig,
  dependencies: PublicHistoricalPerformanceDependencies = {},
  suppliedDataset?: HistoricalDataset,
  assumptions: PublicHistoricalBacktestAssumptions = DEFAULT_ASSUMPTIONS,
): Promise<BacktestReport> {
  const normalizedConfig = JSON.parse(JSON.stringify(config)) as BotConfig;
  const validation = validateConfig(normalizedConfig);
  if (!validation.valid) throw new Error(`策略設定無效：${validation.errors.join("；")}`);
  const now = (dependencies.now ?? Date.now)();
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error("伺服器時間無效");
  const window = historicalWindow(normalizedConfig, now);
  const marketData = dependencies.marketData ?? new WeexPublicClient(createFetchTransport({ timeoutMs: 12_000, maximumResponseBytes: 4_194_304 }), () => now);
  const collected = suppliedDataset ?? await marketData.collectHistoricalCandles({
    market: normalizedConfig.market,
    symbol: normalizedConfig.symbol,
    interval: normalizedConfig.timeframe,
    startTime: window.startTime,
    endTime: window.endTime,
    limit: window.limit,
  });
  const normalizedAssumptions = {
    ...assumptions,
    fundingMode: normalizedConfig.market === "spot" ? "none" as const : assumptions.fundingMode,
  };
  const dataset = exactDataset(collected, normalizedConfig, window.startTime, window.endTime, normalizedAssumptions.gapPolicy);
  const fundingDataset = normalizedAssumptions.fundingMode === "historical"
    ? await marketData.collectHistoricalFunding({
      market: "futures",
      symbol: normalizedConfig.symbol,
      startTime: window.startTime,
      endTime: window.endTime,
      strict: true,
    })
    : null;
  const configHash = await sha256(safeCanonicalJsonStringify(normalizedConfig, "public historical config", 262_144));
  const prepared = await evaluatorFor(normalizedConfig, dependencies.createSandbox);
  const initialCapital = 10_000;
  const maintenanceMarginRate = normalizedConfig.market === "spot" ? undefined : String(Math.min(0.02, 0.5 / normalizedConfig.leverage));
  let result: HistoricalBacktestResult;
  try {
    result = await runHistoricalBacktest({
      dataset,
      evaluator: prepared.evaluator,
      initialCapital: String(initialCapital),
      feeRate: normalizedAssumptions.feeRate,
      slippageRate: normalizedAssumptions.slippageRate,
      leverage: String(normalizedConfig.leverage),
      ...(maintenanceMarginRate === undefined ? {} : { maintenanceMarginRate }),
      funding: fundingDataset?.funding ?? [],
      gapPolicy: normalizedAssumptions.gapPolicy,
      engineVersion: PUBLIC_HISTORICAL_ENGINE_VERSION,
      configHash,
      strategyHash: prepared.strategyHash,
    });
  } finally {
    await prepared.sandbox?.dispose();
  }
  const evidence = {
    level: "historical" as const,
    provider: "WEEX" as const,
    market: normalizedConfig.market,
    symbol: normalizedConfig.symbol,
    interval: normalizedConfig.timeframe,
    startTime: window.startTime,
    endTime: window.endTime,
    collectedAt: dataset.provenance.collectedAt,
    candleCount: dataset.candles.length,
    complete: dataset.complete,
    feeRate: normalizedAssumptions.feeRate,
    slippageRate: normalizedAssumptions.slippageRate,
    fundingIncluded: fundingDataset !== null,
    datasetDigest: result.provenance.datasetDigest,
    engineVersion: PUBLIC_HISTORICAL_ENGINE_VERSION,
  };
  return {
    seed: result.provenance.datasetDigest.slice(0, 8),
    generatedAt: new Date(evidence.collectedAt).toISOString(),
    metrics: metrics(result, window.startTime, window.endTime),
    equityCurve: chartPoints(result, initialCapital),
    disclaimer: WEEX_HISTORICAL_DISCLAIMER,
    evidence,
  };
}

export async function runWeexBotCatalogPerformance(
  dependencies: PublicHistoricalPerformanceDependencies = {},
): Promise<Record<string, WeexHistoricalPerformance>> {
  const now = (dependencies.now ?? Date.now)();
  const marketData = dependencies.marketData ?? new WeexPublicClient(createFetchTransport({ timeoutMs: 12_000, maximumResponseBytes: 4_194_304 }), () => now);
  const groups = new Map<string, typeof BOT_CATALOG>();
  for (const bot of BOT_CATALOG) {
    const key = `${bot.market}:${bot.symbol}:${bot.timeframe}`;
    groups.set(key, [...(groups.get(key) ?? []), bot]);
  }
  const entries = await Promise.all([...groups.values()].map(async (bots) => {
    const first = bots[0]!;
    const window = historicalWindow(first, now);
    const dataset = await marketData.collectHistoricalCandles({ market: first.market, symbol: first.symbol,
      interval: first.timeframe, startTime: window.startTime, endTime: window.endTime, limit: window.limit });
    return Promise.all(bots.map(async (bot) => {
      const config: BotConfig = {
        id: bot.id,
        name: bot.name,
        exchange: bot.exchange,
        market: bot.market,
        symbol: bot.symbol,
        timeframe: bot.timeframe,
        logicMode: bot.logicMode,
        leverage: bot.leverage,
        blocks: bot.blocks.map((block) => ({ ...block, parameters: block.parameters.map((parameter) => ({ ...parameter })) })),
        ...(bot.source === undefined ? {} : { source: bot.source }),
      };
      const report = await runWeexHistoricalPerformance(config, { ...dependencies, marketData, now: () => now }, dataset);
      return [bot.id, {
        metrics: report.metrics,
        equityCurve: report.equityCurve,
        generatedAt: report.generatedAt,
        disclaimer: WEEX_HISTORICAL_DISCLAIMER,
        evidence: report.evidence!,
      }] as const;
    }));
  }));
  return Object.fromEntries(entries.flat());
}
