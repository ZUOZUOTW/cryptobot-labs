import type { ActivityItem, ActivityList } from "./types";

const ITEM_KEYS = ["id", "type", "occurredAt", "actorType", "deviceId", "deploymentId", "deploymentVersion",
  "strategyVersionId", "strategyVersion", "configurationHash", "scriptHash", "reason", "riskDecision",
  "clientOrderId", "exchangeOrderId", "status", "correlationId"] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;
const HASH = /^(?:[A-Fa-f0-9]{64}|[A-Za-z0-9_-]{43})$/;

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const identifier = (value: unknown): string | null => typeof value === "string" && IDENTIFIER.test(value) ? value : null;
const nullableIdentifier = (value: unknown): string | null | undefined => value === null ? null : identifier(value) ?? undefined;
const nullableVersion = (value: unknown): number | null | undefined => value === null ? null
  : Number.isSafeInteger(value) && (value as number) >= 1 ? value as number : undefined;
const nullableHash = (value: unknown): string | null | undefined => value === null ? null
  : typeof value === "string" && HASH.test(value) ? value : undefined;
const nullableText = (value: unknown, maximum = 256): string | null | undefined => value === null ? null
  : typeof value === "string" && value.length >= 1 && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    ? value : undefined;

const parseItem = (value: unknown): ActivityItem | null => {
  const source = record(value);
  if (!source || !exact(source, ITEM_KEYS)) return null;
  const id = identifier(source.id);
  const type = nullableText(source.type, 128);
  const deviceId = nullableIdentifier(source.deviceId);
  const deploymentId = nullableIdentifier(source.deploymentId);
  const deploymentVersion = nullableVersion(source.deploymentVersion);
  const strategyVersionId = nullableIdentifier(source.strategyVersionId);
  const strategyVersion = nullableVersion(source.strategyVersion);
  const configurationHash = nullableHash(source.configurationHash);
  const scriptHash = nullableHash(source.scriptHash);
  const reason = nullableText(source.reason, 512);
  const riskDecision = nullableText(source.riskDecision, 256);
  const clientOrderId = nullableIdentifier(source.clientOrderId);
  const exchangeOrderId = nullableIdentifier(source.exchangeOrderId);
  const status = nullableText(source.status, 128);
  const correlationId = identifier(source.correlationId);
  if (!id || !type || !Number.isSafeInteger(source.occurredAt) || (source.occurredAt as number) < 0
    || (source.actorType !== "user" && source.actorType !== "device") || deviceId === undefined
    || deploymentId === undefined || deploymentVersion === undefined
    || strategyVersionId === undefined || strategyVersion === undefined
    || configurationHash === undefined || scriptHash === undefined || reason === undefined || riskDecision === undefined
    || clientOrderId === undefined || exchangeOrderId === undefined || status === undefined || !correlationId) return null;
  return { id, type, occurredAt: source.occurredAt as number, actorType: source.actorType, deviceId,
    deploymentId, deploymentVersion, strategyVersionId, strategyVersion, configurationHash, scriptHash,
    reason, riskDecision, clientOrderId, exchangeOrderId, status, correlationId };
};

export function parseActivityList(value: unknown): ActivityList | null {
  const source = record(value);
  if (!source || !exact(source, ["items", "nextCursor"]) || !Array.isArray(source.items)
    || source.items.length > 100 || (source.nextCursor !== null && (typeof source.nextCursor !== "string" || !CURSOR.test(source.nextCursor)))) return null;
  const items = source.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  return { items: items as ActivityItem[], nextCursor: source.nextCursor as string | null };
}
