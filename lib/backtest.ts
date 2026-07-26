import type { BacktestReport, BotConfig, BotMetrics, EquityPoint } from "./types";
import { validateConfig } from "./strategy-validation";
import { resolvedTradeDirection } from "./trade-direction";

const DISCLAIMER = "模擬回測資料，不代表未來績效" as const;
const MONTHS = 36;

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
};

const stableStringify = (value: unknown): string => JSON.stringify(stableValue(value));

export const backtestConfigFingerprint = (config: BotConfig): string => stableStringify({
  ...config,
  tradeDirection: resolvedTradeDirection(config),
});

const hashString = (source: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const round = (value: number): number => Number(value.toFixed(2));

const parameterValue = (config: BotConfig, blockId: string, key: string): number | undefined => (
  config.blocks.find((block) => block.id === blockId)
    ?.parameters.find((parameter) => parameter.key === key)?.value
);

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.max(minimum, Math.min(maximum, value))
);

const positionFraction = (config: BotConfig): number => {
  const fixedPosition = parameterValue(config, "fixed-position", "positionSize");
  if (fixedPosition !== undefined) return clamp(fixedPosition / 100, 0.01, 1);

  const riskPerTrade = parameterValue(config, "atr-sizing", "riskPerTrade");
  if (riskPerTrade !== undefined) {
    const riskDistance = parameterValue(config, "stop-loss", "stopLoss")
      ?? parameterValue(config, "trailing-stop", "trailingDistance")
      ?? 4;
    return clamp(riskPerTrade / riskDistance, 0.02, 1);
  }
  return 0.25;
};

const maximumDrawdown = (curve: number[]): number => {
  let peak = 100;
  let drawdown = 0;
  for (const equity of curve) {
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, ((equity - peak) / peak) * 100);
  }
  return round(drawdown);
};

const deriveMetrics = (returns: number[], curve: number[], strategyCount: number): BotMetrics => {
  const totalReturn = ((curve.at(-1) ?? 100) / 100 - 1) * 100;
  const years = returns.length / 12;
  const annualizedReturn = (Math.pow((curve.at(-1) ?? 100) / 100, 1 / years) - 1) * 100;
  const wins = returns.filter((item) => item > 0);
  const losses = returns.filter((item) => item < 0);
  const gains = wins.reduce((sum, item) => sum + item, 0);
  const lossMagnitude = Math.abs(losses.reduce((sum, item) => sum + item, 0));
  const mean = returns.reduce((sum, item) => sum + item, 0) / returns.length;
  const variance = returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / returns.length;
  const deviation = Math.sqrt(variance);
  const positiveMonths = wins.length / returns.length;
  const consistency = Math.max(0, 1 - deviation / Math.max(Math.abs(mean), 0.01));
  const activity = returns.reduce((sum, item) => sum + Math.abs(item), 0);

  return {
    totalReturn: round(totalReturn),
    annualizedReturn: round(annualizedReturn),
    maxDrawdown: maximumDrawdown(curve),
    winRate: round(positiveMonths * 100),
    profitFactor: round(lossMagnitude === 0 ? gains * 100 : gains / lossMagnitude),
    sharpe: round(deviation === 0 ? 0 : (mean / deviation) * Math.sqrt(12)),
    trades: Math.max(1, Math.round(strategyCount * returns.length + activity * 180)),
    runningDays: Math.round(returns.length * (365 / 12)),
    stability: round(Math.min(100, Math.max(0, (consistency * 0.65 + positiveMonths * 0.35) * 100))),
  };
};

export const runBacktest = (config: BotConfig): BacktestReport => {
  const validation = validateConfig(config);
  if (!validation.valid) throw new Error(`策略設定無效：${validation.errors.join("；")}`);

  const hash = hashString(backtestConfigFingerprint(config));
  const seed = hash.toString(16).padStart(8, "0");
  // Keep the synthetic market path stable when users compare parameter changes.
  const marketSeed = hashString(stableStringify({
    market: config.market,
    symbol: config.symbol,
    timeframe: config.timeframe,
  }));
  const random = seededRandom(marketSeed);
  const strategyCount = config.blocks.length;
  const riskCount = config.blocks.filter((strategy) => strategy.group === "risk").length;
  const entryCount = config.blocks.filter((strategy) => strategy.group === "entry").length;
  const confirmCount = config.blocks.filter((strategy) => strategy.group === "confirm").length;
  const leverage = config.market === "spot" ? 1 : config.leverage;
  const allocation = positionFraction(config);
  const effectiveExposure = leverage * allocation;
  const simulatedExposure = Math.min(12, effectiveExposure);
  const monthlyTrades = 2 + entryCount * 2 + confirmCount + (config.logicMode === "any" ? 2 : 0);
  const strategyEdge = (entryCount > 0 ? 0.001 : -0.002)
    + confirmCount * 0.0008 + riskCount * 0.0004
    - Math.max(0, entryCount - 1) * 0.0006;
  const exposureDrag = Math.pow(Math.max(0, effectiveExposure - 1), 1.12) * 0.0035;
  const stopLoss = parameterValue(config, "stop-loss", "stopLoss");
  const trailingStop = parameterValue(config, "trailing-stop", "trailingDistance");
  const dailyLoss = parameterValue(config, "maximum-daily-loss", "maximumDailyLoss");
  const takeProfit = parameterValue(config, "take-profit", "takeProfit");
  const lossCaps = [
    stopLoss === undefined ? undefined : stopLoss * Math.sqrt(monthlyTrades) / 100,
    trailingStop === undefined ? undefined : trailingStop * Math.sqrt(monthlyTrades) / 100,
    dailyLoss === undefined ? undefined : dailyLoss * Math.sqrt(20) / 100,
  ].filter((value): value is number => value !== undefined);
  const maximumMonthlyLoss = Math.min(0.95, lossCaps.length > 0 ? Math.min(...lossCaps) : 0.95);
  const maximumMonthlyGain = Math.min(0.8,
    takeProfit === undefined ? 0.8 : takeProfit * Math.sqrt(monthlyTrades) / 100);
  const marketRegime = [-0.018, 0.012, 0.025, -0.01, 0.008, -0.055, 0.02, 0.004, -0.025, 0.03, -0.012, 0.015];
  const returns: number[] = [];
  const equityValues: number[] = [];
  let equity = 100;

  for (let month = 0; month < MONTHS; month += 1) {
    const centeredNoise = (random() + random() + random() - 1.5) / 1.5;
    const underlyingReturn = 0.002 + marketRegime[month % marketRegime.length]! + centeredNoise * 0.045;
    const unboundedReturn = underlyingReturn * simulatedExposure
      + strategyEdge * allocation - exposureDrag;
    const monthlyReturn = clamp(unboundedReturn, -maximumMonthlyLoss, maximumMonthlyGain);
    returns.push(monthlyReturn);
    equity *= 1 + monthlyReturn;
    equityValues.push(equity);
  }

  const equityCurve: EquityPoint[] = equityValues.map((value, index) => ({
    label: `第 ${String(index + 1).padStart(2, "0")} 月`,
    value: round(value),
  }));
  const generatedAtOffset = hash % (3650 * 24 * 60);

  return {
    seed,
    generatedAt: new Date(Date.UTC(2020, 0, 1) + generatedAtOffset * 60_000).toISOString(),
    metrics: deriveMetrics(returns, equityValues, strategyCount),
    equityCurve,
    disclaimer: DISCLAIMER,
  };
};
