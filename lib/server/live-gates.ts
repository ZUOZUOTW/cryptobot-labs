import type { RiskPolicyRecord } from "../../db/repositories/deployments";
import type { ConnectionPermissions } from "../../db/repositories/connections";
import type { JsonObject } from "../control-plane/types";
import { safeCanonicalJsonStringify } from "../control-plane/schemas";
import { HttpProblem } from "./http";

const CONTROL = /[\u0000-\u001f\u007f]/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._:-]{1,63}$/;
const POSITIVE_DECIMAL = /^(?=.*[1-9])(?:0|[1-9]\d*)(?:\.\d+)?$/;

export interface LiveGateConnection {
  status: "verified" | "erased";
  hasLocalCredential: boolean;
  withdrawalAccessAbsent: boolean;
  version: number;
  verifiedAt: number | null;
  permissions: ConnectionPermissions;
}

export interface LiveGateContext {
  botName: string;
  market: "spot" | "futures";
  connection: LiveGateConnection | null;
  risk: RiskPolicyRecord;
}

export interface LiveUnlockConsent {
  typedBotName: string;
  riskAcknowledged: boolean;
  acceptedAt: number;
}

const plainRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new HttpProblem(400, "invalid_request", `${label} is invalid`);
  return value as Record<string, unknown>;
};
const exact = (record: Record<string, unknown>, keys: readonly string[], label: string): void => {
  if (Object.keys(record).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(record, key))) {
    throw new HttpProblem(400, "invalid_request", `${label} fields are invalid`);
  }
};
const positiveVersion = (value: unknown, label = "expectedVersion"): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new HttpProblem(400, "invalid_request", `${label} is invalid`);
  return value as number;
};
const boundedText = (value: unknown, label: string, maximum = 256): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || CONTROL.test(value)) {
    throw new HttpProblem(400, "invalid_request", `${label} is invalid`);
  }
  return value;
};
const freshTimestamp = (value: unknown, now: number, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < now - 300_000 || (value as number) > now) {
    throw new HttpProblem(400, "invalid_request", `${label} is stale or invalid`);
  }
  return value as number;
};

export function parseLiveUnlockConsent(value: unknown): LiveUnlockConsent & { expectedVersion: number } {
  const record = plainRecord(value, "live unlock");
  exact(record, ["expectedVersion", "typedBotName", "riskAcknowledged", "acceptedAt"], "live unlock");
  return {
    expectedVersion: positiveVersion(record.expectedVersion),
    typedBotName: boundedText(record.typedBotName, "typed bot name", 100),
    riskAcknowledged: record.riskAcknowledged === true,
    acceptedAt: record.acceptedAt as number,
  };
}

export function assertLiveUnlock(context: LiveGateContext, consent: LiveUnlockConsent, now: number): void {
  if (consent.typedBotName !== context.botName) throw new HttpProblem(422, "conflict", "typed bot name does not match");
  if (consent.riskAcknowledged !== true) throw new HttpProblem(422, "conflict", "risk acknowledgement is required");
  freshTimestamp(consent.acceptedAt, now, "risk acknowledgement");
  const connection = context.connection;
  if (!connection || connection.status !== "verified" || !connection.hasLocalCredential || connection.verifiedAt === null) {
    throw new HttpProblem(422, "conflict", "a verified local connection is required");
  }
  if (!connection.withdrawalAccessAbsent || connection.permissions.withdrawal !== false) {
    throw new HttpProblem(422, "conflict", "withdrawal permission must be absent");
  }
  if (connection.permissions.read !== true
    || (context.market === "spot" ? !connection.permissions.spotTrade : !connection.permissions.futuresTrade)) {
    throw new HttpProblem(422, "conflict", "required trading permissions are missing");
  }
  const risk = context.risk;
  let symbols: unknown;
  try { symbols = JSON.parse(risk.allowedSymbolsJson); } catch { symbols = null; }
  const complete = Array.isArray(symbols) && symbols.length > 0 && symbols.length <= 100
    && symbols.every((symbol) => typeof symbol === "string" && SYMBOL.test(symbol))
    && [risk.maxOrderNotional, risk.maxPositionNotional, risk.maxTotalExposure, risk.maxDailyLoss, risk.maxLeverage]
      .every((item) => POSITIVE_DECIMAL.test(item))
    && Number.isSafeInteger(risk.maxSimultaneousPositions) && risk.maxSimultaneousPositions > 0
    && Number.isSafeInteger(risk.maxSlippageBps) && risk.maxSlippageBps >= 0
    && Number.isSafeInteger(risk.minSignalCooldownMs) && risk.minSignalCooldownMs >= 0
    && Number.isSafeInteger(risk.maxConsecutiveFailures) && risk.maxConsecutiveFailures > 0
    && (risk.operationMode === "approval-required" || risk.operationMode === "automatic")
    && Number.isSafeInteger(risk.updatedAt);
  if (!complete) throw new HttpProblem(422, "conflict", "risk policy is incomplete");
}

export async function createLiveRevalidationEnvelope(context: LiveGateContext, input: {
  strategyVersionId: string;
  deploymentConfigurationHash: string;
}): Promise<JsonObject> {
  const connection = context.connection;
  if (!connection) throw new HttpProblem(409, "conflict", "connection is missing");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.strategyVersionId)
    || !/^[a-f0-9]{64}$/.test(input.deploymentConfigurationHash)) {
    throw new HttpProblem(409, "conflict", "approved deployment identity is invalid");
  }
  let allowedSymbols: unknown;
  try { allowedSymbols = JSON.parse(context.risk.allowedSymbolsJson); } catch { allowedSymbols = null; }
  if (!Array.isArray(allowedSymbols) || allowedSymbols.length < 1 || allowedSymbols.length > 100
    || allowedSymbols.some((symbol) => typeof symbol !== "string" || !SYMBOL.test(symbol))
    || new Set(allowedSymbols).size !== allowedSymbols.length) {
    throw new HttpProblem(409, "conflict", "approved symbols are invalid");
  }
  const snapshot = {
    id: context.risk.id,
    versionFence: { updatedAt: context.risk.updatedAt },
    allowedSymbols,
    maxOrderNotional: context.risk.maxOrderNotional,
    maxPositionNotional: context.risk.maxPositionNotional,
    maxTotalExposure: context.risk.maxTotalExposure,
    maxSimultaneousPositions: context.risk.maxSimultaneousPositions,
    maxDailyLoss: context.risk.maxDailyLoss,
    maxLeverage: context.risk.maxLeverage,
    maxSlippageBps: context.risk.maxSlippageBps,
    minSignalCooldownMs: context.risk.minSignalCooldownMs,
    maxConsecutiveFailures: context.risk.maxConsecutiveFailures,
    operationMode: context.risk.operationMode,
  };
  const canonical = safeCanonicalJsonStringify(snapshot, "approved risk policy", 16_384);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    localConnection: true,
    permissions: true,
    fetchCurrentProductMetadata: true,
    connectionVersion: connection.version,
    deploymentConfigurationHash: input.deploymentConfigurationHash,
    strategyMarket: context.market,
    allowedSymbols,
    strategyVersionId: input.strategyVersionId,
    riskPolicy: { id: context.risk.id, versionFence: { updatedAt: context.risk.updatedAt }, hash },
  };
}

export type RunCommand = {
  type: "resume-paper" | "resume-live" | "pause" | "stop-new-orders" | "cancel-open-orders" | "close-positions";
  expectedVersion: number;
  payload: JsonObject;
  confirmedAt?: number;
};

export function parseRunCommand(value: unknown, now: number): RunCommand {
  const record = plainRecord(value, "command");
  if (record.type === "resume-paper" || record.type === "resume-live" || record.type === "pause") {
    exact(record, ["type", "expectedVersion", "reason"], "lifecycle command");
    return { type: record.type, expectedVersion: positiveVersion(record.expectedVersion),
      payload: { reason: boundedText(record.reason, "reason") } };
  }
  if (record.type === "stop-new-orders") {
    exact(record, ["type", "expectedVersion", "reason"], "stop command");
    return { type: "stop-new-orders", expectedVersion: positiveVersion(record.expectedVersion),
      payload: { reason: boundedText(record.reason, "reason") } };
  }
  if (record.type === "cancel-open-orders") {
    exact(record, ["type", "expectedVersion", "scope", "reason"], "cancel command");
    if (record.scope !== "deployment") throw new HttpProblem(400, "invalid_request", "cancel scope is invalid");
    return { type: "cancel-open-orders", expectedVersion: positiveVersion(record.expectedVersion),
      payload: { scope: "deployment", reason: boundedText(record.reason, "reason") } };
  }
  if (record.type === "close-positions") {
    exact(record, ["type", "expectedVersion", "scope", "symbol", "confirmationPhrase", "riskAcknowledged", "confirmedAt"], "close command");
    if (record.riskAcknowledged !== true) throw new HttpProblem(422, "conflict", "independent high-risk acknowledgement is required");
    if (record.confirmationPhrase !== "CLOSE POSITIONS") throw new HttpProblem(422, "conflict", "close confirmation phrase is invalid");
    if (record.scope !== "all" && record.scope !== "symbol") throw new HttpProblem(400, "invalid_request", "close scope is invalid");
    if ((record.scope === "all" && record.symbol !== null)
      || (record.scope === "symbol" && (typeof record.symbol !== "string" || !SYMBOL.test(record.symbol)))) {
      throw new HttpProblem(400, "invalid_request", "close symbol is invalid");
    }
    const confirmedAt = freshTimestamp(record.confirmedAt, now, "close confirmation");
    return { type: "close-positions", expectedVersion: positiveVersion(record.expectedVersion), confirmedAt,
      payload: { scope: record.scope, symbol: record.symbol as string | null } };
  }
  throw new HttpProblem(400, "invalid_request", "command type is invalid");
}

export const parseEmergencyCommand = parseRunCommand;
