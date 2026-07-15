import { parse } from "acorn";
import { STRATEGY_BLOCKS } from "../data/strategies";
import type { BotConfig } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export type SourceValidationResult = ValidationResult;
export type BotConfigCandidate = Omit<BotConfig, "exchange"> & { exchange: string };

const STRATEGY_GROUPS = ["entry", "confirm", "exit", "position", "risk"] as const;
const NETWORK_URL_CANDIDATE_PATTERN = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/.*?(?=\b[A-Za-z][A-Za-z0-9+.-]*:\/\/|[\s"'`<>]|$)/g;
const SUPPORTED_NETWORK_SCHEMES = new Set(["http", "https", "ws", "wss"]);
const FORBIDDEN_EXCHANGES = [
  "binance", "okx", "bybit", "coinbase", "kraken", "kucoin", "bitget",
  "gate.io", "gateio", "huobi", "htx", "mexc",
] as const;
const HTTP_SCHEMES = new Set(["http", "https"]);
const WEBSOCKET_SCHEMES = new Set(["ws", "wss"]);

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

type StaticBindings = Map<string, string>;

interface StaticBindingDefinition {
  init: unknown;
  immutable: boolean;
}

const staticStringValue = (value: unknown, bindings: StaticBindings = new Map(), seen = new Set<string>()): string | undefined => {
  const node = astRecord(value);
  if (!node) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateElement") {
    const cooked = astRecord(node.value)?.cooked;
    return typeof cooked === "string" ? cooked : undefined;
  }
  if (node.type === "Identifier" && typeof node.name === "string") {
    if (seen.has(node.name)) return undefined;
    seen.add(node.name);
    return bindings.get(node.name);
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = staticStringValue(node.left, bindings, new Set(seen));
    const right = staticStringValue(node.right, bindings, new Set(seen));
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (
    node.type === "TemplateLiteral"
    && Array.isArray(node.expressions)
    && Array.isArray(node.quasis)
  ) {
    let result = "";
    for (let index = 0; index < node.quasis.length; index += 1) {
      const quasi = staticStringValue(node.quasis[index], bindings, new Set(seen));
      if (quasi === undefined) return undefined;
      result += quasi;
      if (index < node.expressions.length) {
        const expression = staticStringValue(node.expressions[index], bindings, new Set(seen));
        if (expression === undefined) return undefined;
        result += expression;
      }
    }
    return result;
  }
  return undefined;
};

const astName = (value: unknown): string | undefined => {
  const node = astRecord(value);
  if (!node) return undefined;
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  return staticStringValue(node);
};

const assignmentTargetName = (value: unknown): string | undefined => {
  const node = astRecord(value);
  if (!node) return undefined;
  if (node.type === "Identifier") return astName(node);
  if (node.type === "MemberExpression") return astName(node.property);
  return undefined;
};

const exchangeValue = (node: AstRecord, bindings: StaticBindings): string | undefined | null => {
  if (node.type === "VariableDeclarator" && astName(node.id)?.toLowerCase() === "exchange") {
    return staticStringValue(node.init, bindings) ?? null;
  }
  if (node.type === "Property" && astName(node.key)?.toLowerCase() === "exchange") {
    return staticStringValue(node.value, bindings) ?? null;
  }
  if (node.type === "AssignmentExpression" && assignmentTargetName(node.left)?.toLowerCase() === "exchange") {
    return staticStringValue(node.right, bindings) ?? null;
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

const immutableStaticBindings = (syntaxTree: unknown): StaticBindings => {
  const definitions = new Map<string, StaticBindingDefinition>();
  const writes = new Set<string>();
  walkAst(syntaxTree, (node) => {
    if (node.type === "VariableDeclaration" && Array.isArray(node.declarations)) {
      for (const declarationValue of node.declarations) {
        const declaration = astRecord(declarationValue);
        const name = declaration && astName(declaration.id);
        if (!declaration || !name) continue;
        const prior = definitions.get(name);
        definitions.set(name, {
          init: declaration.init,
          immutable: node.kind === "const" && prior === undefined,
        });
      }
    }
    if (node.type === "AssignmentExpression" || node.type === "UpdateExpression") {
      const target = astRecord(node.type === "AssignmentExpression" ? node.left : node.argument);
      if (target?.type === "Identifier" && typeof target.name === "string") writes.add(target.name);
    }
  });

  const bindings: StaticBindings = new Map();
  for (let pass = 0; pass < definitions.size; pass += 1) {
    let changed = false;
    for (const [name, definition] of definitions) {
      if (!definition.immutable || writes.has(name) || bindings.has(name)) continue;
      const value = staticStringValue(definition.init, bindings);
      if (value !== undefined) {
        bindings.set(name, value);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return bindings;
};

const forbiddenExchange = (value: string): string | undefined => {
  const lowered = value.toLowerCase();
  return FORBIDDEN_EXCHANGES.find((token) => lowered.includes(token));
};

const calleeName = (value: unknown): string | undefined => {
  const node = astRecord(value);
  if (!node) return undefined;
  if (node.type === "Identifier") return astName(node);
  if (node.type === "MemberExpression") return astName(node.property);
  return undefined;
};

const networkDestination = (node: AstRecord): { value: unknown; schemes: Set<string> } | null => {
  if (node.type === "CallExpression" && calleeName(node.callee)?.toLowerCase() === "fetch") {
    return { value: Array.isArray(node.arguments) ? node.arguments[0] : undefined, schemes: HTTP_SCHEMES };
  }
  if (node.type !== "NewExpression") return null;
  const name = calleeName(node.callee)?.toLowerCase();
  if (name === "websocket") return { value: Array.isArray(node.arguments) ? node.arguments[0] : undefined, schemes: WEBSOCKET_SCHEMES };
  if (name === "eventsource" || name === "request" || name === "webtransport") {
    return { value: Array.isArray(node.arguments) ? node.arguments[0] : undefined, schemes: HTTP_SCHEMES };
  }
  return null;
};

const validateUrl = (candidate: string, schemes: Set<string>): string | null => {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return `偵測到無效網路網址：${candidate}`;
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (!schemes.has(scheme)) return `不支援的網路協定：${scheme}`;
  if (url.username !== "" || url.password !== "") return "網路網址不得包含使用者資訊";
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "weex.com" && !hostname.endsWith(".weex.com")) return `偵測到非 WEEX 網域：${hostname}`;
  return null;
};

const canonicalBlockErrors = (config: BotConfig, validateValues: boolean): string[] => {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const strategy of config.blocks) {
    if (seen.has(strategy.id)) errors.push(`策略模組不得重複：${strategy.id}`);
    seen.add(strategy.id);
    const canonical = STRATEGY_BLOCKS.find((block) => block.id === strategy.id);
    if (!canonical) {
      errors.push(`未知策略模組：${strategy.id}`);
      continue;
    }
    if (strategy.name !== canonical.name) errors.push(`策略模組名稱不正確：${strategy.id}`);
    if (strategy.description !== canonical.description) errors.push(`策略模組說明不正確：${strategy.id}`);
    if (strategy.group !== canonical.group) errors.push(`策略模組群組不正確：${strategy.id}`);
    const parameterKeys = new Set<string>();
    for (const item of strategy.parameters) {
      if (parameterKeys.has(item.key)) errors.push(`策略參數不得重複：${strategy.id}.${item.key}`);
      parameterKeys.add(item.key);
      const expected = canonical.parameters.find((parameter) => parameter.key === item.key);
      if (!expected) {
        errors.push(`未知策略參數：${strategy.id}.${item.key}`);
        continue;
      }
      if (item.label !== expected.label) errors.push(`策略參數標籤不正確：${strategy.id}.${item.key}`);
      if (item.suffix !== expected.suffix) errors.push(`策略參數單位不正確：${strategy.id}.${item.key}`);
      if (item.min !== expected.min || item.max !== expected.max || item.step !== expected.step) {
        errors.push(`策略參數定義不正確：${strategy.id}.${item.key}`);
      }
      if (validateValues && (item.value < expected.min || item.value > expected.max)) {
        errors.push(`${canonical.name}的${expected.label}必須介於 ${expected.min} 到 ${expected.max}`);
      }
      if (validateValues && Number.isFinite(item.value)) {
        const steps = (item.value - expected.min) / expected.step;
        if (!Number.isFinite(steps) || Math.abs(steps - Math.round(steps)) > 1e-8) {
          errors.push(`${canonical.name}的${expected.label}必須符合步進 ${expected.step}`);
        }
        if ((/period/i.test(item.key) || /count/i.test(item.key) || item.key === "intervalDays") && !Number.isInteger(item.value)) {
          errors.push(`${canonical.name}的${expected.label}必須是整數`);
        }
      }
    }
    for (const expected of canonical.parameters) {
      if (!parameterKeys.has(expected.key)) errors.push(`缺少策略參數：${strategy.id}.${expected.key}`);
    }
  }
  return errors;
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
  const bindings = immutableStaticBindings(syntaxTree);
  const compoundChildren = new Set<AstRecord>();
  let explicitlyWeex = false;

  walkAst(syntaxTree, (node) => {
    if (node.type === "BinaryExpression") {
      const left = astRecord(node.left);
      const right = astRecord(node.right);
      if (left) compoundChildren.add(left);
      if (right) compoundChildren.add(right);
    }
    if (node.type === "TemplateLiteral") {
      if (Array.isArray(node.quasis)) node.quasis.forEach((item) => { const child = astRecord(item); if (child) compoundChildren.add(child); });
      if (Array.isArray(node.expressions)) node.expressions.forEach((item) => { const child = astRecord(item); if (child) compoundChildren.add(child); });
    }
  });

  walkAst(syntaxTree, (node) => {
    const assignedExchange = exchangeValue(node, bindings);
    if (assignedExchange !== undefined) {
      if (assignedExchange?.toUpperCase() === "WEEX") {
        explicitlyWeex = true;
      } else {
        exchangeErrors.add(assignedExchange === null ? "無法確認" : assignedExchange.toLowerCase());
      }
    }

    if (node.type === "Identifier" && typeof node.name === "string") {
      const forbidden = forbiddenExchange(node.name);
      if (forbidden) errors.push(`偵測到非 WEEX 交易所識別字：${forbidden}`);
    }

    const destination = networkDestination(node);
    if (destination) {
      const resolved = staticStringValue(destination.value, bindings);
      if (resolved === undefined) {
        errors.push("網路目的地必須是可靜態確認的 WEEX 網址");
      } else {
        const urlError = validateUrl(resolved, destination.schemes);
        if (urlError) errors.push(urlError);
        else explicitlyWeex = true;
      }
    }

    const staticValue = staticStringValue(node, bindings);
    if (staticValue === undefined) return;
    const forbidden = forbiddenExchange(staticValue);
    if (forbidden) errors.push(`偵測到非 WEEX 交易所識別字：${forbidden}`);
    if (node.type === "TemplateElement" || compoundChildren.has(node)) return;
    for (const match of staticValue.matchAll(NETWORK_URL_CANDIDATE_PATTERN)) {
      const candidate = match[0];
      const scheme = candidate.slice(0, candidate.indexOf(":")).toLowerCase();
      if (!SUPPORTED_NETWORK_SCHEMES.has(scheme)) {
        errors.push(`不支援的網路協定：${scheme}`);
        continue;
      }

      let url: URL;
      try {
        url = new URL(candidate);
      } catch {
        errors.push(`偵測到無效網路網址：${candidate}`);
        continue;
      }

      if (url.username !== "" || url.password !== "") {
        errors.push("網路網址不得包含使用者資訊");
        continue;
      }

      const hostname = url.hostname.toLowerCase();
      if (hostname === "") {
        errors.push(`偵測到無效網路網址：${candidate}`);
        continue;
      }
      if (hostname === "weex.com" || hostname.endsWith(".weex.com")) {
        explicitlyWeex = true;
      } else {
        errors.push(`偵測到非 WEEX 網域：${hostname}`);
      }
    }
  });

  exchangeErrors.forEach((exchange) => errors.push(`偵測到非 WEEX 交易所識別字：${exchange}`));
  if (!explicitlyWeex) errors.push("策略程式碼必須明確指定 WEEX 交易所");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
};

const SOURCE_CONFIG_FIELDS = {
  market: "市場",
  symbol: "交易對",
  timeframe: "時間週期",
} as const;

const sourceConfigErrors = (source: string, config: BotConfig): string[] => {
  let syntaxTree: unknown;
  try {
    syntaxTree = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return [];
  }
  const bindings = immutableStaticBindings(syntaxTree);
  const found = new Map<keyof typeof SOURCE_CONFIG_FIELDS, Set<string>>();
  walkAst(syntaxTree, (node) => {
    let key: string | undefined;
    let rawValue: unknown;
    if (node.type === "VariableDeclarator") {
      key = astName(node.id);
      rawValue = node.init;
    } else if (node.type === "Property") {
      key = astName(node.key);
      rawValue = node.value;
    } else if (node.type === "AssignmentExpression") {
      key = assignmentTargetName(node.left);
      rawValue = node.right;
    }
    const normalized = key?.toLowerCase() as keyof typeof SOURCE_CONFIG_FIELDS | undefined;
    if (!normalized || !(normalized in SOURCE_CONFIG_FIELDS)) return;
    const resolved = staticStringValue(rawValue, bindings);
    if (resolved !== undefined) {
      const values = found.get(normalized) ?? new Set<string>();
      values.add(resolved);
      found.set(normalized, values);
    }
  });
  const errors: string[] = [];
  for (const field of Object.keys(SOURCE_CONFIG_FIELDS) as Array<keyof typeof SOURCE_CONFIG_FIELDS>) {
    for (const sourceValue of found.get(field) ?? []) {
      if (sourceValue !== config[field]) {
        errors.push(`JavaScript 的${SOURCE_CONFIG_FIELDS[field]}（${sourceValue}）與策略設定（${config[field]}）不一致`);
      }
    }
  }
  return errors;
};

export const canonicalizeBotConfig = (config: BotConfig): BotConfig => ({
  ...config,
  blocks: config.blocks.map((block) => {
    const canonical = STRATEGY_BLOCKS.find((item) => item.id === block.id)!;
    const values = new Map(block.parameters.map((parameter) => [parameter.key, parameter.value]));
    return {
      ...canonical,
      parameters: canonical.parameters.map((parameter) => ({
        ...parameter,
        value: values.get(parameter.key) ?? parameter.value,
      })),
    };
  }),
});

export const validateDraftConfig = (value: unknown): ValidationResult => {
  if (!hasBotConfigShape(value)) return { valid: false, errors: ["策略設定格式不正確"] };
  const errors: string[] = [];
  if (value.exchange !== "WEEX") errors.push("目前可用的實盤連線為 WEEX API");
  errors.push(...canonicalBlockErrors(value as BotConfig, false));
  return { valid: errors.length === 0, errors };
};

export const validateConfig = (value: unknown): ValidationResult => {
  if (!hasBotConfigShape(value)) return { valid: false, errors: ["策略設定格式不正確"] };
  const config = value;
  const errors: string[] = [];

  if (config.exchange !== "WEEX") errors.push("目前可用的實盤連線為 WEEX API");
  errors.push(...canonicalBlockErrors(config as BotConfig, true));
  if (!config.blocks.some((block) => block.group === "entry")) errors.push("至少需要一個進場訊號");
  if (!config.blocks.some((block) => block.group === "exit" || block.group === "risk")) {
    errors.push("至少需要一個出場或風控規則");
  }

  if (config.market === "spot" && config.leverage !== 1) errors.push("現貨交易槓桿必須為 1");
  if (config.market === "futures" && (!Number.isFinite(config.leverage) || config.leverage < 1 || config.leverage > 500)) {
    errors.push("合約交易槓桿必須介於 1 到 WEEX 支援上限（最高 500）");
  }

  for (const strategy of config.blocks) {
    for (const item of strategy.parameters) {
      if (!Number.isFinite(item.value)) {
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

  if (config.source !== undefined) {
    errors.push(...validateJavaScript(config.source).errors);
    errors.push(...sourceConfigErrors(config.source, config as BotConfig));
  }

  return { valid: errors.length === 0, errors };
};
