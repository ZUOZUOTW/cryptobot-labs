import type { BotConfig } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export type SourceValidationResult = ValidationResult;
export type BotConfigCandidate = Omit<BotConfig, "exchange"> & { exchange: string };

const FORBIDDEN = ["binance", "okx", "bybit", "coinbase", "kraken", "api.binance.com", "api.bybit.com"];
const STRATEGY_GROUPS = ["entry", "confirm", "exit", "position", "risk"] as const;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => (
  value !== null && typeof value === "object" && !Array.isArray(value)
);

const isString = (value: unknown): value is string => typeof value === "string";
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const parameterValue = (block: BotConfig["blocks"][number], key: string): number | undefined => (
  block.parameters.find((parameter) => parameter.key === key)?.value
);

const isStrategyParameter = (value: unknown): boolean => (
  isRecord(value)
  && isNonEmptyString(value.key)
  && isString(value.label)
  && isFiniteNumber(value.value)
  && isFiniteNumber(value.min)
  && isFiniteNumber(value.max)
  && isFiniteNumber(value.step)
  && (value.suffix === undefined || isString(value.suffix))
);

const isStrategyBlock = (value: unknown): boolean => (
  isRecord(value)
  && isNonEmptyString(value.id)
  && isNonEmptyString(value.name)
  && isString(value.description)
  && isString(value.group)
  && STRATEGY_GROUPS.some((group) => group === value.group)
  && Array.isArray(value.parameters)
  && value.parameters.every(isStrategyParameter)
);

export const hasBotConfigShape = (value: unknown): value is BotConfigCandidate => (
  isRecord(value)
  && isNonEmptyString(value.id)
  && isNonEmptyString(value.name)
  && isNonEmptyString(value.exchange)
  && (value.market === "spot" || value.market === "futures")
  && isNonEmptyString(value.symbol)
  && isNonEmptyString(value.timeframe)
  && (value.logicMode === "all" || value.logicMode === "any")
  && isFiniteNumber(value.leverage)
  && Array.isArray(value.blocks)
  && value.blocks.every(isStrategyBlock)
  && (value.source === undefined || isString(value.source))
);

export const validateJavaScript = (source: string): SourceValidationResult => {
  const lowered = source.toLowerCase();
  const forbidden = FORBIDDEN.find((token) => lowered.includes(token));
  const errors: string[] = [];
  if (forbidden) errors.push(`偵測到非 WEEX 交易所識別字：${forbidden}`);
  const pairs = [["(", ")"], ["{", "}"], ["[", "]"]] as const;
  for (const [open, close] of pairs) {
    if ((source.split(open).length - 1) !== (source.split(close).length - 1)) errors.push(`括號不完整：${open}${close}`);
  }
  return { valid: errors.length === 0, errors };
};

export const validateConfig = (value: unknown): ValidationResult => {
  if (!hasBotConfigShape(value)) return { valid: false, errors: ["策略設定格式不正確"] };
  const config = value;
  const errors: string[] = [];

  if (config.exchange !== "WEEX") errors.push("只支援 WEEX 交易所");
  if (!config.blocks.some((block) => block.group === "entry")) errors.push("至少需要一個進場訊號");
  if (!config.blocks.some((block) => block.group === "exit" || block.group === "risk")) {
    errors.push("至少需要一個出場或風控規則");
  }

  if (config.market === "spot" && config.leverage !== 1) errors.push("現貨交易槓桿必須為 1");
  if (config.market === "futures" && (!Number.isFinite(config.leverage) || config.leverage < 1 || config.leverage > 20)) {
    errors.push("合約交易槓桿必須介於 1 到 20");
  }

  for (const strategy of config.blocks) {
    for (const item of strategy.parameters) {
      if (!Number.isFinite(item.value) || item.value < item.min || item.value > item.max) {
        errors.push(`${strategy.name}的${item.label}必須介於 ${item.min} 到 ${item.max}`);
      }
    }

    if (strategy.id === "sma-cross") {
      const shortPeriod = parameterValue(strategy, "shortPeriod");
      const longPeriod = parameterValue(strategy, "longPeriod");
      if (shortPeriod !== undefined && longPeriod !== undefined && shortPeriod >= longPeriod) {
        errors.push("SMA 均線交叉（sma-cross）的短期均線（shortPeriod）必須小於長期均線（longPeriod）");
      }
    }

    if (strategy.id === "macd") {
      const fastPeriod = parameterValue(strategy, "fastPeriod");
      const slowPeriod = parameterValue(strategy, "slowPeriod");
      if (fastPeriod !== undefined && slowPeriod !== undefined && fastPeriod >= slowPeriod) {
        errors.push("MACD 動能（macd）的快線週期（fastPeriod）必須小於慢線週期（slowPeriod）");
      }
    }
  }

  if (config.source !== undefined) errors.push(...validateJavaScript(config.source).errors);

  return { valid: errors.length === 0, errors };
};
