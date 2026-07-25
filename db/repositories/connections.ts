import type { ControlPlaneDatabase, ControlPlaneRunResult } from "../index";
import { safeCanonicalJsonStringify } from "../../lib/control-plane/schemas";
import type { JsonObject } from "../../lib/control-plane/types";
import type { AuditEventRecord } from "./activity";
import { displayName, exactInput, id, limit, time } from "./shared";

export interface ConnectionPermissions {
  read: true;
  spotTrade: boolean;
  futuresTrade: boolean;
  withdrawal: false;
}
export type ConnectionStatus = "verified" | "erased";
export interface ConnectionRecord {
  deviceId: string; userId: string; provider: "WEEX"; maskedApiKeySuffix: string | null;
  permissionsJson: string; verifiedAt: number | null; status: ConnectionStatus;
  hasLocalCredential: number | boolean; withdrawalAccessAbsent: number | boolean;
  version: number; updatedAt: number;
}
export interface SafeConnectionSummary {
  provider: "WEEX"; maskedApiKeySuffix: string | null;
  permissions: ConnectionPermissions; verifiedAt: number | null; status: ConnectionStatus;
  hasLocalCredential: boolean;
}
export interface SafeConnectionDevice {
  id: string;
  name: string;
  platform: "macos" | "windows";
  deviceStatus: "active";
  lastSeenAt: number | null;
  connection: SafeConnectionSummary | null;
  commandTarget: { deploymentId: string; expectedVersion: number } | null;
}

interface ConnectionListRow {
  deviceId: string;
  deviceName: string;
  devicePlatform: string;
  deviceStatus: string;
  lastSeenAt: number | null;
  provider: string | null;
  maskedApiKeySuffix: string | null;
  permissionsJson: string | null;
  verifiedAt: number | null;
  status: ConnectionStatus | null;
  hasLocalCredential: number | boolean | null;
  commandDeploymentId: string | null;
  commandDeploymentVersion: number | null;
}

const columns = `device_id AS deviceId,user_id AS userId,provider,masked_api_key_suffix AS maskedApiKeySuffix,
  permissions_json AS permissionsJson,verified_at AS verifiedAt,status,
  has_local_credential AS hasLocalCredential,withdrawal_access_absent AS withdrawalAccessAbsent,
  version,updated_at AS updatedAt`;
const auditColumns = `id,user_id AS userId,actor_type AS actorType,actor_id AS actorId,device_id AS deviceId,
  deployment_id AS deploymentId,strategy_version_id AS strategyVersionId,type,correlation_id AS correlationId,
  payload_json AS payloadJson,occurred_at AS occurredAt,created_at AS createdAt`;
const suffixPattern = /^\*{4}[A-Za-z0-9]{4}$/;
const positiveVersion = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid`);
  return value;
};

const parsePermissions = (value: string): ConnectionPermissions => {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("stored permissions are invalid");
  const candidate = parsed as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(",") !== "futuresTrade,read,spotTrade,withdrawal"
    || candidate.read !== true || typeof candidate.spotTrade !== "boolean"
    || typeof candidate.futuresTrade !== "boolean" || candidate.withdrawal !== false) {
    throw new Error("stored permissions are invalid");
  }
  return candidate as unknown as ConnectionPermissions;
};
const safe = (row: ConnectionRecord): SafeConnectionSummary => ({
  provider: "WEEX", maskedApiKeySuffix: row.maskedApiKeySuffix,
  permissions: parsePermissions(row.permissionsJson), verifiedAt: row.verifiedAt, status: row.status,
  hasLocalCredential: Boolean(row.hasLocalCredential),
});
const safeDevice = (row: ConnectionListRow): SafeConnectionDevice => {
  if (row.devicePlatform !== "macos" && row.devicePlatform !== "windows") throw new Error("stored device platform is invalid");
  if (row.deviceStatus !== "active") throw new Error("stored device status is invalid");
  const lastSeenAt = row.lastSeenAt === null ? null : time(row.lastSeenAt, "lastSeenAt");
  let connection: SafeConnectionSummary | null = null;
  if (row.provider !== null) {
    if (row.provider !== "WEEX" || row.permissionsJson === null || row.status === null || row.hasLocalCredential === null) {
      throw new Error("stored connection summary is invalid");
    }
    connection = { provider: "WEEX", maskedApiKeySuffix: row.maskedApiKeySuffix,
      permissions: parsePermissions(row.permissionsJson), verifiedAt: row.verifiedAt, status: row.status,
      hasLocalCredential: Boolean(row.hasLocalCredential) };
  }
  const commandTarget = row.commandDeploymentId === null && row.commandDeploymentVersion === null ? null
    : row.commandDeploymentId !== null && row.commandDeploymentVersion !== null
      ? { deploymentId: id(row.commandDeploymentId, "deploymentId"),
        expectedVersion: positiveVersion(row.commandDeploymentVersion, "deployment version") }
      : (() => { throw new Error("stored command target is invalid"); })();
  return { id: id(row.deviceId, "deviceId"), name: displayName(row.deviceName, "device name"),
    platform: row.devicePlatform, deviceStatus: "active", lastSeenAt, connection, commandTarget };
};

interface ConnectionEventInput {
  id: string; deviceId: string; deploymentId: string; expectedDeploymentVersion: number;
  type: "connection-verified" | "key-erased"; correlationId: string; payload: JsonObject;
  occurredAt: number; now: number; connectionVersion: number;
  verified?: { maskedApiKeySuffix: string; permissions: ConnectionPermissions };
}

export function createConnectionRepository(database: ControlPlaneDatabase) {
  const getRecord = (deviceId: string): Promise<ConnectionRecord | null> => database.prepare(
    `SELECT ${columns} FROM device_connections WHERE device_id=?`,
  ).bind(id(deviceId, "deviceId")).first<ConnectionRecord>();
  const getAudit = (eventId: string): Promise<AuditEventRecord | null> => database.prepare(
    `SELECT ${auditColumns} FROM audit_events WHERE id=?`,
  ).bind(id(eventId,"eventId")).first<AuditEventRecord>();

  return {
    async listForUser(userId: string, options: { limit: number; cursor?: string }): Promise<{
      items: SafeConnectionDevice[]; nextCursor: string | null;
    }> {
      exactInput(options, ["limit", "cursor"]);
      const owner = id(userId, "userId"); const pageSize = limit(options.limit);
      const cursor = options.cursor === undefined ? null : id(options.cursor, "cursor");
      const rows = await database.prepare(`SELECT d.id AS deviceId,d.name AS deviceName,d.platform AS devicePlatform,
        d.status AS deviceStatus,d.last_seen_at AS lastSeenAt,c.provider,
        c.masked_api_key_suffix AS maskedApiKeySuffix,c.permissions_json AS permissionsJson,
        c.verified_at AS verifiedAt,c.status,c.has_local_credential AS hasLocalCredential,
        target.id AS commandDeploymentId,target.version AS commandDeploymentVersion
        FROM devices d LEFT JOIN device_connections c ON c.device_id=d.id AND c.user_id=d.user_id
        LEFT JOIN deployments target ON target.id=(SELECT candidate.id FROM deployments candidate
          WHERE candidate.user_id=d.user_id AND candidate.device_id=d.id
          ORDER BY candidate.updated_at DESC,candidate.id DESC LIMIT 1)
        WHERE d.user_id=? AND d.status='active' AND (? IS NULL OR d.id>?) ORDER BY d.id ASC LIMIT ?`)
        .bind(owner, cursor, cursor, pageSize + 1).all<ConnectionListRow>();
      if (!rows.success) throw new Error("connection list failed");
      const selected = rows.results.slice(0, pageSize);
      return { items: selected.map(safeDevice),
        nextCursor: rows.results.length > pageSize ? selected.at(-1)!.deviceId : null };
    },

    async applyDeviceEvent(input: ConnectionEventInput): Promise<{ event: AuditEventRecord; connection: SafeConnectionSummary; idempotent: boolean }> {
      exactInput(input, ["id", "deviceId", "deploymentId", "expectedDeploymentVersion", "type", "correlationId",
        "payload", "occurredAt", "now", "connectionVersion", "verified"]);
      const eventId=id(input.id,"eventId"), deviceId=id(input.deviceId,"deviceId"), deploymentId=id(input.deploymentId,"deploymentId");
      const expectedVersion=positiveVersion(input.expectedDeploymentVersion,"expectedDeploymentVersion"), connectionVersion=positiveVersion(input.connectionVersion,"connectionVersion");
      const occurredAt=time(input.occurredAt,"occurredAt"), now=time(input.now,"now");
      const correlationId=id(input.correlationId,"correlationId");
      const payloadJson=safeCanonicalJsonStringify({version:1,expectedDeploymentVersion:expectedVersion,payload:input.payload},"device event ledger",65_536);
      let masked: string | null=null; let permissionsJson=safeCanonicalJsonStringify({read:true,spotTrade:false,futuresTrade:false,withdrawal:false},"permissions",256);
      let verifiedAt: number | null=null; let status: ConnectionStatus="erased"; let local=0;
      if (input.type === "connection-verified") {
        if (!input.verified || !suffixPattern.test(input.verified.maskedApiKeySuffix)) throw new Error("connection summary is invalid");
        permissionsJson=safeCanonicalJsonStringify(input.verified.permissions,"permissions",256);
        parsePermissions(permissionsJson);
        masked=input.verified.maskedApiKeySuffix; verifiedAt=occurredAt; status="verified"; local=1;
      } else if (input.verified !== undefined) throw new Error("erased event cannot contain a verified summary");

      const insertAudit=database.prepare(`INSERT INTO audit_events
        (id,user_id,actor_type,actor_id,device_id,deployment_id,strategy_version_id,type,correlation_id,payload_json,occurred_at,created_at)
        SELECT ?,v.user_id,'device',v.id,v.id,d.id,NULL,?,?,?,?,? FROM devices v
        JOIN deployments d ON d.id=? AND d.user_id=v.user_id AND d.device_id=v.id
        WHERE v.id=? AND v.status='active' AND d.version=?
          AND NOT EXISTS (SELECT 1 FROM device_connections c WHERE c.device_id=v.id AND c.version>=?)`)
        .bind(eventId,input.type,correlationId,payloadJson,occurredAt,now,deploymentId,deviceId,expectedVersion,connectionVersion);
      const updateSummary=database.prepare(`INSERT INTO device_connections
        (device_id,user_id,provider,masked_api_key_suffix,permissions_json,verified_at,status,has_local_credential,withdrawal_access_absent,version,updated_at)
        SELECT v.id,v.user_id,'WEEX',?,?,?,?,?,1,?,? FROM devices v JOIN audit_events a ON a.id=?
        WHERE v.id=? AND a.actor_type='device' AND a.actor_id=v.id AND a.device_id=v.id AND a.deployment_id=?
          AND a.type=? AND a.correlation_id=? AND a.payload_json=? AND a.occurred_at=?
        ON CONFLICT(device_id) DO UPDATE SET provider='WEEX',masked_api_key_suffix=excluded.masked_api_key_suffix,
          permissions_json=excluded.permissions_json,verified_at=excluded.verified_at,status=excluded.status,
          has_local_credential=excluded.has_local_credential,withdrawal_access_absent=1,
          version=excluded.version,updated_at=excluded.updated_at WHERE excluded.version>device_connections.version`)
        .bind(masked,permissionsJson,verifiedAt,status,local,connectionVersion,now,eventId,deviceId,deploymentId,
          input.type,correlationId,payloadJson,occurredAt);
      let results: ControlPlaneRunResult[];
      try { results=await database.batch([insertAudit,updateSummary]); }
      catch(error) {
        const winner=await getAudit(eventId); const connection=await getRecord(deviceId);
        const exactRetry=winner?.actorType==="device"&&winner.actorId===deviceId&&winner.deviceId===deviceId
          &&winner.deploymentId===deploymentId&&winner.type===input.type&&winner.correlationId===correlationId
          &&winner.payloadJson===payloadJson&&winner.occurredAt===occurredAt;
        if(exactRetry&&connection)return {event:winner,connection:safe(connection),idempotent:true};
        throw error;
      }
      if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) throw new Error("connection event conflict");
      const event=await getAudit(eventId);
      const connection=await getRecord(deviceId);
      if (!event || event.actorType!=="device" || event.actorId!==deviceId || !connection) throw new Error("connection event persistence failed");
      return {event,connection:safe(connection),idempotent:false};
    },
  };
}
