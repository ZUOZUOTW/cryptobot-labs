import { parse } from "acorn";
import type { BotConfig } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export type SourceValidationResult = ValidationResult;
export type BotConfigCandidate = Omit<BotConfig, "exchange"> & { exchange: string };

const STRATEGY_GROUPS = ["entry", "confirm", "exit", "position", "risk"] as const;
const HTTP_URL_PATTERN = /https?:\/\/[^\s"'`<>()\[\]{}]+/gi;

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

type AstRecord = Record<string, unknown> & { type?: string };

const astRecord = (value: unknown): AstRecord | null => isRecord(value) ? value : null;

const astName = (value: unknown): string | undefined => {
  const node = astRecord(value);
  if (!node) return undefined;
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node.type === "TemplateLiteral"
    && Array.isArray(node.expressions)
    && node.expressions.length === 0
    && Array.isArray(node.quasis)
  ) {
    const first = astRecord(node.quasis[0]);
    const cooked = astRecord(first?.value)?.cooked;
    return typeof cooked === "string" ? cooked : undefined;
  }
  return undefined;
};

const assignmentTargetName = (value: unknown): string | undefined => {
  const node = astRecord(value);
  if (!node) return undefined;
  if (node.type === "Identifier") return astName(node);
  if (node.type === "MemberExpression") return astName(node.property);
  return undefined;
};

const exchangeValue = (node: AstRecord): string | undefined | null => {
  if (node.type === "VariableDeclarator" && astName(node.id)?.toLowerCase() === "exchange") {
    return astName(node.init) ?? null;
  }
  if (node.type === "Property" && astName(node.key)?.toLowerCase() === "exchange") {
    return astName(node.value) ?? null;
  }
  if (node.type === "AssignmentExpression" && assignmentTargetName(node.left)?.toLowerCase() === "exchange") {
    return astName(node.right) ?? null;
  }
  return undefined;
};

const walkAst = (value: unknown, visit: (node: AstRecord) => void): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => walkAst(item, visit));
    return;
  }
  const node = astRecord(value);
  if (!node) return;
  if (typeof node.type === "string") visit(node);
  for (const [key, child] of Object.entries(node)) {
    if (key !== "loc" && key !== "start" && key !== "end") walkAst(child, visit);
  }
};

export const validateJavaScript = (source: string): SourceValidationResult => {
  let syntaxTree: unknown;
  try {
    syntaxTree = parse(source, {
      allowHashBang: true,
      ecmaVersion: "latest",
      locations: true,
      sourceType: "module",
    });
  } catch (error) {
    const syntaxError = error as SyntaxError & { loc?: { line?: number } };
    const line = syntaxError.loc?.line ?? 1;
    return { valid: false, errors: [`JavaScript 語法錯誤（第 ${line} 行）：${syntaxError.message}`] };
  }

  const errors: string[] = [];
  const exchangeErrors = new Set<string>();
  let explicitlyWeex = false;

  walkAst(syntaxTree, (node) => {
    const assignedExchange = exchangeValue(node);
    if (assignedExchange === undefined) return;
    if (assignedExchange?.toUpperCase() === "WEEX") {
      explicitlyWeex = true;
      return;
    }
    exchangeErrors.add(assignedExchange === null ? "無法確認" : assignedExchange.toLowerCase());
  });

  for (const match of source.matchAll(HTTP_URL_PATTERN)) {
    let hostname: string;
    try {
      hostname = new URL(match[0]).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (hostname === "weex.com" || hostname.endsWith(".weex.com")) {
      explicitlyWeex = true;
    } else {
      errors.push(`偵測到非 WEEX 網域：${hostname}`);
    }
  }

  exchangeErrors.forEach((exchange) => errors.push(`偵測到非 WEEX 交易所識別字：${exchange}`));
  if (!explicitlyWeex) errors.push("策略程式碼必須明確指定 WEEX 交易所");
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
