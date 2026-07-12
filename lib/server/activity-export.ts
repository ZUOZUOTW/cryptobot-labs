import type { ActivityEvidenceRecord } from "../../db/repositories";
import type { ApiAuthDependencies } from "./auth";
import { requireApiUser } from "./auth";
import { HttpProblem, errorResponse, jsonResponse } from "./http";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const INTEGER = /^(?:0|[1-9]\d*)$/;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1_000;
const MAX_LIMIT = 100;

export interface ActivityItem {
  id: string;
  type: string;
  occurredAt: number;
  actorType: "user" | "device";
  deviceId: string | null;
  deploymentId: string | null;
  deploymentVersion: number | null;
  strategyVersionId: string | null;
  strategyVersion: number | null;
  configurationHash: string | null;
  scriptHash: string | null;
  reason: string | null;
  riskDecision: string | null;
  clientOrderId: string | null;
  exchangeOrderId: string | null;
  status: string | null;
  correlationId: string;
}

type ActivityRepository = {
  listActivityForUser(userId: string, options: { limit: number; cursor?: { occurredAt: number; id: string };
    from?: number; to?: number }): Promise<{ items: ActivityEvidenceRecord[];
      nextCursor: { occurredAt: number; id: string } | null }>;
};

const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object"
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const safeText = (value: unknown, maximum: number): string | null => typeof value === "string" && value.length > 0
  && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
const safeId = (value: unknown): string | null => typeof value === "string" && ID.test(value) ? value : null;
const safeHash = (value: unknown): string | null => typeof value === "string" && HASH.test(value) ? value : null;
const safeVersion = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 1
  ? value as number : null;

const DEVICE_PAYLOAD_TYPES = new Set(["heartbeat", "order-state", "fill", "risk-block", "signal", "deployment-state",
  "key-erased", "connection-verified", "key-rotated", "agent-error"]);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

const payloadEvidence = (record: ActivityEvidenceRecord): { body: Record<string, unknown>; deploymentVersion: number | null } => {
  // User-authored and unknown audit events are untrusted display input. Their payloads stay opaque by default.
  if (record.actorType !== "device" || !DEVICE_PAYLOAD_TYPES.has(record.type)) {
    return { body: {}, deploymentVersion: null };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(record.payloadJson); } catch { return { body: {}, deploymentVersion: null }; }
  if (!plain(parsed)) return { body: {}, deploymentVersion: null };
  if (parsed.version === 1 && plain(parsed.payload)) {
    return { body: parsed.payload, deploymentVersion: safeVersion(parsed.expectedDeploymentVersion) };
  }
  return { body: parsed, deploymentVersion: safeVersion(parsed.expectedDeploymentVersion ?? parsed.expectedVersion) };
};

export function projectActivityItem(record: ActivityEvidenceRecord): ActivityItem {
  if (record.actorType !== "user" && record.actorType !== "device") throw new Error("stored activity actor is invalid");
  const evidence = payloadEvidence(record);
  let reason: string | null = null;
  let riskDecision: string | null = null;
  let payloadClientOrderId: string | null = null;
  let payloadExchangeOrderId: string | null = null;
  let payloadStatus: string | null = null;
  if (record.type === "order-state" || record.type === "fill") {
    const order = plain(evidence.body.order) ? evidence.body.order : {};
    if (exactKeys(evidence.body, ["mode", "deploymentState", "order", "fills"])) {
      payloadClientOrderId = safeId(order.clientOrderId);
      payloadExchangeOrderId = safeId(order.exchangeOrderId);
      payloadStatus = safeText(order.state, 128);
    }
  } else if (record.type === "risk-block" && exactKeys(evidence.body, ["code", "symbol", "message"])) {
    reason = safeText(evidence.body.message, 512);
    riskDecision = safeText(evidence.body.code, 128);
  } else if (record.type === "signal" && exactKeys(evidence.body, ["symbol", "action", "side", "quantity", "price", "reason"])) {
    reason = safeText(evidence.body.reason, 512);
    payloadStatus = safeText(evidence.body.action, 128);
  } else if (record.type === "deployment-state" && exactKeys(evidence.body, ["state", "reason"])) {
    reason = safeText(evidence.body.reason, 512);
    payloadStatus = safeText(evidence.body.state, 128);
  } else if (record.type === "key-erased"
    && (exactKeys(evidence.body, ["reason"]) || exactKeys(evidence.body, ["reason", "connectionVersion"]))) {
    reason = safeText(evidence.body.reason, 512);
  } else if (record.type === "agent-error" && exactKeys(evidence.body, ["code", "message", "retryable"])) {
    reason = safeText(evidence.body.message, 512);
    payloadStatus = safeText(evidence.body.code, 128);
  }
  const candidateDeploymentId = safeId(record.deploymentId);
  const deploymentVersion = candidateDeploymentId === null ? null : evidence.deploymentVersion;
  const deploymentId = deploymentVersion === null ? null : candidateDeploymentId;
  const candidateStrategyVersionId = safeId(record.strategyVersionId) ?? safeId(record.deploymentStrategyVersionId);
  const candidateStrategyVersion = safeVersion(record.strategyVersion);
  const strategyVersionId = candidateStrategyVersion === null ? null : candidateStrategyVersionId;
  const strategyVersion = strategyVersionId === null ? null : candidateStrategyVersion;
  return {
    id: safeId(record.id) ?? (() => { throw new Error("stored activity id is invalid"); })(),
    type: safeText(record.type, 128) ?? (() => { throw new Error("stored activity type is invalid"); })(),
    occurredAt: Number.isSafeInteger(record.occurredAt) && record.occurredAt >= 0
      ? record.occurredAt : (() => { throw new Error("stored activity timestamp is invalid"); })(),
    actorType: record.actorType,
    deviceId: safeId(record.deviceId),
    deploymentId,
    deploymentVersion,
    strategyVersionId,
    strategyVersion,
    configurationHash: safeHash(record.deploymentConfigurationHash) ?? safeHash(record.strategyConfigHash),
    scriptHash: safeHash(record.strategySourceHash),
    reason,
    riskDecision,
    clientOrderId: record.type === "order-state" || record.type === "fill"
      ? safeId(record.clientOrderId) ?? payloadClientOrderId : null,
    exchangeOrderId: record.type === "order-state" || record.type === "fill"
      ? safeId(record.exchangeOrderId) ?? payloadExchangeOrderId : null,
    status: record.type === "order-state" || record.type === "fill"
      ? safeText(record.orderStatus, 128) ?? payloadStatus : payloadStatus,
    correlationId: safeId(record.correlationId) ?? (() => { throw new Error("stored correlation id is invalid"); })(),
  };
}

const CSV_COLUMNS: ReadonlyArray<keyof ActivityItem> = ["id", "type", "occurredAt", "actorType", "deviceId",
  "deploymentId", "deploymentVersion", "strategyVersionId", "strategyVersion", "configurationHash", "scriptHash",
  "reason", "riskDecision", "clientOrderId", "exchangeOrderId", "status", "correlationId"];

const csvCell = (value: ActivityItem[keyof ActivityItem]): string => {
  let cell = value === null ? "" : String(value);
  const inspectionCopy = cell.normalize("NFKC");
  if (/^[\p{White_Space}\p{Cf}]*[=+\-@]/u.test(inspectionCopy)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
};

export function serializeActivityCsv(items: readonly ActivityItem[]): string {
  return [CSV_COLUMNS.join(","), ...items.map((item) => CSV_COLUMNS.map((column) => csvCell(item[column])).join(","))]
    .join("\r\n");
}

const encodeCursor = (cursor: { occurredAt: number; id: string }): string =>
  btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const decodeCursor = (value: string): { occurredAt: number; id: string } => {
  if (!CURSOR.test(value)) throw new HttpProblem(400, "invalid_request");
  let decoded: unknown;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    decoded = JSON.parse(atob(base64));
  } catch { throw new HttpProblem(400, "invalid_request"); }
  if (!plain(decoded) || Object.keys(decoded).sort().join(",") !== "id,occurredAt"
    || !Number.isSafeInteger(decoded.occurredAt) || (decoded.occurredAt as number) < 0
    || typeof decoded.id !== "string" || !ID.test(decoded.id)) throw new HttpProblem(400, "invalid_request");
  return { occurredAt: decoded.occurredAt as number, id: decoded.id };
};

const integerQuery = (value: string | null, label: string): number | undefined => {
  if (value === null) return undefined;
  if (!INTEGER.test(value)) throw new HttpProblem(400, "invalid_request", `${label} is invalid`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new HttpProblem(400, "invalid_request", `${label} is invalid`);
  return result;
};

const parseQuery = (request: Request, exportRequest: boolean) => {
  const url = new URL(request.url); const allowed = new Set(["limit", "from", "to", "cursor", ...(exportRequest ? ["format"] : [])]);
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!allowed.has(key) || seen.has(key)) throw new HttpProblem(400, "invalid_request");
    seen.add(key);
  }
  const limit = integerQuery(url.searchParams.get("limit"), "limit") ?? 50;
  const from = integerQuery(url.searchParams.get("from"), "from");
  const to = integerQuery(url.searchParams.get("to"), "to");
  if (limit < 1 || limit > MAX_LIMIT || (from !== undefined && to !== undefined
    && (from > to || to - from > MAX_RANGE_MS))) throw new HttpProblem(400, "invalid_request");
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === null ? undefined : decodeCursor(rawCursor);
  const format = exportRequest ? (url.searchParams.get("format") ?? "csv") : undefined;
  if (format !== undefined && format !== "csv" && format !== "json") throw new HttpProblem(400, "invalid_request");
  return { options: { limit, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }),
    ...(cursor === undefined ? {} : { cursor }) }, format };
};

export function createActivityHandlers(dependencies: { auth: ApiAuthDependencies; activity: ActivityRepository }) {
  const read = async (request: Request, exportRequest: boolean): Promise<Response> => {
    try {
      const authenticated = await requireApiUser(request, dependencies.auth);
      if (!authenticated.ok) return authenticated.response;
      const query = parseQuery(request, exportRequest);
      const result = await dependencies.activity.listActivityForUser(authenticated.user.id, query.options);
      const items = result.items.map(projectActivityItem);
      const nextCursor = result.nextCursor === null ? null : encodeCursor(result.nextCursor);
      if (!exportRequest || query.format === "json") return jsonResponse({ items, nextCursor }, exportRequest
        ? { headers: { "content-disposition": 'attachment; filename="cryptobot-labs-activity.json"' } } : {});
      return new Response(serializeActivityCsv(items), { status: 200, headers: {
        "cache-control": "no-store", "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="cryptobot-labs-activity.csv"',
        ...(nextCursor === null ? {} : { "x-next-cursor": nextCursor }),
      } });
    } catch (error) {
      if (error instanceof HttpProblem) return errorResponse(error, { status: error.status, code: error.code });
      return errorResponse(error, { status: 500, code: "internal" });
    }
  };
  return { list: (request: Request) => read(request, false), export: (request: Request) => read(request, true) };
}
