import type { Candle, StrategyInput, StrategySignal } from "../contracts";
import { StrategyInputSchema } from "../schemas";
import { VISUAL_STRATEGY_BLOCKS } from "./catalog";
import type {
  VisualBotConfig,
  VisualStrategyBlock,
  VisualStrategyEvaluator,
} from "./types";

type Direction = -1 | 0 | 1;
type UnknownRecord = Record<string, unknown>;

const CONFIG_KEYS = ["blocks", "exchange", "id", "leverage", "logicMode", "market", "name", "source", "symbol", "timeframe"];
const BLOCK_KEYS = ["description", "group", "id", "name", "parameters"];
const PARAMETER_KEYS = ["key", "label", "max", "min", "step", "suffix", "value"];

const isRecord = (value: unknown): value is UnknownRecord => value !== null && typeof value === "object" && !Array.isArray(value);

const exactKeys = (value: UnknownRecord, allowed: readonly string[]): boolean => {
  const expected = new Set(allowed);
  return Object.keys(value).every((key) => expected.has(key));
};

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const parameterValue = (block: Readonly<VisualStrategyBlock>, key: string): number => {
  const value = block.parameters.find((item) => item.key === key)?.value;
  if (value === undefined) throw new TypeError(`Missing visual strategy parameter: ${block.id}.${key}`);
  return value;
};

function validateConfig(candidate: unknown): asserts candidate is VisualBotConfig {
  if (!isRecord(candidate) || !exactKeys(candidate, CONFIG_KEYS)) throw new TypeError("BotConfig must use the strict canonical shape");
  if (!nonEmptyString(candidate.id) || !nonEmptyString(candidate.name) || candidate.exchange !== "WEEX" ||
      (candidate.market !== "spot" && candidate.market !== "futures") || !nonEmptyString(candidate.symbol) ||
      !nonEmptyString(candidate.timeframe) || (candidate.logicMode !== "all" && candidate.logicMode !== "any") ||
      typeof candidate.leverage !== "number" || !Number.isFinite(candidate.leverage) || !Array.isArray(candidate.blocks)) {
    throw new TypeError("Invalid visual BotConfig shape");
  }
  if (candidate.source !== undefined) throw new TypeError("Custom JavaScript requires the QuickJS sandbox");
  if (candidate.market === "spot" ? candidate.leverage !== 1 : candidate.leverage < 1 || candidate.leverage > 500) {
    throw new RangeError("Invalid leverage for visual strategy market");
  }

  const seenBlocks = new Set<string>();
  for (const rawBlock of candidate.blocks) {
    if (!isRecord(rawBlock) || !exactKeys(rawBlock, BLOCK_KEYS) || !nonEmptyString(rawBlock.id) ||
        !Array.isArray(rawBlock.parameters)) throw new TypeError("BotConfig must use the strict canonical shape");
    if (seenBlocks.has(rawBlock.id)) throw new TypeError(`Duplicate visual strategy block: ${rawBlock.id}`);
    seenBlocks.add(rawBlock.id);
    const canonical = VISUAL_STRATEGY_BLOCKS.find((block) => block.id === rawBlock.id);
    if (!canonical || rawBlock.name !== canonical.name || rawBlock.group !== canonical.group || rawBlock.description !== canonical.description ||
        rawBlock.parameters.length !== canonical.parameters.length) {
      throw new TypeError(`Invalid canonical visual strategy block: ${rawBlock.id}`);
    }
    const seenParameters = new Set<string>();
    for (const rawParameter of rawBlock.parameters) {
      if (!isRecord(rawParameter) || !exactKeys(rawParameter, PARAMETER_KEYS) || !nonEmptyString(rawParameter.key)) {
        throw new TypeError("BotConfig must use the strict canonical shape");
      }
      if (seenParameters.has(rawParameter.key)) throw new TypeError(`Duplicate visual strategy parameter: ${rawBlock.id}.${rawParameter.key}`);
      seenParameters.add(rawParameter.key);
      const expected = canonical.parameters.find((item) => item.key === rawParameter.key);
      if (!expected || rawParameter.label !== expected.label || rawParameter.min !== expected.min || rawParameter.max !== expected.max ||
          rawParameter.step !== expected.step || rawParameter.suffix !== expected.suffix || typeof rawParameter.value !== "number" ||
          !Number.isFinite(rawParameter.value) || rawParameter.value < expected.min || rawParameter.value > expected.max) {
        throw new TypeError(`Invalid visual strategy parameter: ${rawBlock.id}.${rawParameter.key}`);
      }
      const steps = (rawParameter.value - expected.min) / expected.step;
      if (!Number.isFinite(steps) || Math.abs(steps - Math.round(steps)) > 1e-8 ||
          ((/period/i.test(rawParameter.key) || /count/i.test(rawParameter.key) || rawParameter.key === "intervalDays") && !Number.isInteger(rawParameter.value))) {
        throw new TypeError(`Invalid parameter step: ${rawBlock.id}.${rawParameter.key}`);
      }
    }
  }
  if (!candidate.blocks.some((block) => isRecord(block) && block.group === "entry")) throw new TypeError("Visual strategy requires an entry block");
  if (!candidate.blocks.some((block) => isRecord(block) && (block.group === "exit" || block.group === "risk"))) {
    throw new TypeError("Visual strategy requires an exit or risk block");
  }
  const sma = candidate.blocks.find((block) => isRecord(block) && block.id === "sma-cross") as unknown as VisualStrategyBlock | undefined;
  if (sma && parameterValue(sma, "shortPeriod") >= parameterValue(sma, "longPeriod")) throw new TypeError("SMA short period must be below long period");
  const ema = candidate.blocks.find((block) => isRecord(block) && block.id === "ema-cross") as unknown as VisualStrategyBlock | undefined;
  if (ema && parameterValue(ema, "shortPeriod") >= parameterValue(ema, "longPeriod")) throw new TypeError("EMA short period must be below long period");
  const macd = candidate.blocks.find((block) => isRecord(block) && block.id === "macd") as unknown as VisualStrategyBlock | undefined;
  if (macd && parameterValue(macd, "fastPeriod") >= parameterValue(macd, "slowPeriod")) throw new TypeError("MACD fast period must be below slow period");
}

const cloneAndFreezeConfig = (value: VisualBotConfig): Readonly<VisualBotConfig> => {
  const blocks = value.blocks.map((candidate) => {
    const canonical = VISUAL_STRATEGY_BLOCKS.find((block) => block.id === candidate.id)!;
    const values = new Map(candidate.parameters.map((item) => [item.key, item.value]));
    const parameters = canonical.parameters.map((item) => Object.freeze({ ...item, value: values.get(item.key)! }));
    return Object.freeze({ ...canonical, parameters: Object.freeze(parameters) });
  });
  return Object.freeze({ ...value, blocks: Object.freeze(blocks) as unknown as VisualStrategyBlock[] });
};

const decimal = (value: string): number => {
  if (value.length > 128 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new TypeError("Invalid decimal string in visual strategy input");
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError("Non-finite decimal in visual strategy input");
  return parsed;
};

const positive = (value: string): number => {
  const parsed = decimal(value);
  if (parsed <= 0) throw new RangeError("Visual strategy requires positive market values");
  return parsed;
};

const closes = (candles: readonly Candle[]): number[] => candles.map((candle) => positive(candle.close));
const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const smaAt = (values: readonly number[], period: number, end = values.length): number | undefined => end < period ? undefined : average(values.slice(end - period, end));

const emaSeries = (values: readonly number[], period: number): number[] => {
  if (values.length === 0) return [];
  const multiplier = 2 / (period + 1);
  const result = [values[0]!];
  for (let index = 1; index < values.length; index += 1) result.push(values[index]! * multiplier + result[index - 1]! * (1 - multiplier));
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

const crossover = (previousLeft?: number, previousRight?: number, currentLeft?: number, currentRight?: number): Direction => {
  if ([previousLeft, previousRight, currentLeft, currentRight].some((value) => value === undefined)) return 0;
  if (previousLeft! <= previousRight! && currentLeft! > currentRight!) return 1;
  return previousLeft! >= previousRight! && currentLeft! < currentRight! ? -1 : 0;
};

const stochasticKAt = (candles: readonly Candle[], period: number, end = candles.length): number | undefined => {
  if (end < period) return undefined;
  const window = candles.slice(end - period, end);
  const high = Math.max(...window.map((candle) => positive(candle.high)));
  const low = Math.min(...window.map((candle) => positive(candle.low)));
  return high === low ? 50 : ((positive(candles[end - 1]!.close) - low) / (high - low)) * 100;
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
      const high = positive(current.high);
      const low = positive(current.low);
      const previousHigh = positive(previous.high);
      const previousLow = positive(previous.low);
      const previousClose = positive(previous.close);
      trueRange += Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
      const upMove = high - previousHigh;
      const downMove = previousLow - low;
      if (upMove > downMove && upMove > 0) positiveMovement += upMove;
      if (downMove > upMove && downMove > 0) negativeMovement += downMove;
    }
    if (trueRange === 0) { dxValues.push(0); continue; }
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
  return (Math.max(...window.map((item) => positive(item.high))) + Math.min(...window.map((item) => positive(item.low)))) / 2;
};
const cciAt = (candles: readonly Candle[], period: number, end = candles.length): number | undefined => {
  if (end < period) return undefined;
  const typical = candles.slice(end - period, end).map((item) => (positive(item.high) + positive(item.low) + positive(item.close)) / 3);
  const mean = average(typical); const deviation = average(typical.map((value) => Math.abs(value - mean)));
  return deviation === 0 ? 0 : (typical.at(-1)! - mean) / (0.015 * deviation);
};
const williamsAt = (candles: readonly Candle[], period: number, end = candles.length): number | undefined => {
  if (end < period) return undefined;
  const window = candles.slice(end - period, end); const high = Math.max(...window.map((item) => positive(item.high))); const low = Math.min(...window.map((item) => positive(item.low)));
  return high === low ? -50 : -100 * (high - positive(candles[end - 1]!.close)) / (high - low);
};
const vwapAt = (candles: readonly Candle[], period: number, end = candles.length): number | undefined => {
  if (end < period) return undefined;
  const window = candles.slice(end - period, end); const volume = window.reduce((sum, item) => sum + positive(item.volume), 0);
  return volume === 0 ? undefined : window.reduce((sum, item) => sum + ((positive(item.high) + positive(item.low) + positive(item.close)) / 3) * positive(item.volume), 0) / volume;
};
const mfiAt = (candles: readonly Candle[], period: number, end = candles.length): number | undefined => {
  if (end <= period) return undefined;
  let positiveFlow = 0; let negativeFlow = 0;
  for (let index = end - period; index < end; index += 1) {
    const typical = (positive(candles[index]!.high) + positive(candles[index]!.low) + positive(candles[index]!.close)) / 3;
    const prior = (positive(candles[index - 1]!.high) + positive(candles[index - 1]!.low) + positive(candles[index - 1]!.close)) / 3;
    const flow = typical * positive(candles[index]!.volume); if (typical >= prior) positiveFlow += flow; else negativeFlow += flow;
  }
  return negativeFlow === 0 ? 100 : 100 - 100 / (1 + positiveFlow / negativeFlow);
};
const obvSeries = (candles: readonly Candle[]): number[] => {
  const result = [0];
  for (let index = 1; index < candles.length; index += 1) result.push(result[index - 1]! + Math.sign(positive(candles[index]!.close) - positive(candles[index - 1]!.close)) * positive(candles[index]!.volume));
  return result;
};
const parabolicSarSeries = (candles: readonly Candle[], acceleration: number, maximum: number): number[] => {
  if (candles.length === 0) return [];
  let bullish = candles.length < 2 || positive(candles[1]!.close) >= positive(candles[0]!.close);
  let sar = bullish ? positive(candles[0]!.low) : positive(candles[0]!.high); let extreme = bullish ? positive(candles[0]!.high) : positive(candles[0]!.low); let factor = acceleration;
  const result = [sar];
  for (let index = 1; index < candles.length; index += 1) {
    sar += factor * (extreme - sar); const high = positive(candles[index]!.high); const low = positive(candles[index]!.low);
    if ((bullish && low < sar) || (!bullish && high > sar)) { bullish = !bullish; sar = extreme; extreme = bullish ? high : low; factor = acceleration; }
    else if ((bullish && high > extreme) || (!bullish && low < extreme)) { extreme = bullish ? high : low; factor = Math.min(maximum, factor + acceleration); }
    result.push(sar);
  }
  return result;
};

const entryDirection = (block: Readonly<VisualStrategyBlock>, candles: readonly Candle[]): Direction => {
  const values = closes(candles);
  const current = values.at(-1)!;
  const previous = values.at(-2);
  if (previous === undefined) return 0;
  switch (block.id) {
    case "rsi": {
      const period = parameterValue(block, "period");
      const threshold = parameterValue(block, "oversold");
      const prior = rsiAt(values, period, values.length - 1);
      const now = rsiAt(values, period);
      if (prior === undefined || now === undefined) return 0;
      if (prior <= threshold && now > threshold) return 1;
      return prior >= 100 - threshold && now < 100 - threshold ? -1 : 0;
    }
    case "sma-cross":
      return crossover(smaAt(values, parameterValue(block, "shortPeriod"), values.length - 1), smaAt(values, parameterValue(block, "longPeriod"), values.length - 1), smaAt(values, parameterValue(block, "shortPeriod")), smaAt(values, parameterValue(block, "longPeriod")));
    case "ema-cross": {
      const fast = emaSeries(values, parameterValue(block, "shortPeriod"));
      const slow = emaSeries(values, parameterValue(block, "longPeriod"));
      return crossover(fast.at(-2), slow.at(-2), fast.at(-1), slow.at(-1));
    }
    case "stochastic": {
      const kPeriod = parameterValue(block, "kPeriod");
      const dPeriod = parameterValue(block, "dPeriod");
      const oversold = parameterValue(block, "oversold");
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
      const fastPeriod = parameterValue(block, "fastPeriod");
      const slowPeriod = parameterValue(block, "slowPeriod");
      const signalPeriod = parameterValue(block, "signalPeriod");
      if (values.length < slowPeriod + signalPeriod) return 0;
      const fast = emaSeries(values, fastPeriod);
      const slow = emaSeries(values, slowPeriod);
      const line = values.map((_, index) => fast[index]! - slow[index]!);
      const signal = emaSeries(line, signalPeriod);
      return crossover(line.at(-2), signal.at(-2), line.at(-1), signal.at(-1));
    }
    case "bollinger-breakout": {
      const period = parameterValue(block, "period");
      const deviation = parameterValue(block, "deviation");
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
      const period = parameterValue(block, "period");
      if (candles.length < period + 2) return 0;
      const priorWindow = candles.slice(-period - 1, -1);
      const earlierWindow = candles.slice(-period - 2, -2);
      const priorHigh = Math.max(...priorWindow.map((candle) => positive(candle.high)));
      const priorLow = Math.min(...priorWindow.map((candle) => positive(candle.low)));
      const earlierHigh = Math.max(...earlierWindow.map((candle) => positive(candle.high)));
      const earlierLow = Math.min(...earlierWindow.map((candle) => positive(candle.low)));
      if (previous <= earlierHigh && current > priorHigh) return 1;
      return previous >= earlierLow && current < priorLow ? -1 : 0;
    }
    case "grid": {
      const change = current / previous - 1;
      const step = parameterValue(block, "range") / 100 / parameterValue(block, "gridCount");
      return change <= -step ? 1 : change >= step ? -1 : 0;
    }
    case "dca": {
      const interval = parameterValue(block, "intervalDays") * 86_400_000;
      return Math.floor(candles.at(-1)!.closeTime / interval) > Math.floor(candles.at(-2)!.closeTime / interval) ? 1 : 0;
    }
    case "cci-rebound": {
      const prior = cciAt(candles, parameterValue(block, "period"), candles.length - 1); const now = cciAt(candles, parameterValue(block, "period")); const threshold = parameterValue(block, "oversold");
      if (prior === undefined || now === undefined) return 0; return prior <= threshold && now > threshold ? 1 : prior >= -threshold && now < -threshold ? -1 : 0;
    }
    case "williams-r-rebound": {
      const prior = williamsAt(candles, parameterValue(block, "period"), candles.length - 1); const now = williamsAt(candles, parameterValue(block, "period")); const threshold = parameterValue(block, "oversold");
      if (prior === undefined || now === undefined) return 0; return prior <= threshold && now > threshold ? 1 : prior >= -100 - threshold && now < -100 - threshold ? -1 : 0;
    }
    case "roc-momentum": {
      const period = parameterValue(block, "period"); if (values.length <= period + 1) return 0; const roc = (end: number) => (values[end - 1]! / values[end - 1 - period]! - 1) * 100;
      return crossover(roc(values.length - 1), parameterValue(block, "threshold"), roc(values.length), parameterValue(block, "threshold"));
    }
    case "ichimoku-breakout": {
      const conversion = midpointAt(candles, parameterValue(block, "conversionPeriod")); const base = midpointAt(candles, parameterValue(block, "basePeriod")); const span = midpointAt(candles, parameterValue(block, "spanPeriod"));
      if (conversion === undefined || base === undefined || span === undefined) return 0; const high = Math.max((conversion + base) / 2, span); const low = Math.min((conversion + base) / 2, span);
      return current > high && conversion > base ? 1 : current < low && conversion < base ? -1 : 0;
    }
    case "supertrend-reversal": {
      const period = parameterValue(block, "atrPeriod"); const atr = trueRangeAverage(candles, period); const priorAtr = trueRangeAverage(candles.slice(0, -1), period); if (atr === undefined || priorAtr === undefined) return 0;
      const multiplier = parameterValue(block, "multiplier"); const currentMid = (positive(candles.at(-1)!.high) + positive(candles.at(-1)!.low)) / 2; const priorMid = (positive(candles.at(-2)!.high) + positive(candles.at(-2)!.low)) / 2;
      return previous <= priorMid + multiplier * priorAtr && current > currentMid + multiplier * atr ? 1 : previous >= priorMid - multiplier * priorAtr && current < currentMid - multiplier * atr ? -1 : 0;
    }
    case "parabolic-sar": { const sar = parabolicSarSeries(candles, parameterValue(block, "acceleration"), parameterValue(block, "maximumAcceleration")); return crossover(previous, sar.at(-2), current, sar.at(-1)); }
    case "vwap-reclaim": return crossover(previous, vwapAt(candles, parameterValue(block, "period"), candles.length - 1), current, vwapAt(candles, parameterValue(block, "period")));
    case "mfi-rebound": {
      const prior = mfiAt(candles, parameterValue(block, "period"), candles.length - 1); const now = mfiAt(candles, parameterValue(block, "period")); const threshold = parameterValue(block, "oversold");
      if (prior === undefined || now === undefined) return 0; return prior <= threshold && now > threshold ? 1 : prior >= 100 - threshold && now < 100 - threshold ? -1 : 0;
    }
    case "obv-breakout": { const period = parameterValue(block, "period"); const obv = obvSeries(candles); if (obv.length < period + 2) return 0; const window = obv.slice(-period - 1, -1); return obv.at(-1)! > Math.max(...window) ? 1 : obv.at(-1)! < Math.min(...window) ? -1 : 0; }
    case "price-action-breakout": {
      const lookback = parameterValue(block, "lookback"); if (candles.length < lookback + 1) return 0; const window = candles.slice(-lookback - 1, -1); const buffer = parameterValue(block, "buffer") / 100;
      const high = Math.max(...window.map((item) => positive(item.high))); const low = Math.min(...window.map((item) => positive(item.low))); return current > high * (1 + buffer) ? 1 : current < low * (1 - buffer) ? -1 : 0;
    }
    default: return 0;
  }
};

const volumeConfirmed = (block: Readonly<VisualStrategyBlock>, candles: readonly Candle[]): boolean => {
  const period = parameterValue(block, "period");
  if (candles.length <= period) return false;
  const prior = candles.slice(-period - 1, -1).map((candle) => positive(candle.volume));
  return positive(candles.at(-1)!.volume) >= average(prior) * parameterValue(block, "multiplier");
};

const confirmationPassed = (block: Readonly<VisualStrategyBlock>, candles: readonly Candle[]): boolean => {
  if (block.id === "direct-confirmation") return true;
  if (block.id === "volume-confirmation") return volumeConfirmed(block, candles);
  if (block.id === "adx-confirmation") {
    const value = adxAt(candles, parameterValue(block, "period"));
    return value !== undefined && value >= parameterValue(block, "minimumStrength");
  }
  if (block.id === "atr-volatility-confirmation") {
    const atr = trueRangeAverage(candles, parameterValue(block, "period"));
    const close = candles.at(-1) ? positive(candles.at(-1)!.close) : 0;
    return atr !== undefined && close > 0 && atr / close * 100 >= parameterValue(block, "minimumVolatility");
  }
  if (block.id === "bollinger-bandwidth-confirmation") {
    const period = parameterValue(block, "period");
    const values = closes(candles);
    if (values.length < period) return false;
    const window = values.slice(-period);
    const mean = average(window);
    const standardDeviation = Math.sqrt(average(window.map((value) => (value - mean) ** 2)));
    const bandwidth = mean === 0 ? 0 : parameterValue(block, "deviation") * standardDeviation * 2 / mean * 100;
    return bandwidth >= parameterValue(block, "minimumBandwidth");
  }
  return false;
};

const trueRangeAverage = (candles: readonly Candle[], period: number): number | undefined => {
  if (candles.length <= period) return undefined;
  const ranges: number[] = [];
  for (let index = candles.length - period; index < candles.length; index += 1) {
    const candle = candles[index]!;
    const priorClose = positive(candles[index - 1]!.close);
    const high = positive(candle.high);
    const low = positive(candle.low);
    ranges.push(Math.max(high - low, Math.abs(high - priorClose), Math.abs(low - priorClose)));
  }
  return average(ranges);
};

const allocationRate = (config: Readonly<VisualBotConfig>, candles: readonly Candle[]): number | undefined => {
  const allocations: number[] = [];
  const close = positive(candles.at(-1)!.close);
  for (const block of config.blocks) {
    if (block.id === "fixed-position") allocations.push(parameterValue(block, "positionSize") / 100);
    if (block.id === "atr-sizing") {
      const atr = trueRangeAverage(candles, parameterValue(block, "atrPeriod"));
      if (atr === undefined || atr <= 0) return undefined;
      allocations.push(Math.min(1, (parameterValue(block, "riskPerTrade") / 100) / (atr / close)));
    }
  }
  let allocation = allocations.length === 0 ? 1 : Math.min(...allocations);
  const dca = config.blocks.find((block) => block.id === "dca");
  if (dca) allocation *= 1 + Math.max(0, 1 - close / Math.max(...closes(candles))) * parameterValue(dca, "drawdownBoost") / 100;
  const grid = config.blocks.find((block) => block.id === "grid");
  if (grid) allocation = Math.min(allocation, 1 / parameterValue(grid, "gridCount"));
  return Math.max(Number.EPSILON, Math.min(1, allocation));
};

const riskExit = (config: Readonly<VisualBotConfig>, input: Readonly<StrategyInput>): string | undefined => {
  const portfolio = input.portfolio;
  const position = portfolio?.position;
  if (!portfolio) return undefined;
  const dailyLoss = config.blocks.find((block) => block.id === "maximum-daily-loss");
  if (dailyLoss && (portfolio.dailyLossBreached === true || decimal(portfolio.equity) <= decimal(portfolio.dayStartEquity) * (1 - parameterValue(dailyLoss, "maximumDailyLoss") / 100))) {
    return position ? "maximum-daily-loss:close" : "maximum-daily-loss:suppress";
  }
  const lossPause = config.blocks.find((block) => block.id === "consecutive-loss-pause");
  if (!position && lossPause && portfolio.consecutiveLosses !== undefined && portfolio.lastLossAt !== undefined &&
      portfolio.consecutiveLosses >= parameterValue(lossPause, "lossCount") &&
      input.now < portfolio.lastLossAt + parameterValue(lossPause, "pauseHours") * 3_600_000) {
    return "consecutive-loss-pause:suppress";
  }
  if (!position) return undefined;
  const close = positive(input.candles.at(-1)!.close);
  const entry = positive(position.entryPrice);
  const signedReturn = position.side === "long" ? close / entry - 1 : 1 - close / entry;
  const takeProfit = config.blocks.find((block) => block.id === "take-profit");
  if (takeProfit && signedReturn >= parameterValue(takeProfit, "takeProfit") / 100) return "take-profit";
  const atrTakeProfit = config.blocks.find((block) => block.id === "atr-take-profit");
  if (atrTakeProfit) {
    const atr = trueRangeAverage(input.candles, parameterValue(atrTakeProfit, "atrPeriod"));
    if (atr !== undefined && signedReturn >= atr / entry * parameterValue(atrTakeProfit, "atrMultiple")) return "atr-take-profit";
  }
  const rsiProfitExit = config.blocks.find((block) => block.id === "rsi-profit-exit");
  if (rsiProfitExit && signedReturn >= parameterValue(rsiProfitExit, "minimumProfit") / 100) {
    const rsi = rsiAt(closes(input.candles), parameterValue(rsiProfitExit, "period"));
    const threshold = parameterValue(rsiProfitExit, "overbought");
    if (rsi !== undefined && (position.side === "long" ? rsi >= threshold : rsi <= 100 - threshold)) return "rsi-profit-exit";
  }
  const timedProfitExit = config.blocks.find((block) => block.id === "timed-profit-exit");
  if (timedProfitExit && position.entryTime !== undefined && signedReturn >= parameterValue(timedProfitExit, "minimumProfit") / 100 &&
      input.now >= position.entryTime + parameterValue(timedProfitExit, "holdingHours") * 3_600_000) return "timed-profit-exit";
  const stopLoss = config.blocks.find((block) => block.id === "stop-loss");
  if (stopLoss && signedReturn <= -parameterValue(stopLoss, "stopLoss") / 100) return "stop-loss";
  const trailing = config.blocks.find((block) => block.id === "trailing-stop");
  if (trailing) {
    const distance = parameterValue(trailing, "trailingDistance") / 100;
    if (position.side === "long" ? close <= positive(position.peakPrice) * (1 - distance) : close >= positive(position.troughPrice) * (1 + distance)) return "trailing-stop";
  }
  return undefined;
};

export const createVisualStrategyEvaluator = (candidate: VisualBotConfig): VisualStrategyEvaluator => {
  validateConfig(candidate);
  const config = cloneAndFreezeConfig(candidate);
  const maximumDailyLoss = config.blocks.find((block) => block.id === "maximum-daily-loss");
  const riskPolicy = Object.freeze(maximumDailyLoss ? { maximumDailyLossRate: parameterValue(maximumDailyLoss, "maximumDailyLoss") / 100 } : {});
  return Object.freeze({
    config,
    maximumLookback: 1024 as const,
    riskPolicy,
    async evaluate(candidateInput: Readonly<StrategyInput>): Promise<StrategySignal> {
      const parsed = StrategyInputSchema.safeParse(candidateInput);
      if (!parsed.success) throw new TypeError("Visual strategy input is invalid");
      const input = parsed.data;
      if (input.candles.length === 0) throw new TypeError("Visual strategy requires at least one candle");
      if (input.candles.length > 1024) throw new RangeError("Visual strategy lookback exceeds 1024 candles");
      if (!Number.isSafeInteger(input.now) || input.now < 0 || input.candles.some((candle, index) =>
        candle.complete !== true || !Number.isSafeInteger(candle.openTime) || candle.openTime < 0 ||
        !Number.isSafeInteger(candle.closeTime) || candle.closeTime > input.now ||
        (index > 0 && candle.openTime <= input.candles[index - 1]!.openTime))) {
        throw new TypeError("Visual strategy candles are invalid");
      }
      if (input.market !== config.market || input.symbol !== config.symbol || input.timeframe !== config.timeframe ||
          input.leverage === undefined || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.leverage) || Number(input.leverage) !== config.leverage) {
        throw new TypeError("Strategy input does not match visual BotConfig");
      }
      if (input.portfolio) {
        const portfolio = input.portfolio;
        if (decimal(portfolio.equity) <= 0 || decimal(portfolio.dayStartEquity) <= 0 ||
            (portfolio.availableEquity !== undefined && decimal(portfolio.availableEquity) < 0)) {
          throw new TypeError("Visual strategy portfolio is invalid");
        }
        if (portfolio.position) {
          const position = portfolio.position;
          if (position.layerCount > 1_000 || positive(position.peakPrice) < positive(position.entryPrice) ||
              positive(position.troughPrice) > positive(position.entryPrice)) {
            throw new TypeError("Visual strategy position is invalid");
          }
        }
      }
      const exit = riskExit(config, input);
      if (exit) {
        const suppress = exit.endsWith(":suppress");
        return { id: `visual-${input.now}-${suppress ? "hold" : "close"}`, action: suppress ? "hold" : "close", reason: exit, createdAt: input.now };
      }
      const entries = config.blocks.filter((block) => block.group === "entry");
      const directions = entries.map((block) => entryDirection(block, input.candles));
      let direction: Direction = 0;
      if (config.logicMode === "all") {
        if (directions.every((value) => value === 1)) direction = 1;
        else if (directions.every((value) => value === -1)) direction = -1;
      } else {
        const bullish = directions.filter((value) => value === 1).length;
        const bearish = directions.filter((value) => value === -1).length;
        direction = bullish === bearish ? 0 : bullish > bearish ? 1 : -1;
      }
      const confirmations = config.blocks.filter((block) => block.group === "confirm").map((block) => confirmationPassed(block, input.candles));
      const confirmed = confirmations.length === 0 || (config.logicMode === "all" ? confirmations.every(Boolean) : confirmations.some(Boolean));
      if (direction === 0 || !confirmed || (direction === -1 && config.market === "spot" && !input.portfolio?.position)) {
        const reason = direction === 0 ? `entry:${config.logicMode}:not-triggered` : !confirmed ? "confirm:not-triggered" : "spot:bearish-signal-suppressed";
        return { id: `visual-${input.now}-hold`, action: "hold", reason, createdAt: input.now };
      }
      const action = direction === 1 ? "buy" : "sell";
      const allocation = allocationRate(config, input.candles);
      if (allocation === undefined) return { id: `visual-${input.now}-hold`, action: "hold", reason: "position-sizing:atr-not-ready", createdAt: input.now };
      const position = input.portfolio?.position;
      if (position && !entries.some((block) => block.id === "grid" || block.id === "dca")) {
        return { id: `visual-${input.now}-hold`, action: "hold", reason: "position-open:no-exit", createdAt: input.now };
      }
      const sameDirection = position && ((position.side === "long" && action === "buy") || (position.side === "short" && action === "sell"));
      const reducing = position && !sameDirection;
      const grid = config.blocks.find((block) => block.id === "grid");
      if (sameDirection && grid && position.layerCount >= parameterValue(grid, "gridCount")) {
        return { id: `visual-${input.now}-hold`, action: "hold", reason: "grid:maximum-layers-reached", createdAt: input.now };
      }
      return {
        id: `visual-${input.now}-${action}`,
        action,
        reason: `entry:${config.logicMode}:${entries.map((block) => block.id).join("+")}`,
        createdAt: input.now,
        allocationRate: allocation,
        ...(sameDirection ? { positionEffect: "add" as const } : {}),
        ...(reducing ? { positionEffect: "reduce" as const, reductionRate: grid ? 1 / position.layerCount : allocation } : {}),
      };
    },
  });
};
