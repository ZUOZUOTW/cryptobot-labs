import type { BacktestReport, BotConfig, BotMetrics, EquityPoint } from "./types";
import { validateConfig } from "./strategy-validation";

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

  const hash = hashString(stableStringify(config));
  const seed = hash.toString(16).padStart(8, "0");
  const random = seededRandom(hash);
  const strategyCount = config.blocks.length;
  const riskCount = config.blocks.filter((strategy) => strategy.group === "risk").length;
  const leverage = config.leverage;
  const monthlyDrift = 0.0035 + strategyCount * 0.0006 + leverage * 0.0012 - riskCount * 0.0003;
  const monthlyVolatility = ((0.028 + strategyCount * 0.0015) * (0.75 + leverage * 0.25)) / (1 + riskCount * 0.18);
  const returns: number[] = [];
  const equityValues: number[] = [];
  let equity = 100;

  for (let month = 0; month < MONTHS; month += 1) {
    const centeredNoise = (random() + random() + random() - 1.5) / 1.5;
    const monthlyReturn = Math.max(-0.45, Math.min(0.45, monthlyDrift + centeredNoise * monthlyVolatility));
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
