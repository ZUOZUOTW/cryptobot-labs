import type {
  Candle,
  StrategyEvaluator,
  StrategyInput,
  StrategySignal,
} from "../packages/trading-core/src";
import { STRATEGY_BLOCKS } from "../data/strategies";
import type { BotConfig, StrategyBlock } from "./types";
import { validateConfig } from "./strategy-validation";

type Direction = -1 | 0 | 1;

const CONFIG_KEYS = ["blocks", "exchange", "id", "leverage", "logicMode", "market", "name", "source", "symbol", "timeframe"];
const BLOCK_KEYS = ["description", "group", "id", "name", "parameters"];
const PARAMETER_KEYS = ["key", "label", "max", "min", "step", "suffix", "value"];

const exactKeys = (value: object, allowed: readonly string[]): boolean => {
  const expected = new Set(allowed);
  return Object.keys(value).every((key) => expected.has(key));
};

const strictCanonicalShape = (value: BotConfig): boolean => (
  exactKeys(value, CONFIG_KEYS)
  && value.blocks.every((block) => (
    exactKeys(block, BLOCK_KEYS)
    && block.parameters.every((parameter) => exactKeys(parameter, PARAMETER_KEYS))
  ))
);

const cloneAndFreezeConfig = (value: BotConfig): Readonly<BotConfig> => {
  const blocks = value.blocks.map((candidate) => {
    const canonical = STRATEGY_BLOCKS.find((block) => block.id === candidate.id)!;
    const values = new Map(candidate.parameters.map((parameter) => [parameter.key, parameter.value]));
    const parameters = canonical.parameters.map((parameter) => Object.freeze({
      key: parameter.key,
      label: parameter.label,
      value: values.get(parameter.key)!,
      min: parameter.min,
      max: parameter.max,
      step: parameter.step,
      ...(parameter.suffix === undefined ? {} : { suffix: parameter.suffix }),
    }));
    return Object.freeze({
      id: canonical.id,
      name: canonical.name,
      group: canonical.group,
      description: canonical.description,
      parameters: Object.freeze(parameters),
    });
  });
  return Object.freeze({
    id: value.id,
    name: value.name,
    exchange: "WEEX" as const,
    market: value.market,
    symbol: value.symbol,
    timeframe: value.timeframe,
    logicMode: value.logicMode,
    leverage: value.leverage,
    blocks: Object.freeze(blocks) as unknown as StrategyBlock[],
  });
};

const number = (value: string): number => {
  if (value.length > 128 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new TypeError("Historical strategy received an invalid decimal string");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError("Historical strategy received a non-finite candle value");
  return parsed;
};

const positiveNumber = (value: string): number => {
  const parsed = number(value);
  if (parsed <= 0) throw new RangeError("Historical strategy requires positive market values");
  return parsed;
};

const parameter = (block: Readonly<StrategyBlock>, key: string): number => (
  block.parameters.find((item) => item.key === key)!.value
);

const closes = (candles: readonly Candle[]): number[] => candles.map((candle) => positiveNumber(candle.close));

const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const smaAt = (values: readonly number[], period: number, end = values.length): number | undefined => {
  if (end < period) return undefined;
  return average(values.slice(end - period, end));
};

const emaSeries = (values: readonly number[], period: number): number[] => {
  if (values.length === 0) return [];
  const multiplier = 2 / (period + 1);
  const result = [values[0]!];
  for (let index = 1; index < values.length; index += 1) {
    result.push(values[index]! * multiplier + result[index - 1]! * (1 - multiplier));
  }
  return result;
};

const rsiAt = (values: readonly number[], period: number, end = values.length): number | undefined => {
  if (end <= period) return undefined;
  let gains = 0;
  let losses = 0;
  for (let index = end - period; index < end; index += 1) {
    const change = values[index]! - values[index - 1]!;
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - 100 / (1 + gains / losses);
};

const crossover = (previousLeft: number | undefined, previousRight: number | undefined, currentLeft: number | undefined, currentRight: number | undefined): Direction => {
  if ([previousLeft, previousRight, currentLeft, currentRight].some((value) => value === undefined)) return 0;
  if (previousLeft! <= previousRight! && currentLeft! > currentRight!) return 1;
  if (previousLeft! >= previousRight! && currentLeft! < currentRight!) return -1;
  return 0;
};

const entryDirection = (block: Readonly<StrategyBlock>, candles: readonly Candle[]): Direction => {
  const values = closes(candles);
  const current = values.at(-1)!;
  const previous = values.at(-2);
  if (previous === undefined) return 0;

  switch (block.id) {
    case "rsi": {
      const period = parameter(block, "period");
      const oversold = parameter(block, "oversold");
      const priorRsi = rsiAt(values, period, values.length - 1);
      const currentRsi = rsiAt(values, period);
      if (priorRsi === undefined || currentRsi === undefined) return 0;
      if (priorRsi <= oversold && currentRsi > oversold) return 1;
      const overbought = 100 - oversold;
      return priorRsi >= overbought && currentRsi < overbought ? -1 : 0;
    }
    case "sma-cross": {
      const short = parameter(block, "shortPeriod");
      const long = parameter(block, "longPeriod");
      return crossover(
        smaAt(values, short, values.length - 1),
        smaAt(values, long, values.length - 1),
        smaAt(values, short),
        smaAt(values, long),
      );
    }
    case "macd": {
      const fastPeriod = parameter(block, "fastPeriod");
      const slowPeriod = parameter(block, "slowPeriod");
      const signalPeriod = parameter(block, "signalPeriod");
      if (values.length < slowPeriod + signalPeriod) return 0;
      const fast = emaSeries(values, fastPeriod);
      const slow = emaSeries(values, slowPeriod);
      const line = values.map((_, index) => fast[index]! - slow[index]!);
      const signal = emaSeries(line, signalPeriod);
      return crossover(line.at(-2), signal.at(-2), line.at(-1), signal.at(-1));
    }
    case "bollinger-breakout": {
      const period = parameter(block, "period");
      const deviation = parameter(block, "deviation");
      const band = (end: number): [number, number] | undefined => {
        if (end < period) return undefined;
        const window = values.slice(end - period, end);
        const mean = average(window);
        const standardDeviation = Math.sqrt(average(window.map((value) => (value - mean) ** 2)));
        return [mean - deviation * standardDeviation, mean + deviation * standardDeviation];
      };
      const prior = band(values.length - 1);
      const now = band(values.length);
      if (!prior || !now) return 0;
      if (previous <= prior[1] && current > now[1]) return 1;
      return previous >= prior[0] && current < now[0] ? -1 : 0;
    }
    case "grid": {
      const step = parameter(block, "range") / 100 / parameter(block, "gridCount");
      const change = current / previous - 1;
      if (change <= -step) return 1;
      return change >= step ? -1 : 0;
    }
    case "dca": {
      const interval = parameter(block, "intervalDays") * 86_400_000;
      const elapsed = candles.at(-1)!.closeTime - candles[0]!.closeTime;
      const priorElapsed = candles.at(-2)!.closeTime - candles[0]!.closeTime;
      return candles.length === 2 || Math.floor(elapsed / interval) > Math.floor(priorElapsed / interval) ? 1 : 0;
    }
    default:
      return 0;
  }
};

const volumeConfirmed = (block: Readonly<StrategyBlock>, candles: readonly Candle[]): boolean => {
  const period = parameter(block, "period");
  if (candles.length <= period) return false;
  const priorVolumes = candles.slice(-period - 1, -1).map((candle) => positiveNumber(candle.volume));
  return positiveNumber(candles.at(-1)!.volume) >= average(priorVolumes) * parameter(block, "multiplier");
};

const trueRangeAverage = (candles: readonly Candle[], period: number): number | undefined => {
  if (candles.length <= period) return undefined;
  const ranges: number[] = [];
  for (let index = candles.length - period; index < candles.length; index += 1) {
    const candle = candles[index]!;
    const priorClose = positiveNumber(candles[index - 1]!.close);
    const high = positiveNumber(candle.high);
    const low = positiveNumber(candle.low);
    ranges.push(Math.max(high - low, Math.abs(high - priorClose), Math.abs(low - priorClose)));
  }
  return average(ranges);
};

const allocationRate = (config: Readonly<BotConfig>, candles: readonly Candle[]): number | undefined => {
  const allocations: number[] = [];
  const close = positiveNumber(candles.at(-1)!.close);
  for (const block of config.blocks) {
    if (block.id === "fixed-position") allocations.push(parameter(block, "positionSize") / 100);
    if (block.id === "atr-sizing") {
      const atr = trueRangeAverage(candles, parameter(block, "atrPeriod"));
      if (atr === undefined || atr <= 0) return undefined;
      allocations.push(Math.min(1, (parameter(block, "riskPerTrade") / 100) / (atr / close)));
    }
  }
  let allocation = allocations.length === 0 ? 1 : Math.min(...allocations);
  const dca = config.blocks.find((block) => block.id === "dca");
  if (dca) {
    const peak = Math.max(...closes(candles));
    const drawdown = peak === 0 ? 0 : Math.max(0, 1 - close / peak);
    allocation *= 1 + drawdown * (parameter(dca, "drawdownBoost") / 100);
  }
  const grid = config.blocks.find((block) => block.id === "grid");
  if (grid) allocation = Math.min(allocation, 1 / parameter(grid, "gridCount"));
  return Math.max(Number.EPSILON, Math.min(1, allocation));
};

const riskExit = (config: Readonly<BotConfig>, input: Readonly<StrategyInput>): string | undefined => {
  const portfolio = input.portfolio;
  const position = portfolio?.position;
  if (!portfolio) return undefined;
  const equity = number(portfolio.equity);
  const dayStartEquity = number(portfolio.dayStartEquity);
  const dailyLoss = config.blocks.find((block) => block.id === "maximum-daily-loss");
  if (dailyLoss && (portfolio.dailyLossBreached === true || equity <= dayStartEquity * (1 - parameter(dailyLoss, "maximumDailyLoss") / 100))) {
    return position ? "maximum-daily-loss:close" : "maximum-daily-loss:suppress";
  }
  if (!position) return undefined;

  const close = positiveNumber(input.candles.at(-1)!.close);
  const entry = positiveNumber(position.entryPrice);
  const signedReturn = position.side === "long" ? close / entry - 1 : 1 - close / entry;
  const takeProfit = config.blocks.find((block) => block.id === "take-profit");
  if (takeProfit && signedReturn >= parameter(takeProfit, "takeProfit") / 100) return "take-profit";
  const stopLoss = config.blocks.find((block) => block.id === "stop-loss");
  if (stopLoss && signedReturn <= -parameter(stopLoss, "stopLoss") / 100) return "stop-loss";
  const trailing = config.blocks.find((block) => block.id === "trailing-stop");
  if (trailing) {
    const distance = parameter(trailing, "trailingDistance") / 100;
    const stopped = position.side === "long"
      ? close <= positiveNumber(position.peakPrice) * (1 - distance)
      : close >= positiveNumber(position.troughPrice) * (1 + distance);
    if (stopped) return "trailing-stop";
  }
  return undefined;
};

export interface VisualHistoricalEvaluator extends StrategyEvaluator {
  readonly config: Readonly<BotConfig>;
  readonly maximumLookback: 1024;
  readonly riskPolicy: Readonly<{ maximumDailyLossRate?: number }>;
}

export const createVisualHistoricalEvaluator = (candidate: BotConfig): VisualHistoricalEvaluator => {
  if (candidate.source !== undefined) {
    throw new TypeError("Custom JavaScript requires the QuickJS sandbox and is not enabled for historical backtests yet");
  }
  if (!strictCanonicalShape(candidate)) throw new TypeError("BotConfig must use the strict canonical shape");
  const validation = validateConfig(candidate);
  if (!validation.valid) throw new TypeError(`Invalid BotConfig: ${validation.errors.join("; ")}`);
  const config = cloneAndFreezeConfig(candidate);
  const maximumDailyLoss = config.blocks.find((block) => block.id === "maximum-daily-loss");
  const riskPolicy = Object.freeze({
    ...(maximumDailyLoss ? { maximumDailyLossRate: parameter(maximumDailyLoss, "maximumDailyLoss") / 100 } : {}),
  });

  return Object.freeze({
    config,
    maximumLookback: 1024 as const,
    riskPolicy,
    async evaluate(input: Readonly<StrategyInput>): Promise<StrategySignal> {
      if (input.market !== config.market || input.symbol !== config.symbol || input.timeframe !== config.timeframe ||
          input.leverage === undefined || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.leverage) || Number(input.leverage) !== config.leverage) {
        throw new TypeError("Historical dataset does not match BotConfig market, symbol, timeframe, and leverage");
      }
      const exit = riskExit(config, input);
      if (exit) {
        const suppress = exit.endsWith(":suppress");
        return {
          id: `visual-${input.now}-${suppress ? "hold" : "close"}`,
          action: suppress ? "hold" : "close",
          reason: exit,
          createdAt: input.now,
        };
      }
      const entryBlocks = config.blocks.filter((block) => block.group === "entry");
      const directions = entryBlocks.map((block) => entryDirection(block, input.candles));
      let direction: Direction = 0;
      if (config.logicMode === "all") {
        if (directions.every((value) => value === 1)) direction = 1;
        else if (directions.every((value) => value === -1)) direction = -1;
      } else {
        const bullish = directions.filter((value) => value === 1).length;
        const bearish = directions.filter((value) => value === -1).length;
        direction = bullish === bearish ? 0 : bullish > bearish ? 1 : -1;
      }
      const confirmations = config.blocks
        .filter((block) => block.id === "volume-confirmation")
        .map((block) => volumeConfirmed(block, input.candles));
      const confirmed = confirmations.length === 0 || (config.logicMode === "all" ? confirmations.every(Boolean) : confirmations.some(Boolean));
      if (direction === 0 || !confirmed || (direction === -1 && config.market === "spot" && !input.portfolio?.position)) {
        const reason = direction === 0 ? `entry:${config.logicMode}:not-triggered` : !confirmed ? "confirm:volume:not-triggered" : "spot:bearish-signal-suppressed";
        return { id: `visual-${input.now}-hold`, action: "hold", reason, createdAt: input.now };
      }
      const action = direction === 1 ? "buy" : "sell";
      const allocation = allocationRate(config, input.candles);
      if (allocation === undefined) {
        return { id: `visual-${input.now}-hold`, action: "hold", reason: "position-sizing:atr-not-ready", createdAt: input.now };
      }
      const position = input.portfolio?.position;
      const layered = entryBlocks.some((block) => block.id === "grid" || block.id === "dca");
      if (position && !layered) {
        return { id: `visual-${input.now}-hold`, action: "hold", reason: "position-open:no-exit", createdAt: input.now };
      }
      const sameDirection = position && ((position.side === "long" && action === "buy") || (position.side === "short" && action === "sell"));
      const reducing = position && !sameDirection;
      const grid = config.blocks.find((block) => block.id === "grid");
      return {
        id: `visual-${input.now}-${action}`,
        action,
        reason: `entry:${config.logicMode}:${entryBlocks.map((block) => block.id).join("+")}`,
        createdAt: input.now,
        allocationRate: allocation,
        ...(sameDirection ? { positionEffect: "add" as const } : {}),
        ...(reducing ? {
          positionEffect: "reduce" as const,
          reductionRate: grid ? 1 / parameter(grid, "gridCount") : allocation,
        } : {}),
      };
    },
  });
};
