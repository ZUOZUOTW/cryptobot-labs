import {
  COMMAND_TYPES,
  RUN_MODES,
  type BacktestJobCreateDto,
  type CommandCreateDto,
  type CommandType,
  type HeartbeatDto,
  type HeartbeatPositionDto,
  type JsonObject,
  type JsonValue,
  type RunMode,
} from "./types";

type UnknownRecord = Record<string, unknown>;

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 2_048;
const SAFE_MASKED_METADATA_NAMES = new Set(["apikeysuffix", "maskedapikeysuffix"]);
const SENSITIVE_NAME_PARTS = [
  "secret", "apikey", "accesskey", "passphrase", "accesssign", "signature",
  "credential", "authorization", "authentication", "token", "rawaccount",
] as const;

const normalizedName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const isSensitiveName = (name: string): boolean => {
  const normalized = normalizedName(name);
  if (SAFE_MASKED_METADATA_NAMES.has(normalized)) return false;
  if (normalized.endsWith("keysuffix")) return true;
  return normalized === "auth"
    || normalized.startsWith("auth")
    || SENSITIVE_NAME_PARTS.some((part) => normalized.includes(part));
};

const asRecord = (value: unknown, label: string): UnknownRecord => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必須是物件`);
  }
  return value as UnknownRecord;
};

const assertExactKeys = (record: UnknownRecord, allowed: readonly string[]): void => {
  const known = new Set(allowed);
  const unknown = Object.keys(record).find((key) => !known.has(key));
  if (unknown) throw new Error(`未知欄位：${unknown}`);
};

const boundedString = (value: unknown, label: string, maximum: number): string => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} 必須是非空字串`);
  if (value.length > maximum) throw new Error(`${label} 長度不得超過 ${maximum}`);
  return value;
};

const integer = (value: unknown, label: string, minimum = 0): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} 必須是安全整數`);
  if (value < minimum) throw new Error(`${label} 不得小於 ${minimum}`);
  return value;
};

const decimal = (value: unknown, label: string, signed = false): string => {
  const text = boundedString(value, label, 128);
  if (!(signed ? SIGNED_DECIMAL : DECIMAL).test(text)) throw new Error(`${label} 必須是一般十進位字串`);
  return text;
};

const jsonValue = (value: unknown, label: string, maximumBytes: number): JsonValue => {
  const active = new WeakSet<object>();
  let nodes = 0;
  const clone = (item: unknown, depth: number): JsonValue => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) throw new Error(`${label} JSON 節點不得超過 ${MAX_JSON_NODES}`);
    if (depth > MAX_JSON_DEPTH) throw new Error(`${label} JSON 深度不得超過 ${MAX_JSON_DEPTH}`);

    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error(`${label} JSON 數字必須是有限值`);
      return item;
    }
    if (typeof item !== "object") throw new Error(`${label} 包含非 JSON 值`);
    if (active.has(item)) throw new Error(`${label} JSON 不得包含循環參照`);
    active.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype) throw new Error(`${label} 包含非 JSON 陣列`);
        if (Object.getOwnPropertySymbols(item).length > 0) throw new Error(`${label} 包含非 JSON symbol 欄位`);
        for (const key of Object.getOwnPropertyNames(item)) {
          if (key === "length") continue;
          const position = Number(key);
          if (!Number.isSafeInteger(position) || position < 0 || position >= item.length || String(position) !== key) {
            throw new Error(`${label} JSON 陣列不得包含額外屬性`);
          }
        }
        const result: JsonValue[] = [];
        for (let index = 0; index < item.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor) throw new Error(`${label} JSON 陣列不得為稀疏陣列`);
          if (!("value" in descriptor) || !descriptor.enumerable) throw new Error(`${label} 包含非 JSON 屬性`);
          result.push(clone(descriptor.value, depth + 1));
        }
        return result;
      }

      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} 包含非 JSON 物件`);
      if (Object.getOwnPropertySymbols(item).length > 0) throw new Error(`${label} 包含非 JSON symbol 欄位`);
      const result = Object.create(null) as Record<string, JsonValue>;
      const descriptors = Object.getOwnPropertyDescriptors(item);
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (isSensitiveName(key)) throw new Error(`偵測到敏感欄位：${key}`);
        if (!("value" in descriptor) || !descriptor.enumerable) throw new Error(`${label} 包含非 JSON 屬性`);
        Object.defineProperty(result, key, {
          configurable: true,
          enumerable: true,
          value: clone(descriptor.value, depth + 1),
          writable: true,
        });
      }
      return result;
    } finally {
      active.delete(item);
    }
  };

  const cloned = clone(value, 0);
  const safeSerialize = (item: JsonValue): string => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) return `[${item.map(safeSerialize).join(",")}]`;
    return `{${Object.keys(item).map((key) => `${JSON.stringify(key)}:${safeSerialize(item[key]!)}`).join(",")}}`;
  };

  const encoded = safeSerialize(cloned);
  if (new TextEncoder().encode(encoded).byteLength > maximumBytes) {
    throw new Error(`${label} JSON 大小不得超過 ${maximumBytes} bytes`);
  }
  return cloned;
};

export function parseBacktestJobCreateDto(value: unknown): BacktestJobCreateDto {
  const record = asRecord(jsonValue(value, "回測工作", 32_768), "回測工作");
  assertExactKeys(record, [
    "strategyVersionId", "market", "symbol", "interval", "startTime", "endTime",
    "initialCapital", "feeRate", "slippageRate",
  ]);
  const market = record.market;
  if (market !== "spot" && market !== "futures") throw new Error("market 必須是 spot 或 futures");
  const startTime = integer(record.startTime, "startTime");
  const endTime = integer(record.endTime, "endTime");
  if (endTime <= startTime) throw new Error("endTime 必須晚於 startTime");
  return {
    strategyVersionId: boundedString(record.strategyVersionId, "strategyVersionId", 128),
    market,
    symbol: boundedString(record.symbol, "symbol", 64),
    interval: boundedString(record.interval, "interval", 16),
    startTime,
    endTime,
    initialCapital: decimal(record.initialCapital, "initialCapital"),
    feeRate: decimal(record.feeRate, "feeRate"),
    slippageRate: decimal(record.slippageRate, "slippageRate"),
  };
}

export function parseCommandCreateDto(value: unknown): CommandCreateDto {
  const record = asRecord(jsonValue(value, "控制命令", 32_768), "控制命令");
  assertExactKeys(record, ["deploymentId", "type", "payload"]);
  if (typeof record.type !== "string" || !COMMAND_TYPES.includes(record.type as CommandType)) {
    throw new Error("type 不是支援的控制命令");
  }
  const payload = jsonValue(record.payload, "payload", 16_384);
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("payload 必須是 JSON 物件");
  }
  return {
    deploymentId: boundedString(record.deploymentId, "deploymentId", 128),
    type: record.type as CommandType,
    payload: payload as JsonObject,
  };
}

const parsePosition = (value: unknown): HeartbeatPositionDto => {
  const record = asRecord(value, "position");
  assertExactKeys(record, ["symbol", "quantity", "markPrice"]);
  return {
    symbol: boundedString(record.symbol, "symbol", 64),
    quantity: decimal(record.quantity, "quantity", true),
    markPrice: decimal(record.markPrice, "markPrice"),
  };
};

export function parseHeartbeatDto(value: unknown): HeartbeatDto {
  const record = asRecord(jsonValue(value, "heartbeat", 65_536), "heartbeat");
  assertExactKeys(record, ["deploymentId", "sequence", "occurredAt", "mode", "health", "positions"]);
  if (typeof record.mode !== "string" || !RUN_MODES.includes(record.mode as RunMode)) {
    throw new Error("mode 不是支援的運行模式");
  }
  if (record.health !== "healthy" && record.health !== "degraded" && record.health !== "paused") {
    throw new Error("health 不是支援的健康狀態");
  }
  if (!Array.isArray(record.positions)) throw new Error("positions 必須是陣列");
  if (record.positions.length > 100) throw new Error("positions 陣列不得超過 100 筆");
  return {
    deploymentId: boundedString(record.deploymentId, "deploymentId", 128),
    sequence: integer(record.sequence, "sequence"),
    occurredAt: integer(record.occurredAt, "occurredAt"),
    mode: record.mode as RunMode,
    health: record.health,
    positions: record.positions.map(parsePosition),
  };
}
