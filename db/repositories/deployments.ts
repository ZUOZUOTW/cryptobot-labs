import { parseCommandCreateDto, safeCanonicalJsonStringify } from "../../lib/control-plane/schemas";
import { COMMAND_TYPES, RUN_MODES, type CommandType, type JsonObject, type RunMode } from "../../lib/control-plane/types";
import type { ControlPlaneDatabase, ControlPlaneRunResult } from "../index";
import { exactInput, expiry, hash, id, limit, time } from "./shared";

export type DeploymentState = "stopped" | "running" | "paused" | "error";
export type RiskOperationMode = "approval-required" | "automatic";

export interface DeploymentRecord {
  id: string; userId: string; deviceId: string; strategyVersionId: string; name: string;
  mode: RunMode; state: DeploymentState; version: number; configurationHash: string;
  createdAt: number; updatedAt: number; startedAt: number | null; stoppedAt: number | null;
}

export interface RiskPolicyInput {
  id: string; allowedSymbols: string[]; maxOrderNotional: string; maxPositionNotional: string;
  maxTotalExposure: string; maxSimultaneousPositions: number; maxDailyLoss: string; maxLeverage: string;
  maxSlippageBps: number; minSignalCooldownMs: number; maxConsecutiveFailures: number;
  operationMode: RiskOperationMode;
}

export interface RiskPolicyRecord {
  id: string; userId: string; deploymentId: string; allowedSymbolsJson: string;
  maxOrderNotional: string; maxPositionNotional: string; maxTotalExposure: string;
  maxSimultaneousPositions: number; maxDailyLoss: string; maxLeverage: string; maxSlippageBps: number;
  minSignalCooldownMs: number; maxConsecutiveFailures: number; operationMode: RiskOperationMode;
  createdAt: number; updatedAt: number;
}

export interface CommandRecord {
  id: string; userId: string; deploymentId: string; deviceId: string; type: CommandType; version: number;
  correlationId: string; expectedDeploymentVersion: number; payloadJson: string;
  status: "pending" | "acknowledged"; createdAt: number; expiresAt: number;
}

export interface CommandAcknowledgementRecord {
  id: string; commandId: string; userId: string; deviceId: string;
  status: "ok" | "rejected" | "failed"; payloadJson: string; acknowledgedAt: number;
}

const deploymentColumns = `id, user_id AS userId, device_id AS deviceId, strategy_version_id AS strategyVersionId,
  name, mode, state, version, configuration_hash AS configurationHash, created_at AS createdAt,
  updated_at AS updatedAt, started_at AS startedAt, stopped_at AS stoppedAt`;
const riskColumns = `id, user_id AS userId, deployment_id AS deploymentId, allowed_symbols_json AS allowedSymbolsJson,
  max_order_notional AS maxOrderNotional, max_position_notional AS maxPositionNotional,
  max_total_exposure AS maxTotalExposure, max_simultaneous_positions AS maxSimultaneousPositions,
  max_daily_loss AS maxDailyLoss, max_leverage AS maxLeverage, max_slippage_bps AS maxSlippageBps,
  min_signal_cooldown_ms AS minSignalCooldownMs, max_consecutive_failures AS maxConsecutiveFailures,
  operation_mode AS operationMode, created_at AS createdAt, updated_at AS updatedAt`;
const commandColumns = `id, user_id AS userId, deployment_id AS deploymentId, device_id AS deviceId,
  type, version, correlation_id AS correlationId, expected_deployment_version AS expectedDeploymentVersion,
  payload_json AS payloadJson, status, created_at AS createdAt, expires_at AS expiresAt`;
const ackColumns = `a.id, a.command_id AS commandId, a.user_id AS userId, a.device_id AS deviceId,
  a.status, a.payload_json AS payloadJson, a.acknowledged_at AS acknowledgedAt`;

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._:-]{1,63}$/;
const TRANSITIONS: Readonly<Record<DeploymentState, readonly DeploymentState[]>> = {
  stopped: ["running"],
  running: ["paused", "stopped", "error"],
  paused: ["running", "stopped", "error"],
  error: ["stopped"],
};

const text = (value: string, label: string, maximum: number): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
};
const decimal = (value: string, label: string): string => {
  if (typeof value !== "string" || value.length > 128 || !DECIMAL.test(value)) throw new Error(`${label} must be a decimal string`);
  return value;
};
const integer = (value: number, label: string, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} is invalid`);
  return value;
};
const positiveVersion = (value: number, label = "expectedVersion"): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`);
  return value;
};
const mode = (value: string): RunMode => {
  if (!RUN_MODES.includes(value as RunMode)) throw new Error("mode is invalid");
  return value as RunMode;
};
const state = (value: string): DeploymentState => {
  if (value !== "stopped" && value !== "running" && value !== "paused" && value !== "error") throw new Error("state is invalid");
  return value;
};

const normalizeRisk = (input: RiskPolicyInput) => {
  exactInput(input, ["id", "allowedSymbols", "maxOrderNotional", "maxPositionNotional", "maxTotalExposure",
    "maxSimultaneousPositions", "maxDailyLoss", "maxLeverage", "maxSlippageBps", "minSignalCooldownMs",
    "maxConsecutiveFailures", "operationMode"]);
  if (!Array.isArray(input.allowedSymbols) || input.allowedSymbols.length < 1 || input.allowedSymbols.length > 100
    || input.allowedSymbols.some((symbol) => typeof symbol !== "string" || !SYMBOL.test(symbol))
    || new Set(input.allowedSymbols).size !== input.allowedSymbols.length) {
    throw new Error("allowedSymbols must contain 1 to 100 unique canonical symbols");
  }
  if (input.operationMode !== "approval-required" && input.operationMode !== "automatic") throw new Error("operationMode is invalid");
  return {
    id: id(input.id, "riskPolicyId"),
    allowedSymbolsJson: safeCanonicalJsonStringify(input.allowedSymbols, "allowed symbols", 8_192),
    maxOrderNotional: decimal(input.maxOrderNotional, "maxOrderNotional"),
    maxPositionNotional: decimal(input.maxPositionNotional, "maxPositionNotional"),
    maxTotalExposure: decimal(input.maxTotalExposure, "maxTotalExposure"),
    maxSimultaneousPositions: integer(input.maxSimultaneousPositions, "maxSimultaneousPositions", 1_000),
    maxDailyLoss: decimal(input.maxDailyLoss, "maxDailyLoss"),
    maxLeverage: decimal(input.maxLeverage, "maxLeverage"),
    maxSlippageBps: integer(input.maxSlippageBps, "maxSlippageBps", 10_000),
    minSignalCooldownMs: integer(input.minSignalCooldownMs, "minSignalCooldownMs", 86_400_000),
    maxConsecutiveFailures: integer(input.maxConsecutiveFailures, "maxConsecutiveFailures", 1_000),
    operationMode: input.operationMode,
  };
};

export function createDeploymentRepository(database: ControlPlaneDatabase) {
  const getForUser = (userId: string, deploymentId: string): Promise<DeploymentRecord | null> => database.prepare(`
    SELECT ${deploymentColumns} FROM deployments WHERE user_id = ? AND id = ?
  `).bind(id(userId, "userId"), id(deploymentId, "deploymentId")).first<DeploymentRecord>();
  const getRiskForUser = (userId: string, deploymentId: string): Promise<RiskPolicyRecord | null> => database.prepare(`
    SELECT ${riskColumns} FROM risk_policies WHERE user_id = ? AND deployment_id = ?
  `).bind(id(userId, "userId"), id(deploymentId, "deploymentId")).first<RiskPolicyRecord>();

  return {
    async create(input: { id: string; userId: string; deviceId: string; strategyVersionId: string; name: string;
      mode: string; configurationHash: string; risk: RiskPolicyInput; now: number }): Promise<{ deployment: DeploymentRecord; risk: RiskPolicyRecord }> {
      exactInput(input, ["id", "userId", "deviceId", "strategyVersionId", "name", "mode", "configurationHash", "risk", "now"]);
      if (input.mode !== "paper") throw new Error("new deployments must start in paper mode");
      const owner = id(input.userId, "userId");
      const deploymentId = id(input.id, "deploymentId");
      const deviceId = id(input.deviceId, "deviceId");
      const strategyVersionId = id(input.strategyVersionId, "strategyVersionId");
      const dependency = await database.prepare(`
        SELECT d.id FROM devices d JOIN strategy_versions s ON s.user_id = d.user_id
        WHERE d.user_id = ? AND d.id = ? AND d.status = 'active' AND s.id = ?
      `).bind(owner, deviceId, strategyVersionId).first<{ id: string }>();
      if (!dependency) throw new Error("owned active device and strategy version are required");
      const normalizedRisk = normalizeRisk(input.risk);
      const now = time(input.now, "now");
      await database.batch([
        database.prepare(`INSERT INTO deployments
          (id,user_id,device_id,strategy_version_id,name,mode,state,version,configuration_hash,created_at,updated_at)
          SELECT ?,d.user_id,d.id,s.id,?,?,'stopped',1,?,?,? FROM devices d
          JOIN strategy_versions s ON s.user_id=d.user_id
          WHERE d.user_id=? AND d.id=? AND d.status='active' AND s.id=?`)
          .bind(deploymentId, text(input.name, "deployment name", 100), mode(input.mode),
            hash(input.configurationHash), now, now, owner, deviceId, strategyVersionId),
        database.prepare(`INSERT INTO risk_policies
          (id,user_id,deployment_id,allowed_symbols_json,max_order_notional,max_position_notional,max_total_exposure,
           max_simultaneous_positions,max_daily_loss,max_leverage,max_slippage_bps,min_signal_cooldown_ms,
           max_consecutive_failures,operation_mode,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(normalizedRisk.id, owner, deploymentId, normalizedRisk.allowedSymbolsJson, normalizedRisk.maxOrderNotional,
            normalizedRisk.maxPositionNotional, normalizedRisk.maxTotalExposure, normalizedRisk.maxSimultaneousPositions,
            normalizedRisk.maxDailyLoss, normalizedRisk.maxLeverage, normalizedRisk.maxSlippageBps,
            normalizedRisk.minSignalCooldownMs, normalizedRisk.maxConsecutiveFailures, normalizedRisk.operationMode, now, now),
      ]);
      const deployment = await getForUser(owner, deploymentId);
      const risk = await getRiskForUser(owner, deploymentId);
      if (!deployment || !risk) throw new Error("atomic deployment creation failed");
      return { deployment, risk };
    },
    getForUser,
    getRiskForUser,
    getForDevice(deviceId: string, deploymentId: string): Promise<DeploymentRecord | null> {
      return database.prepare(`SELECT ${deploymentColumns} FROM deployments
        WHERE device_id = ? AND id = ?
          AND EXISTS (SELECT 1 FROM devices WHERE id=deployments.device_id AND status='active')`)
        .bind(id(deviceId, "deviceId"), id(deploymentId, "deploymentId")).first<DeploymentRecord>();
    },
    async listForUser(userId: string, options: { limit: number; cursor?: { createdAt: number; id: string } }): Promise<{ items: DeploymentRecord[]; nextCursor: { createdAt: number; id: string } | null }> {
      exactInput(options, ["limit", "cursor"]);
      const pageSize = limit(options.limit);
      if (options.cursor) exactInput(options.cursor, ["createdAt", "id"]);
      const cursorTime = options.cursor ? time(options.cursor.createdAt, "cursor.createdAt") : null;
      const cursorId = options.cursor ? id(options.cursor.id, "cursor.id") : null;
      const rows = await database.prepare(`SELECT ${deploymentColumns} FROM deployments
        WHERE user_id = ? AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC LIMIT ?`)
        .bind(id(userId, "userId"), cursorTime, cursorTime, cursorTime, cursorId, pageSize + 1).all<DeploymentRecord>();
      if (!rows.success) throw new Error("deployment list failed");
      const items = rows.results.slice(0, pageSize);
      const last = items.at(-1);
      return { items, nextCursor: rows.results.length > pageSize && last ? { createdAt: last.createdAt, id: last.id } : null };
    },
    async transitionState(userId: string, deploymentId: string, expectedVersion: number, expectedState: DeploymentState,
      nextState: DeploymentState, nowValue: number): Promise<DeploymentRecord | null> {
      const current = state(expectedState);
      const next = state(nextState);
      if (!TRANSITIONS[current].includes(next)) throw new Error(`invalid deployment transition: ${current} -> ${next}`);
      const now = time(nowValue, "now");
      return database.prepare(`UPDATE deployments SET state = ?, version = version + 1, updated_at = ?,
        started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
        stopped_at = CASE WHEN ? = 'stopped' THEN ? ELSE stopped_at END
        WHERE user_id = ? AND id = ? AND version = ? AND state = ? RETURNING ${deploymentColumns}`)
        .bind(next, now, next, now, next, now, id(userId, "userId"), id(deploymentId, "deploymentId"),
          positiveVersion(expectedVersion), current).first<DeploymentRecord>();
    },
    async updateRisk(userId: string, deploymentId: string, expectedVersion: number, input: RiskPolicyInput,
      nowValue: number): Promise<{ deployment: DeploymentRecord; risk: RiskPolicyRecord } | null> {
      const owner = id(userId, "userId");
      const target = id(deploymentId, "deploymentId");
      const expected = positiveVersion(expectedVersion);
      const normalized = normalizeRisk(input);
      const now = time(nowValue, "now");
      const results = await database.batch([
        database.prepare(`UPDATE risk_policies SET allowed_symbols_json=?,max_order_notional=?,max_position_notional=?,
          max_total_exposure=?,max_simultaneous_positions=?,max_daily_loss=?,max_leverage=?,max_slippage_bps=?,
          min_signal_cooldown_ms=?,max_consecutive_failures=?,operation_mode=?,updated_at=?
          WHERE user_id=? AND deployment_id=? AND id=?
            AND EXISTS (SELECT 1 FROM deployments WHERE user_id=? AND id=? AND version=?)`)
          .bind(normalized.allowedSymbolsJson, normalized.maxOrderNotional, normalized.maxPositionNotional,
            normalized.maxTotalExposure, normalized.maxSimultaneousPositions, normalized.maxDailyLoss,
            normalized.maxLeverage, normalized.maxSlippageBps, normalized.minSignalCooldownMs,
            normalized.maxConsecutiveFailures, normalized.operationMode, now, owner, target, normalized.id,
            owner, target, expected),
        database.prepare(`UPDATE deployments SET version = version + 1, updated_at = ?
          WHERE user_id = ? AND id = ? AND version = ?
            AND EXISTS (SELECT 1 FROM risk_policies WHERE user_id=? AND deployment_id=? AND id=?)`)
          .bind(now, owner, target, expected, owner, target, normalized.id),
      ]);
      if (!results.every((result) => result.success && result.meta.changes === 1)) return null;
      const deployment = await getForUser(owner, target);
      const risk = await getRiskForUser(owner, target);
      return deployment && risk ? { deployment, risk } : null;
    },
  };
}

const sameCommand = (row: CommandRecord, input: { deploymentId: string; type: CommandType; version: number;
  correlationId: string; expectedDeploymentVersion: number; payloadJson: string }): boolean =>
  row.deploymentId === input.deploymentId && row.type === input.type && row.version === input.version
  && row.correlationId === input.correlationId && row.expectedDeploymentVersion === input.expectedDeploymentVersion
  && row.payloadJson === input.payloadJson;

export function createCommandRepository(database: ControlPlaneDatabase) {
  const getByCorrelation = (userId: string, correlationId: string): Promise<CommandRecord | null> => database.prepare(`
    SELECT ${commandColumns} FROM commands WHERE user_id = ? AND correlation_id = ?
  `).bind(id(userId, "userId"), id(correlationId, "correlationId")).first<CommandRecord>();
  type ScopedAck = CommandAcknowledgementRecord & { deploymentId: string; expectedDeploymentVersion: number };
  const getAck = (commandId: string, deviceId: string): Promise<ScopedAck | null> => database.prepare(`
    SELECT ${ackColumns}, c.deployment_id AS deploymentId,
      c.expected_deployment_version AS expectedDeploymentVersion
    FROM command_acknowledgements a JOIN commands c ON c.id=a.command_id AND c.device_id=a.device_id
    WHERE a.command_id = ? AND a.device_id = ?
  `).bind(id(commandId, "commandId"), id(deviceId, "deviceId")).first<ScopedAck>();

  return {
    async enqueue(input: { id: string; userId: string; deploymentId: string; type: CommandType; version: number;
      correlationId: string; expectedDeploymentVersion: number; payload: JsonObject; now: number; expiresAt: number }): Promise<{ command: CommandRecord; idempotent: boolean }> {
      exactInput(input, ["id", "userId", "deploymentId", "type", "version", "correlationId", "expectedDeploymentVersion", "payload", "now", "expiresAt"]);
      const parsed = parseCommandCreateDto({
        deploymentId: input.deploymentId,
        type: input.type,
        version: input.version,
        correlationId: input.correlationId,
        expectedDeploymentVersion: input.expectedDeploymentVersion,
        payload: input.payload,
      });
      const owner = id(input.userId, "userId");
      const commandId = id(input.id, "commandId");
      const correlationId = id(parsed.correlationId, "correlationId");
      const now = time(input.now, "now");
      const expiresAt = expiry(input.expiresAt, now);
      const payloadJson = safeCanonicalJsonStringify(parsed.payload, "command payload", 16_384);
      const normalized = { id: commandId, deploymentId: id(parsed.deploymentId, "deploymentId"), type: parsed.type,
        version: parsed.version, correlationId, expectedDeploymentVersion: parsed.expectedDeploymentVersion,
        payloadJson, now, expiresAt };
      const existing = await getByCorrelation(owner, correlationId);
      if (existing) {
        if (!sameCommand(existing, normalized)) throw new Error("command correlation conflict");
        return { command: existing, idempotent: true };
      }
      const deployment = await database.prepare(`SELECT device_id AS deviceId FROM deployments
        WHERE user_id=? AND id=? AND version=?`).bind(owner, normalized.deploymentId,
          positiveVersion(normalized.expectedDeploymentVersion, "expectedDeploymentVersion")).first<{ deviceId: string }>();
      if (!deployment) throw new Error("owned deployment version not found");
      try {
        const command = await database.prepare(`INSERT INTO commands
          (id,user_id,deployment_id,device_id,type,version,correlation_id,expected_deployment_version,payload_json,status,created_at,expires_at)
          SELECT ?,d.user_id,d.id,d.device_id,?,?,?,?,?,'pending',?,? FROM deployments d
          WHERE d.user_id=? AND d.id=? AND d.device_id=? AND d.version=?
          RETURNING ${commandColumns}`)
          .bind(commandId, normalized.type, normalized.version, correlationId, normalized.expectedDeploymentVersion,
            payloadJson, now, expiresAt, owner, normalized.deploymentId, deployment.deviceId,
            normalized.expectedDeploymentVersion).first<CommandRecord>();
        if (!command) throw new Error("owned deployment version not found");
        return { command, idempotent: false };
      } catch (error) {
        const raced = await getByCorrelation(owner, correlationId);
        if (raced && sameCommand(raced, normalized)) return { command: raced, idempotent: true };
        if (raced) throw new Error("command correlation conflict");
        throw error;
      }
    },
    async pollForDevice(deviceId: string, options: { now: number; limit: number; cursor?: { createdAt: number; id: string } }): Promise<{ items: CommandRecord[]; nextCursor: { createdAt: number; id: string } | null }> {
      exactInput(options, ["now", "limit", "cursor"]);
      const pageSize = limit(options.limit);
      if (options.cursor) exactInput(options.cursor, ["createdAt", "id"]);
      const cursorTime = options.cursor ? time(options.cursor.createdAt, "cursor.createdAt") : null;
      const cursorId = options.cursor ? id(options.cursor.id, "cursor.id") : null;
      const rows = await database.prepare(`SELECT ${commandColumns} FROM commands c
        WHERE c.device_id=? AND c.status='pending' AND c.expires_at>?
          AND EXISTS (SELECT 1 FROM devices v WHERE v.id=c.device_id AND v.status='active')
          AND NOT EXISTS (SELECT 1 FROM command_acknowledgements a WHERE a.command_id=c.id)
          AND EXISTS (SELECT 1 FROM deployments d WHERE d.id=c.deployment_id AND d.user_id=c.user_id
            AND d.device_id=c.device_id AND d.version=c.expected_deployment_version)
          AND (? IS NULL OR c.created_at>? OR (c.created_at=? AND c.id>?))
        ORDER BY c.created_at ASC,c.id ASC LIMIT ?`)
        .bind(id(deviceId, "deviceId"), time(options.now, "now"), cursorTime, cursorTime, cursorTime, cursorId, pageSize + 1)
        .all<CommandRecord>();
      if (!rows.success) throw new Error("command poll failed");
      const items = rows.results.slice(0, pageSize);
      const last = items.at(-1);
      return { items, nextCursor: rows.results.length > pageSize && last ? { createdAt: last.createdAt, id: last.id } : null };
    },
    async ack(input: { id: string; deviceId: string; commandId: string; deploymentId: string;
      expectedDeploymentVersion: number; status: "ok" | "rejected" | "failed"; payload: JsonObject; now: number }): Promise<{ acknowledgement: CommandAcknowledgementRecord; idempotent: boolean } | null> {
      exactInput(input, ["id", "deviceId", "commandId", "deploymentId", "expectedDeploymentVersion", "status", "payload", "now"]);
      if (input.status !== "ok" && input.status !== "rejected" && input.status !== "failed") throw new Error("ack status is invalid");
      const ackId = id(input.id, "acknowledgementId");
      const deviceId = id(input.deviceId, "deviceId");
      const commandId = id(input.commandId, "commandId");
      const deploymentId = id(input.deploymentId, "deploymentId");
      const expected = positiveVersion(input.expectedDeploymentVersion, "expectedDeploymentVersion");
      const payloadJson = safeCanonicalJsonStringify(input.payload, "ack payload", 16_384);
      const now = time(input.now, "now");
      const identical = (row: ScopedAck) => row.deviceId === deviceId
        && row.deploymentId === deploymentId && row.expectedDeploymentVersion === expected
        && row.status === input.status && row.payloadJson === payloadJson;
      const existing = await getAck(commandId, deviceId);
      if (existing) {
        if (!identical(existing)) throw new Error("command acknowledgement conflict");
        return { acknowledgement: existing, idempotent: true };
      }
      let results: ControlPlaneRunResult[];
      try {
        results = await database.batch([
          database.prepare(`INSERT INTO command_acknowledgements
            (id,command_id,user_id,device_id,status,payload_json,acknowledged_at)
            SELECT ?,c.id,c.user_id,c.device_id,?,?,? FROM commands c
            JOIN deployments d ON d.id=c.deployment_id AND d.user_id=c.user_id AND d.device_id=c.device_id
            WHERE c.id=? AND c.device_id=? AND c.deployment_id=? AND c.expected_deployment_version=?
              AND d.version=? AND c.status='pending' AND c.expires_at>?`)
            .bind(ackId, input.status, payloadJson, now, commandId, deviceId, deploymentId, expected, expected, now),
          database.prepare(`UPDATE commands SET status='acknowledged' WHERE id=? AND device_id=?
            AND EXISTS (SELECT 1 FROM command_acknowledgements WHERE command_id=?)`)
            .bind(commandId, deviceId, commandId),
        ]);
      } catch (error) {
        const raced = await getAck(commandId, deviceId);
        if (raced && identical(raced)) return { acknowledgement: raced, idempotent: true };
        if (raced) throw new Error("command acknowledgement conflict");
        throw error;
      }
      if (!results.every((result) => result.success && result.meta.changes === 1)) {
        const authoritative = await getAck(commandId, deviceId);
        if (authoritative && identical(authoritative)) return { acknowledgement: authoritative, idempotent: true };
        if (authoritative) throw new Error("command acknowledgement conflict");
        return null;
      }
      const acknowledgement = await getAck(commandId, deviceId);
      return acknowledgement ? { acknowledgement, idempotent: false } : null;
    },
  };
}

export const SUPPORTED_COMMAND_TYPES = COMMAND_TYPES;
