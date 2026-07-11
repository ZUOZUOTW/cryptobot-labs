import { parseHeartbeatDto, safeCanonicalJsonStringify } from "../../lib/control-plane/schemas";
import type { HeartbeatDto, HeartbeatPositionDto, JsonObject } from "../../lib/control-plane/types";
import type { ControlPlaneDatabase } from "../index";
import { exactInput, id, limit, time } from "./shared";

export interface HeartbeatRecord {
  id: string; userId: string; deploymentId: string; deviceId: string; sequence: number;
  mode: "paper" | "futures-demo" | "live"; state: "running" | "paused" | "stopped" | "error";
  health: "healthy" | "degraded" | "paused"; summaryJson: string; occurredAt: number;
}
export interface AuditEventRecord {
  id: string; userId: string | null; actorType: "user" | "device"; actorId: string;
  deviceId: string | null; deploymentId: string | null; strategyVersionId: string | null;
  type: string; correlationId: string; payloadJson: string; occurredAt: number; createdAt: number;
}

const heartbeatColumns = `id,user_id AS userId,deployment_id AS deploymentId,device_id AS deviceId,
  sequence,mode,state,health,summary_json AS summaryJson,occurred_at AS occurredAt`;
const auditColumns = `id,user_id AS userId,actor_type AS actorType,actor_id AS actorId,device_id AS deviceId,
  deployment_id AS deploymentId,strategy_version_id AS strategyVersionId,type,correlation_id AS correlationId,
  payload_json AS payloadJson,occurred_at AS occurredAt,created_at AS createdAt`;
const POSITIVE_DECIMAL = /^(?=.*[1-9])(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._:-]{1,63}$/;

const boundedText = (value: string, label: string, maximum: number): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
};
const positiveDecimal = (value: string, label: string): string => {
  if (typeof value !== "string" || value.length > 128 || !POSITIVE_DECIMAL.test(value)) {
    throw new Error(`${label} must be a positive decimal string`);
  }
  return value;
};
const version = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("expectedDeploymentVersion is invalid");
  return value;
};

interface AuditInput {
  id: string; type: string; correlationId: string; payload: JsonObject; occurredAt: number; now: number;
  deploymentId?: string; strategyVersionId?: string;
}

export function createActivityRepository(database: ControlPlaneDatabase) {
  const getHeartbeat = (deviceId: string, deploymentId: string, sequence: number): Promise<HeartbeatRecord | null> => database.prepare(`
    SELECT ${heartbeatColumns} FROM run_heartbeats WHERE device_id=? AND deployment_id=? AND sequence=?
  `).bind(deviceId, deploymentId, sequence).first<HeartbeatRecord>();
  const getAuditForUser = (userId: string, auditId: string): Promise<AuditEventRecord | null> => database.prepare(`
    SELECT ${auditColumns} FROM audit_events WHERE user_id=? AND id=?
  `).bind(id(userId, "userId"), id(auditId, "auditEventId")).first<AuditEventRecord>();

  const normalizeAudit = (input: AuditInput) => ({
    eventId: id(input.id, "auditEventId"),
    type: boundedText(input.type, "audit type", 128),
    correlationId: id(input.correlationId, "correlationId"),
    payloadJson: safeCanonicalJsonStringify(input.payload, "audit payload", 65_536),
    occurredAt: time(input.occurredAt, "occurredAt"),
    createdAt: time(input.now, "now"),
    deploymentId: input.deploymentId === undefined ? null : id(input.deploymentId, "deploymentId"),
    strategyVersionId: input.strategyVersionId === undefined ? null : id(input.strategyVersionId, "strategyVersionId"),
  });

  return {
    async ingestHeartbeat(input: { id: string; deviceId: string; expectedDeploymentVersion: number;
      positionIds: string[]; heartbeat: HeartbeatDto }): Promise<{ heartbeat: HeartbeatRecord; idempotent: boolean }> {
      exactInput(input, ["id", "deviceId", "expectedDeploymentVersion", "positionIds", "heartbeat"]);
      const heartbeat = parseHeartbeatDto(input.heartbeat);
      if (!Array.isArray(input.positionIds) || input.positionIds.length !== heartbeat.positions.length) {
        throw new Error("positionIds must exactly match positions");
      }
      const positionIds = input.positionIds.map((value) => id(value, "positionId"));
      if (new Set(positionIds).size !== positionIds.length) throw new Error("positionIds must be unique");
      const deviceId = id(input.deviceId, "deviceId");
      const heartbeatId = id(input.id, "heartbeatId");
      const expectedVersion = version(input.expectedDeploymentVersion);
      const deploymentId = id(heartbeat.deploymentId, "deploymentId");
      const telemetryJson = safeCanonicalJsonStringify({
        health: heartbeat.health, mode: heartbeat.mode, positions: heartbeat.positions, state: heartbeat.state,
      }, "heartbeat telemetry", 65_536);
      const assignment = await database.prepare(`SELECT d.user_id AS userId FROM deployments d
        JOIN devices v ON v.id=d.device_id AND v.user_id=d.user_id
        WHERE d.id=? AND d.device_id=? AND d.version=? AND d.mode=? AND d.state=? AND v.status='active'`)
        .bind(deploymentId, deviceId, expectedVersion, heartbeat.mode, heartbeat.state).first<{ userId: string }>();
      if (!assignment) throw new Error("assigned deployment version, mode, or state fence failed");
      const existing = await getHeartbeat(deviceId, deploymentId, heartbeat.sequence);
      if (existing) {
        const same = existing.mode === heartbeat.mode && existing.state === heartbeat.state && existing.health === heartbeat.health
          && existing.summaryJson === telemetryJson && existing.occurredAt === heartbeat.occurredAt;
        if (!same) throw new Error("heartbeat sequence conflict");
        return { heartbeat: existing, idempotent: true };
      }
      const normalizedPositions = heartbeat.positions.map((position: HeartbeatPositionDto) => ({
        symbol: (() => {
          const symbol = boundedText(position.symbol, "position symbol", 64);
          if (!SYMBOL.test(symbol)) throw new Error("position symbol is invalid");
          return symbol;
        })(),
        side: position.side,
        quantity: positiveDecimal(position.quantity, "position quantity"),
        entryPrice: positiveDecimal(position.entryPrice, "position entryPrice"),
        markPrice: positiveDecimal(position.markPrice, "position markPrice"),
        unrealizedPnl: position.unrealizedPnl,
        leverage: positiveDecimal(position.leverage, "position leverage"),
      }));
      const statements = [
        database.prepare(`INSERT INTO run_heartbeats
          (id,user_id,deployment_id,device_id,sequence,mode,state,health,summary_json,occurred_at)
          SELECT ?,d.user_id,d.id,d.device_id,?,?,?,?,?,? FROM deployments d
          JOIN devices v ON v.id=d.device_id AND v.user_id=d.user_id
          WHERE d.id=? AND d.device_id=? AND d.version=? AND d.mode=? AND d.state=? AND v.status='active'`)
          .bind(heartbeatId, heartbeat.sequence, heartbeat.mode, heartbeat.state, heartbeat.health, telemetryJson,
            heartbeat.occurredAt, deploymentId, deviceId, expectedVersion, heartbeat.mode, heartbeat.state),
        database.prepare(`DELETE FROM position_snapshots WHERE deployment_id=?
          AND EXISTS (SELECT 1 FROM run_heartbeats WHERE id=? AND device_id=?)`).bind(deploymentId, heartbeatId, deviceId),
        ...normalizedPositions.map((position, index) => database.prepare(`INSERT INTO position_snapshots
          (id,user_id,deployment_id,heartbeat_id,market,symbol,side,quantity,entry_price,mark_price,unrealized_pnl,leverage,captured_at)
          SELECT ?,h.user_id,h.deployment_id,h.id,s.market,?,?,?,?,?,?,?,? FROM run_heartbeats h
          JOIN deployments d ON d.id=h.deployment_id AND d.user_id=h.user_id
          JOIN strategy_versions sv ON sv.id=d.strategy_version_id AND sv.user_id=d.user_id
          JOIN strategies s ON s.id=sv.strategy_id AND s.user_id=sv.user_id
          WHERE h.id=? AND h.device_id=?`)
          .bind(positionIds[index], position.symbol, position.side, position.quantity, position.entryPrice,
            position.markPrice, position.unrealizedPnl, position.leverage, heartbeat.occurredAt, heartbeatId, deviceId)),
      ];
      try {
        const results = await database.batch(statements);
        if (results[0]?.meta.changes !== 1 || normalizedPositions.some((_, index) => results[index + 2]?.meta.changes !== 1)) {
          throw new Error("atomic heartbeat replacement failed");
        }
      } catch (error) {
        const raced = await getHeartbeat(deviceId, deploymentId, heartbeat.sequence);
        if (raced && raced.summaryJson === telemetryJson && raced.occurredAt === heartbeat.occurredAt) {
          return { heartbeat: raced, idempotent: true };
        }
        if (raced) throw new Error("heartbeat sequence conflict");
        throw error;
      }
      const stored = await getHeartbeat(deviceId, deploymentId, heartbeat.sequence);
      if (!stored) throw new Error("atomic heartbeat replacement failed");
      return { heartbeat: stored, idempotent: false };
    },

    async appendUserAudit(input: AuditInput & { userId: string; deviceId?: string }): Promise<AuditEventRecord> {
      exactInput(input, ["id", "userId", "deviceId", "deploymentId", "strategyVersionId", "type", "correlationId", "payload", "occurredAt", "now"]);
      const owner = id(input.userId, "userId");
      const deviceId = input.deviceId === undefined ? null : id(input.deviceId, "deviceId");
      const value = normalizeAudit(input);
      const row = await database.prepare(`INSERT INTO audit_events
        (id,user_id,actor_type,actor_id,device_id,deployment_id,strategy_version_id,type,correlation_id,payload_json,occurred_at,created_at)
        SELECT ?,u.id,'user',u.id,?,?,?,?,?,?,?,? FROM users u WHERE u.id=?
          AND (? IS NULL OR EXISTS (SELECT 1 FROM devices WHERE id=? AND user_id=u.id))
          AND (? IS NULL OR EXISTS (SELECT 1 FROM deployments WHERE id=? AND user_id=u.id))
          AND (? IS NULL OR EXISTS (SELECT 1 FROM strategy_versions WHERE id=? AND user_id=u.id))
          AND (? IS NULL OR ? IS NULL OR EXISTS (SELECT 1 FROM deployments WHERE id=? AND user_id=u.id AND device_id=?))
          AND (? IS NULL OR ? IS NULL OR EXISTS (SELECT 1 FROM deployments WHERE id=? AND user_id=u.id AND strategy_version_id=?))
        RETURNING ${auditColumns}`)
        .bind(value.eventId, deviceId, value.deploymentId, value.strategyVersionId, value.type, value.correlationId,
          value.payloadJson, value.occurredAt, value.createdAt, owner, deviceId, deviceId,
          value.deploymentId, value.deploymentId, value.strategyVersionId, value.strategyVersionId,
          value.deploymentId, deviceId, value.deploymentId, deviceId,
          value.deploymentId, value.strategyVersionId, value.deploymentId, value.strategyVersionId).first<AuditEventRecord>();
      if (!row) throw new Error("owned audit actor or target not found");
      return row;
    },

    async appendDeviceAudit(input: AuditInput & { deviceId: string }): Promise<AuditEventRecord> {
      exactInput(input, ["id", "deviceId", "deploymentId", "strategyVersionId", "type", "correlationId", "payload", "occurredAt", "now"]);
      const deviceId = id(input.deviceId, "deviceId");
      const value = normalizeAudit(input);
      const row = await database.prepare(`INSERT INTO audit_events
        (id,user_id,actor_type,actor_id,device_id,deployment_id,strategy_version_id,type,correlation_id,payload_json,occurred_at,created_at)
        SELECT ?,v.user_id,'device',v.id,v.id,?,?,?,?,?,?,? FROM devices v WHERE v.id=? AND v.status='active'
          AND (? IS NULL OR EXISTS (SELECT 1 FROM deployments WHERE id=? AND user_id=v.user_id AND device_id=v.id))
          AND (? IS NULL OR EXISTS (SELECT 1 FROM strategy_versions WHERE id=? AND user_id=v.user_id))
          AND (? IS NULL OR ? IS NULL OR EXISTS (SELECT 1 FROM deployments WHERE id=? AND user_id=v.user_id
            AND device_id=v.id AND strategy_version_id=?))
        RETURNING ${auditColumns}`)
        .bind(value.eventId, value.deploymentId, value.strategyVersionId, value.type, value.correlationId,
          value.payloadJson, value.occurredAt, value.createdAt, deviceId, value.deploymentId, value.deploymentId,
          value.strategyVersionId, value.strategyVersionId, value.deploymentId, value.strategyVersionId,
          value.deploymentId, value.strategyVersionId).first<AuditEventRecord>();
      if (!row) throw new Error("owned assigned device audit actor or target not found");
      return row;
    },

    getAuditForUser,
    async listAuditForUser(userId: string, options: { limit: number; cursor?: { occurredAt: number; id: string } }): Promise<{ items: AuditEventRecord[]; nextCursor: { occurredAt: number; id: string } | null }> {
      exactInput(options, ["limit", "cursor"]);
      const pageSize = limit(options.limit);
      if (options.cursor) exactInput(options.cursor, ["occurredAt", "id"]);
      const cursorTime = options.cursor ? time(options.cursor.occurredAt, "cursor.occurredAt") : null;
      const cursorId = options.cursor ? id(options.cursor.id, "cursor.id") : null;
      const rows = await database.prepare(`SELECT ${auditColumns} FROM audit_events WHERE user_id=?
        AND (? IS NULL OR occurred_at<? OR (occurred_at=? AND id<?)) ORDER BY occurred_at DESC,id DESC LIMIT ?`)
        .bind(id(userId, "userId"), cursorTime, cursorTime, cursorTime, cursorId, pageSize + 1).all<AuditEventRecord>();
      if (!rows.success) throw new Error("audit list failed");
      const items = rows.results.slice(0, pageSize);
      const last = items.at(-1);
      return { items, nextCursor: rows.results.length > pageSize && last ? { occurredAt: last.occurredAt, id: last.id } : null };
    },
  };
}
