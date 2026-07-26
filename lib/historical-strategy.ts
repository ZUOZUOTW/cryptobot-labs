import type {
  Candle,
  StrategyEvaluator,
  StrategyInput,
  StrategySignal,
} from "../packages/trading-core/src";
import { STRATEGY_BLOCKS } from "../data/strategies";
import type { BotConfig, StrategyBlock } from "./types";
import { validateConfig } from "./strategy-validation";
import { positionSideAllowed, resolvedTradeDirection } from "./trade-direction";

type Direction = -1 | 0 | 1;

const CONFIG_KEYS = ["blocks", "exchange", "id", "leverage", "logicMode", "market", "name", "source", "symbol", "timeframe", "tradeDirection"];
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
    tradeDirection: resolvedTradeDirection(value),
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

const stochasticKAt = (candles: readonly Candle[], period: number, end = candles.length): number | undefined => {
  if (end < period) return undefined;
  const window = candles.slice(end - period, end);
  const high = Math.max(...window.map((candle) => positiveNumber(candle.high)));
  const low = Math.min(...window.map((candle) => positiveNumber(candle.low)));
  if (high === low) return 50;
  return ((positiveNumber(candles[end - 1]!.close) - low) / (high - low)) * 100;
};

const stochasticDAt = (candles: readonly Candle[], kPeriod: number, dPeriod: number, end = candles.length): number | undefined => {
  const values: number[] = [];
  for (let offset = dPeriod - 1; offset >= 0; offset -= 1) {
    const value = stochasticKAt(candles, kPeriod, end - offset);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return average(values);
};

const adxAt = (candles: readonly Candle[], period: number): number | undefined => {
  if (candles.length < period * 2 + 1) return undefined;
  const dxValues: number[] = [];
  for (let end = candles.length - period + 1; end <= candles.length; end += 1) {
    let trueRange = 0;
    let positiveMovement = 0;
    let negativeMovement = 0;
    for (let index = end - period; index < end; index += 1) {
      const current = candles[index]!;
      const previous = candles[index - 1]!;
      const high = positiveNumber(current.high);
      const low = positiveNumber(current.low);
      const previousHigh = positiveNumber(previous.high);
      const previousLow = positiveNumber(previous.low);
      const previousClose = positiveNumber(previous.close);
      trueRange += Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
      const upMove = high - previousHigh;
      const downMove = previousLow - low;
      if (upMove > downMove && upMove > 0) positiveMovement += upMove;
      if (downMove > upMove && downMove > 0) negativeMovement += downMove;
    }
    if (trueRange === 0) {
      dxValues.push(0);
      continue;
    }
    const positiveDi = (positiveMovement / trueRange) * 100;
    const negativeDi = (negativeMovement / trueRange) * 100;
    const total = positiveDi + negativeDi;
    dxValues.push(total === 0 ? 0 : (Math.abs(positiveDi - negativeDi) / total) * 100);
  }
  return average(dxValues);
};

const midpointAt = (candles: readonly Candle[], period: number, end = candles.length): number | undefined => {
  if (end < period) return undefined;
  const window = candles.slice(end - period, end);
  return (Math.max(...window.map((item) => positiveNumber(item.high))) + Math.min(...window.map((item) => positiveNumber(item.low)))) / 2;
};

const cciAt = (candles: readonly Candle[], period: number, end = candles.length): number | undefined => {
  if (end < period) return undefined;
  const typical = candles.slice(end - period, end).map((item) => (positiveNumber(item.high) + positiveNumber(item.low) + positiveNumber(item.close)) / 3);
  const mean = average(typical);
  const deviation = average(typical.map((value) => Math.abs(value - mean)));
  return deviation === 0 ? 0 : (typical.at(-1)! - mean) / (0.015 * deviation);
};

const williamsAt = (candles: readonly Candle[], period: number, end = candles.length): number | undefined => {
  if (end < period) return undefined;
  const window = candles.slice(end - period, end);
  const high = Math.max(...window.map((item) => positiveNumber(item.high)));
  const low = Math.min(...window.map((item) => positiveNumber(item.low)));
  return high === low ? -50 : -100 * (high - positiveNumber(candles[end - 1]!.close)) / (high - low);
};

const vwapAt = (candles: readonly Candle[], period: number, end = candles.length): number | undefined => {
  if (end < period) return undefined;
  const window = candles.slice(end - period, end);
  const volume = window.reduce((sum, item) => sum + positiveNumber(item.volume), 0);
  return volume === 0 ? undefined : window.reduce((sum, item) => sum + ((positiveNumber(item.high) + positiveNumber(item.low) + positiveNumber(item.close)) / 3) * positiveNumber(item.volume), 0) / volume;
};

const mfiAt = (candles: readonly Candle[], period: number, end = candles.length): number | undefined => {
  if (end <= period) return undefined;
  let positiveFlow = 0;
  let negativeFlow = 0;
  for (let index = end - period; index < end; index += 1) {
    const typical = (positiveNumber(candles[index]!.high) + positiveNumber(candles[index]!.low) + positiveNumber(candles[index]!.close)) / 3;
    const priorTypical = (positiveNumber(candles[index - 1]!.high) + positiveNumber(candles[index - 1]!.low) + positiveNumber(candles[index - 1]!.close)) / 3;
    const flow = typical * positiveNumber(candles[index]!.volume);
    if (typical >= priorTypical) positiveFlow += flow; else negativeFlow += flow;
  }
  return negativeFlow === 0 ? 100 : 100 - 100 / (1 + positiveFlow / negativeFlow);
};

const obvSeries = (candles: readonly Candle[]): number[] => {
  const result = [0];
  for (let index = 1; index < candles.length; index += 1) {
    const change = positiveNumber(candles[index]!.close) - positiveNumber(candles[index - 1]!.close);
    result.push(result[index - 1]! + Math.sign(change) * positiveNumber(candles[index]!.volume));
  }
  return result;
};

const parabolicSarSeries = (candles: readonly Candle[], acceleration: number, maximum: number): number[] => {
  if (candles.length === 0) return [];
  let bullish = candles.length < 2 || positiveNumber(candles[1]!.close) >= positiveNumber(candles[0]!.close);
  let sar = bullish ? positiveNumber(candles[0]!.low) : positiveNumber(candles[0]!.high);
  let extreme = bullish ? positiveNumber(candles[0]!.high) : positiveNumber(candles[0]!.low);
  let factor = acceleration;
  const result = [sar];
  for (let index = 1; index < candles.length; index += 1) {
    sar += factor * (extreme - sar);
    const high = positiveNumber(candles[index]!.high);
    const low = positiveNumber(candles[index]!.low);
    if ((bullish && low < sar) || (!bullish && high > sar)) {
      bullish = !bullish; sar = extreme; extreme = bullish ? high : low; factor = acceleration;
    } else if ((bullish && high > extreme) || (!bullish && low < extreme)) {
      extreme = bullish ? high : low; factor = Math.min(maximum, factor + acceleration);
    }
    result.push(sar);
  }
  return result;
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
    case "ema-cross": {
      const fast = emaSeries(values, parameter(block, "shortPeriod"));
      const slow = emaSeries(values, parameter(block, "longPeriod"));
      return crossover(fast.at(-2), slow.at(-2), fast.at(-1), slow.at(-1));
    }
    case "stochastic": {
      const kPeriod = parameter(block, "kPeriod");
      const dPeriod = parameter(block, "dPeriod");
      const oversold = parameter(block, "oversold");
      const priorK = stochasticKAt(candles, kPeriod, candles.length - 1);
      const priorD = stochasticDAt(candles, kPeriod, dPeriod, candles.length - 1);
      const currentK = stochasticKAt(candles, kPeriod);
      const currentD = stochasticDAt(candles, kPeriod, dPeriod);
      if ([priorK, priorD, currentK, currentD].some((value) => value === undefined)) return 0;
      if (priorK! <= priorD! && currentK! > currentD! && Math.min(priorK!, currentK!) <= oversold) return 1;
      const overbought = 100 - oversold;
      return priorK! >= priorD! && currentK! < currentD! && Math.max(priorK!, currentK!) >= overbought ? -1 : 0;
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
    case "donchian-breakout": {
      const period = parameter(block, "period");
      if (candles.length < period + 2) return 0;
      const priorWindow = candles.slice(-period - 1, -1);
      const earlierWindow = candles.slice(-period - 2, -2);
      const priorHigh = Math.max(...priorWindow.map((candle) => positiveNumber(candle.high)));
      const priorLow = Math.min(...priorWindow.map((candle) => positiveNumber(candle.low)));
      const earlierHigh = Math.max(...earlierWindow.map((candle) => positiveNumber(candle.high)));
      const earlierLow = Math.min(...earlierWindow.map((candle) => positiveNumber(candle.low)));
      if (previous <= earlierHigh && current > priorHigh) return 1;
      return previous >= earlierLow && current < priorLow ? -1 : 0;
    }
    case "grid": {
      const step = parameter(block, "range") / 100 / parameter(block, "gridCount");
      const change = current / previous - 1;
      if (change <= -step) return 1;
      return change >= step ? -1 : 0;
    }
    case "dca": {
      const interval = parameter(block, "intervalDays") * 86_400_000;
      return Math.floor(candles.at(-1)!.closeTime / interval) > Math.floor(candles.at(-2)!.closeTime / interval) ? 1 : 0;
    }
    case "cci-rebound": {
      const prior = cciAt(candles, parameter(block, "period"), candles.length - 1);
      const now = cciAt(candles, parameter(block, "period"));
      const threshold = parameter(block, "oversold");
      if (prior === undefined || now === undefined) return 0;
      if (prior <= threshold && now > threshold) return 1;
      return prior >= -threshold && now < -threshold ? -1 : 0;
    }
    case "williams-r-rebound": {
      const prior = williamsAt(candles, parameter(block, "period"), candles.length - 1);
      const now = williamsAt(candles, parameter(block, "period"));
      const threshold = parameter(block, "oversold");
      if (prior === undefined || now === undefined) return 0;
      if (prior <= threshold && now > threshold) return 1;
      return prior >= -100 - threshold && now < -100 - threshold ? -1 : 0;
    }
    case "roc-momentum": {
      const period = parameter(block, "period");
      if (values.length <= period + 1) return 0;
      const roc = (end: number) => (values[end - 1]! / values[end - 1 - period]! - 1) * 100;
      const threshold = Math.abs(parameter(block, "threshold"));
      const previous = roc(values.length - 1);
      const current = roc(values.length);
      if (previous <= threshold && current > threshold) return 1;
      return previous >= -threshold && current < -threshold ? -1 : 0;
    }
    case "ichimoku-breakout": {
      const conversion = midpointAt(candles, parameter(block, "conversionPeriod"));
      const base = midpointAt(candles, parameter(block, "basePeriod"));
      const span = midpointAt(candles, parameter(block, "spanPeriod"));
      if (conversion === undefined || base === undefined || span === undefined) return 0;
      const cloudHigh = Math.max((conversion + base) / 2, span);
      const cloudLow = Math.min((conversion + base) / 2, span);
      return current > cloudHigh && conversion > base ? 1 : current < cloudLow && conversion < base ? -1 : 0;
    }
    case "supertrend-reversal": {
      const period = parameter(block, "atrPeriod");
      const atr = trueRangeAverage(candles, period);
      const priorAtr = trueRangeAverage(candles.slice(0, -1), period);
      if (atr === undefined || priorAtr === undefined) return 0;
      const multiplier = parameter(block, "multiplier");
      const currentMid = (positiveNumber(candles.at(-1)!.high) + positiveNumber(candles.at(-1)!.low)) / 2;
      const priorMid = (positiveNumber(candles.at(-2)!.high) + positiveNumber(candles.at(-2)!.low)) / 2;
      if (previous <= priorMid + multiplier * priorAtr && current > currentMid + multiplier * atr) return 1;
      return previous >= priorMid - multiplier * priorAtr && current < currentMid - multiplier * atr ? -1 : 0;
    }
    case "parabolic-sar": {
      const sar = parabolicSarSeries(candles, parameter(block, "acceleration"), parameter(block, "maximumAcceleration"));
      return crossover(previous, sar.at(-2), current, sar.at(-1));
    }
    case "vwap-reclaim":
      return crossover(previous, vwapAt(candles, parameter(block, "period"), candles.length - 1), current, vwapAt(candles, parameter(block, "period")));
    case "mfi-rebound": {
      const prior = mfiAt(candles, parameter(block, "period"), candles.length - 1);
      const now = mfiAt(candles, parameter(block, "period"));
      const threshold = parameter(block, "oversold");
      if (prior === undefined || now === undefined) return 0;
      if (prior <= threshold && now > threshold) return 1;
      return prior >= 100 - threshold && now < 100 - threshold ? -1 : 0;
    }
    case "obv-breakout": {
      const period = parameter(block, "period");
      const obv = obvSeries(candles);
      if (obv.length < period + 2) return 0;
      const window = obv.slice(-period - 1, -1);
      return obv.at(-1)! > Math.max(...window) ? 1 : obv.at(-1)! < Math.min(...window) ? -1 : 0;
    }
    case "price-action-breakout": {
      const lookback = parameter(block, "lookback");
      if (candles.length < lookback + 1) return 0;
      const window = candles.slice(-lookback - 1, -1);
      const buffer = parameter(block, "buffer") / 100;
      const high = Math.max(...window.map((item) => positiveNumber(item.high)));
      const low = Math.min(...window.map((item) => positiveNumber(item.low)));
      return current > high * (1 + buffer) ? 1 : current < low * (1 - buffer) ? -1 : 0;
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

const confirmationPassed = (block: Readonly<StrategyBlock>, candles: readonly Candle[]): boolean => {
  if (block.id === "direct-confirmation") return true;
  if (block.id === "volume-confirmation") return volumeConfirmed(block, candles);
  if (block.id === "adx-confirmation") {
    const value = adxAt(candles, parameter(block, "period"));
    return value !== undefined && value >= parameter(block, "minimumStrength");
  }
  if (block.id === "atr-volatility-confirmation") {
    const atr = trueRangeAverage(candles, parameter(block, "period"));
    const close = candles.at(-1) ? positiveNumber(candles.at(-1)!.close) : 0;
    return atr !== undefined && close > 0 && atr / close * 100 >= parameter(block, "minimumVolatility");
  }
  if (block.id === "bollinger-bandwidth-confirmation") {
    const period = parameter(block, "period");
    const values = closes(candles);
    if (values.length < period) return false;
    const window = values.slice(-period);
    const mean = average(window);
    const standardDeviation = Math.sqrt(average(window.map((value) => (value - mean) ** 2)));
    const bandwidth = mean === 0 ? 0 : parameter(block, "deviation") * standardDeviation * 2 / mean * 100;
    return bandwidth >= parameter(block, "minimumBandwidth");
  }
  return false;
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
  const lossPause = config.blocks.find((block) => block.id === "consecutive-loss-pause");
  if (!position && lossPause && portfolio.consecutiveLosses !== undefined && portfolio.lastLossAt !== undefined &&
      portfolio.consecutiveLosses >= parameter(lossPause, "lossCount") &&
      input.now < portfolio.lastLossAt + parameter(lossPause, "pauseHours") * 3_600_000) {
    return "consecutive-loss-pause:suppress";
  }
  if (!position) return undefined;

  const close = positiveNumber(input.candles.at(-1)!.close);
  const entry = positiveNumber(position.entryPrice);
  const signedReturn = position.side === "long" ? close / entry - 1 : 1 - close / entry;
  const takeProfit = config.blocks.find((block) => block.id === "take-profit");
  if (takeProfit && signedReturn >= parameter(takeProfit, "takeProfit") / 100) return "take-profit";
  const atrTakeProfit = config.blocks.find((block) => block.id === "atr-take-profit");
  if (atrTakeProfit) {
    const atr = trueRangeAverage(input.candles, parameter(atrTakeProfit, "atrPeriod"));
    if (atr !== undefined && signedReturn >= atr / entry * parameter(atrTakeProfit, "atrMultiple")) return "atr-take-profit";
  }
  const rsiProfitExit = config.blocks.find((block) => block.id === "rsi-profit-exit");
  if (rsiProfitExit && signedReturn >= parameter(rsiProfitExit, "minimumProfit") / 100) {
    const rsi = rsiAt(closes(input.candles), parameter(rsiProfitExit, "period"));
    const threshold = parameter(rsiProfitExit, "overbought");
    if (rsi !== undefined && (position.side === "long" ? rsi >= threshold : rsi <= 100 - threshold)) return "rsi-profit-exit";
  }
  const timedProfitExit = config.blocks.find((block) => block.id === "timed-profit-exit");
  if (timedProfitExit && position.entryTime !== undefined && signedReturn >= parameter(timedProfitExit, "minimumProfit") / 100 &&
      input.now >= position.entryTime + parameter(timedProfitExit, "holdingHours") * 3_600_000) return "timed-profit-exit";
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
    throw new TypeError("Custom JavaScript must use the QuickJS sandbox evaluator");
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
      const position = input.portfolio?.position;
      if (position && !positionSideAllowed(config, position.side)) {
        return {
          id: `visual-${input.now}-close`,
          action: "close",
          reason: `trade-direction:${resolvedTradeDirection(config)}:position-not-allowed`,
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
        .filter((block) => block.group === "confirm")
        .map((block) => confirmationPassed(block, input.candles));
      const confirmed = confirmations.length === 0 || (config.logicMode === "all" ? confirmations.every(Boolean) : confirmations.some(Boolean));
      const signalSide = direction === 1 ? "long" : "short";
      if (direction === 0 || !confirmed || (!position && !positionSideAllowed(config, signalSide))) {
        const reason = direction === 0
          ? `entry:${config.logicMode}:not-triggered`
          : !confirmed
            ? "confirm:not-triggered"
            : `trade-direction:${resolvedTradeDirection(config)}:entry-suppressed`;
        return { id: `visual-${input.now}-hold`, action: "hold", reason, createdAt: input.now };
      }
      const action = direction === 1 ? "buy" : "sell";
      const layered = entryBlocks.some((block) => block.id === "grid" || block.id === "dca");
      const sameDirection = position && ((position.side === "long" && action === "buy") || (position.side === "short" && action === "sell"));
      if (position && !sameDirection && !layered) {
        return {
          id: `visual-${input.now}-close`,
          action: "close",
          reason: "entry:opposite-signal",
          createdAt: input.now,
        };
      }
      if (position && sameDirection && !layered) {
        return { id: `visual-${input.now}-hold`, action: "hold", reason: "position-open:no-add", createdAt: input.now };
      }
      const allocation = allocationRate(config, input.candles);
      if (allocation === undefined) {
        return { id: `visual-${input.now}-hold`, action: "hold", reason: "position-sizing:atr-not-ready", createdAt: input.now };
      }
      const reducing = position && !sameDirection;
      const grid = config.blocks.find((block) => block.id === "grid");
      if (sameDirection && grid && position.layerCount >= parameter(grid, "gridCount")) {
        return { id: `visual-${input.now}-hold`, action: "hold", reason: "grid:maximum-layers-reached", createdAt: input.now };
      }
      return {
        id: `visual-${input.now}-${action}`,
        action,
        reason: `entry:${config.logicMode}:${entryBlocks.map((block) => block.id).join("+")}`,
        createdAt: input.now,
        allocationRate: allocation,
        ...(sameDirection ? { positionEffect: "add" as const } : {}),
        ...(reducing ? {
          positionEffect: "reduce" as const,
          reductionRate: grid ? 1 / position.layerCount : allocation,
        } : {}),
      };
    },
  });
};
