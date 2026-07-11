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
const SENSITIVE_NAMES = new Set([
  "secretkey",
  "passphrase",
  "accesssign",
  "authorization",
  "rawaccount",
]);

const normalizedName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

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

const assertNoSensitiveNames = (value: unknown, seen = new Set<object>()): void => {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("JSON 不得包含循環參照");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveNames(item, seen);
  } else {
    for (const [key, item] of Object.entries(value as UnknownRecord)) {
      if (SENSITIVE_NAMES.has(normalizedName(key))) throw new Error(`偵測到敏感欄位：${key}`);
      assertNoSensitiveNames(item, seen);
    }
  }
  seen.delete(value);
};

const jsonValue = (value: unknown, label: string, maximumBytes: number): JsonValue => {
  assertNoSensitiveNames(value);
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error(`${label} 必須是有效 JSON`);
  }
  if (encoded === undefined) throw new Error(`${label} 必須是有效 JSON`);
  if (new TextEncoder().encode(encoded).byteLength > maximumBytes) {
    throw new Error(`${label} JSON 大小不得超過 ${maximumBytes} bytes`);
  }
  const parsed = JSON.parse(encoded) as JsonValue;
  return parsed;
};

export function parseBacktestJobCreateDto(value: unknown): BacktestJobCreateDto {
  assertNoSensitiveNames(value);
  const record = asRecord(value, "回測工作");
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
  assertNoSensitiveNames(value);
  const record = asRecord(value, "控制命令");
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
  assertNoSensitiveNames(value);
  const record = asRecord(value, "heartbeat");
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
