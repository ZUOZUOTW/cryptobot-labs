import { parseHeartbeatDto, safeCanonicalJsonStringify } from "../../lib/control-plane/schemas";
import type { HeartbeatDto, HeartbeatPositionDto, JsonObject } from "../../lib/control-plane/types";
import type { OrderStatus } from "../../packages/trading-core/src/orders/types";
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
export interface OrderRecord {
  id: string; userId: string; deploymentId: string; clientOrderId: string; exchangeOrderId: string | null;
  market: "spot" | "futures"; symbol: string; side: "buy" | "sell"; positionSide: "net" | "long" | "short";
  orderType: "market" | "limit"; state: OrderStatus; price: string | null; quantity: string;
  filledQuantity: string; averageFillPrice: string | null; notional: string; correlationId: string;
  createdAt: number; updatedAt: number;
}
export interface FillInput {
  id: string; exchangeFillId: string; price: string; quantity: string; fee: string;
  feeCurrency: string; realizedPnl: string | null; filledAt: number;
}
export type OrderInput = Omit<OrderRecord, "userId">;

const heartbeatColumns = `id,user_id AS userId,deployment_id AS deploymentId,device_id AS deviceId,
  sequence,mode,state,health,summary_json AS summaryJson,occurred_at AS occurredAt`;
const auditColumns = `id,user_id AS userId,actor_type AS actorType,actor_id AS actorId,device_id AS deviceId,
  deployment_id AS deploymentId,strategy_version_id AS strategyVersionId,type,correlation_id AS correlationId,
  payload_json AS payloadJson,occurred_at AS occurredAt,created_at AS createdAt`;
const orderColumns = `id,user_id AS userId,deployment_id AS deploymentId,client_order_id AS clientOrderId,
  exchange_order_id AS exchangeOrderId,market,symbol,side,position_side AS positionSide,order_type AS orderType,
  state,price,quantity,filled_quantity AS filledQuantity,average_fill_price AS averageFillPrice,notional,
  correlation_id AS correlationId,created_at AS createdAt,updated_at AS updatedAt`;
const fillColumns = `id,user_id AS userId,deployment_id AS deploymentId,order_id AS orderId,
  exchange_fill_id AS exchangeFillId,price,quantity,fee,fee_currency AS feeCurrency,
  realized_pnl AS realizedPnl,filled_at AS filledAt`;
const POSITIVE_DECIMAL = /^(?=.*[1-9])(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._:-]{1,63}$/;
const UNSIGNED_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const ORDER_STATES: readonly OrderStatus[] = ["proposed", "risk-rejected", "submitting", "acknowledged",
  "partially-filled", "filled", "cancel-pending", "cancelled", "rejected", "unknown", "reconciled"];
const TERMINAL_ORDER_STATES = new Set<OrderStatus>(["risk-rejected", "filled", "cancelled", "rejected"]);
const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  proposed: ["risk-rejected", "submitting"],
  "risk-rejected": [],
  submitting: ["acknowledged", "partially-filled", "filled", "rejected", "unknown"],
  acknowledged: ["partially-filled", "filled", "cancel-pending"],
  "partially-filled": ["partially-filled", "filled", "cancel-pending"],
  filled: [],
  "cancel-pending": ["cancel-pending", "partially-filled", "filled", "cancelled"],
  cancelled: [],
  rejected: [],
  unknown: ["acknowledged", "partially-filled", "filled", "cancelled", "rejected", "reconciled"],
  reconciled: ["acknowledged", "partially-filled", "filled", "cancelled", "rejected"],
};

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
const decimal = (value: string, label: string, signed = false, positive = false): string => {
  if (typeof value !== "string" || value.length > 128 || !(signed ? SIGNED_DECIMAL : UNSIGNED_DECIMAL).test(value)
    || (positive && !POSITIVE_DECIMAL.test(value))) throw new Error(`${label} must be a decimal string`);
  return value;
};
const compareUnsignedDecimals = (left: string, right: string): number => {
  const normalize = (value: string) => {
    const [integerPart, fractionPart = ""] = value.split(".");
    return { integer: integerPart!.replace(/^0+(?=\d)/, ""), fraction: fractionPart.replace(/0+$/, "") };
  };
  const a = normalize(left); const b = normalize(right);
  if (a.integer.length !== b.integer.length) return a.integer.length < b.integer.length ? -1 : 1;
  if (a.integer !== b.integer) return a.integer < b.integer ? -1 : 1;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const af = a.fraction.padEnd(width, "0"); const bf = b.fraction.padEnd(width, "0");
  return af === bf ? 0 : af < bf ? -1 : 1;
};

interface AuditInput {
  id: string; type: string; correlationId: string; payload: JsonObject; occurredAt: number; now: number;
  deploymentId?: string; strategyVersionId?: string;
}

type FillRecord = FillInput & { userId: string; deploymentId: string; orderId: string };

const normalizeOrder = (input: OrderInput): OrderInput => {
  exactInput(input, ["id", "deploymentId", "clientOrderId", "exchangeOrderId", "market", "symbol", "side",
    "positionSide", "orderType", "state", "price", "quantity", "filledQuantity", "averageFillPrice", "notional",
    "correlationId", "createdAt", "updatedAt"]);
  if (input.market !== "spot" && input.market !== "futures") throw new Error("order market is invalid");
  if (!SYMBOL.test(input.symbol)) throw new Error("order symbol is invalid");
  if (input.side !== "buy" && input.side !== "sell") throw new Error("order side is invalid");
  if (input.positionSide !== "net" && input.positionSide !== "long" && input.positionSide !== "short") throw new Error("positionSide is invalid");
  if (input.orderType !== "market" && input.orderType !== "limit") throw new Error("orderType is invalid");
  if (!ORDER_STATES.includes(input.state)) throw new Error("order state is invalid");
  const createdAt = time(input.createdAt, "order.createdAt");
  const updatedAt = time(input.updatedAt, "order.updatedAt");
  if (updatedAt < createdAt) throw new Error("order updatedAt cannot precede createdAt");
  const exchangeOrderId = input.exchangeOrderId === null ? null : id(input.exchangeOrderId, "exchangeOrderId");
  const price = input.price === null ? null : decimal(input.price, "order price", false, true);
  const quantity = decimal(input.quantity, "order quantity", false, true);
  const filledQuantity = decimal(input.filledQuantity, "filled quantity");
  const averageFillPrice = input.averageFillPrice === null ? null : decimal(input.averageFillPrice, "average fill price", false, true);
  const fillComparison = compareUnsignedDecimals(filledQuantity, quantity);
  const filledIsZero = compareUnsignedDecimals(filledQuantity, "0") === 0;
  if (fillComparison > 0) throw new Error("filled quantity exceeds order quantity");
  if (input.state === "partially-filled" && (filledIsZero || fillComparison >= 0)) throw new Error("invalid partially-filled quantity");
  if (input.state === "filled" && fillComparison !== 0) throw new Error("invalid filled quantity");
  if (["proposed", "submitting", "acknowledged", "risk-rejected", "rejected", "unknown"].includes(input.state)
    && !filledIsZero) throw new Error("unfilled order state cannot report filled quantity");
  if (!filledIsZero && averageFillPrice === null) throw new Error("filled order is missing average fill price");
  if (["acknowledged", "partially-filled", "cancel-pending", "cancelled"].includes(input.state)
    && exchangeOrderId === null) throw new Error("order state requires an exchange order id");
  if (input.orderType === "limit" && price === null) throw new Error("limit order requires a price");
  return {
    id: id(input.id, "orderId"), deploymentId: id(input.deploymentId, "deploymentId"),
    clientOrderId: id(input.clientOrderId, "clientOrderId"),
    exchangeOrderId,
    market: input.market, symbol: input.symbol, side: input.side, positionSide: input.positionSide,
    orderType: input.orderType, state: input.state,
    price, quantity, filledQuantity, averageFillPrice,
    notional: decimal(input.notional, "order notional", false, true), correlationId: id(input.correlationId, "correlationId"),
    createdAt, updatedAt,
  };
};

const normalizeFill = (input: FillInput): FillInput => {
  exactInput(input, ["id", "exchangeFillId", "price", "quantity", "fee", "feeCurrency", "realizedPnl", "filledAt"]);
  return {
    id: id(input.id, "fillId"), exchangeFillId: id(input.exchangeFillId, "exchangeFillId"),
    price: decimal(input.price, "fill price", false, true), quantity: decimal(input.quantity, "fill quantity", false, true),
    fee: decimal(input.fee, "fill fee"), feeCurrency: boundedText(input.feeCurrency, "fee currency", 32),
    realizedPnl: input.realizedPnl === null ? null : decimal(input.realizedPnl, "realized PnL", true),
    filledAt: time(input.filledAt, "filledAt"),
  };
};

const immutableOrderMatches = (row: OrderRecord, input: OrderInput): boolean => row.deploymentId === input.deploymentId
  && row.clientOrderId === input.clientOrderId && row.market === input.market && row.symbol === input.symbol
  && row.side === input.side && row.positionSide === input.positionSide && row.orderType === input.orderType
  && row.price === input.price && row.quantity === input.quantity && row.notional === input.notional
  && row.correlationId === input.correlationId && row.createdAt === input.createdAt;
const exactOrderMatches = (row: OrderRecord, input: OrderInput): boolean => immutableOrderMatches(row, input)
  && row.exchangeOrderId === input.exchangeOrderId && row.state === input.state
  && row.filledQuantity === input.filledQuantity && row.averageFillPrice === input.averageFillPrice
  && row.updatedAt === input.updatedAt;
const fillMatches = (row: FillRecord, input: FillInput): boolean => row.exchangeFillId === input.exchangeFillId
  && row.price === input.price && row.quantity === input.quantity && row.fee === input.fee
  && row.feeCurrency === input.feeCurrency && row.realizedPnl === input.realizedPnl && row.filledAt === input.filledAt;

export function createActivityRepository(database: ControlPlaneDatabase) {
  const getHeartbeat = (deviceId: string, deploymentId: string, sequence: number): Promise<HeartbeatRecord | null> => database.prepare(`
    SELECT ${heartbeatColumns} FROM run_heartbeats WHERE device_id=? AND deployment_id=? AND sequence=?
  `).bind(deviceId, deploymentId, sequence).first<HeartbeatRecord>();
  const getAuditForUser = (userId: string, auditId: string): Promise<AuditEventRecord | null> => database.prepare(`
    SELECT ${auditColumns} FROM audit_events WHERE user_id=? AND id=?
  `).bind(id(userId, "userId"), id(auditId, "auditEventId")).first<AuditEventRecord>();
  const getAuditForActor = (auditId: string, actorType: "user" | "device", actorId: string): Promise<AuditEventRecord | null> => database.prepare(`
    SELECT ${auditColumns} FROM audit_events WHERE id=? AND actor_type=? AND actor_id=?
  `).bind(auditId, actorType, actorId).first<AuditEventRecord>();
  const auditIdExists = (auditId: string): Promise<{ id: string } | null> => database.prepare(`
    SELECT id FROM audit_events WHERE id=?
  `).bind(auditId).first<{ id: string }>();
  const getOrderByIdentity = (deploymentId: string, clientOrderId: string): Promise<OrderRecord | null> => database.prepare(`
    SELECT ${orderColumns} FROM orders WHERE deployment_id=? AND client_order_id=?
  `).bind(deploymentId, clientOrderId).first<OrderRecord>();
  const getFillByExchangeId = (deploymentId: string, exchangeFillId: string): Promise<FillRecord | null> => database.prepare(`
    SELECT ${fillColumns} FROM fills WHERE deployment_id=? AND exchange_fill_id=?
  `).bind(deploymentId, exchangeFillId).first<FillRecord>();

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
      const latest = await database.prepare(`SELECT MAX(sequence) AS sequence FROM run_heartbeats
        WHERE deployment_id=? AND device_id=?`).bind(deploymentId, deviceId).first<{ sequence: number | null }>();
      if (latest?.sequence !== null && latest?.sequence !== undefined && latest.sequence >= heartbeat.sequence) {
        throw new Error("heartbeat sequence must increase monotonically");
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
      const positionKeys = normalizedPositions.map((position) => `${position.symbol}\u0000${position.side}`);
      if (new Set(positionKeys).size !== positionKeys.length) throw new Error("duplicate position symbol and side");
      const statements = [
        database.prepare(`INSERT INTO run_heartbeats
          (id,user_id,deployment_id,device_id,sequence,mode,state,health,summary_json,occurred_at)
          SELECT ?,d.user_id,d.id,d.device_id,?,?,?,?,?,? FROM deployments d
          JOIN devices v ON v.id=d.device_id AND v.user_id=d.user_id
          WHERE d.id=? AND d.device_id=? AND d.version=? AND d.mode=? AND d.state=? AND v.status='active'
            AND NOT EXISTS (SELECT 1 FROM run_heartbeats previous
              WHERE previous.deployment_id=d.id AND previous.device_id=d.device_id AND previous.sequence>=?)`)
          .bind(heartbeatId, heartbeat.sequence, heartbeat.mode, heartbeat.state, heartbeat.health, telemetryJson,
            heartbeat.occurredAt, deploymentId, deviceId, expectedVersion, heartbeat.mode, heartbeat.state, heartbeat.sequence),
        database.prepare(`DELETE FROM position_snapshots WHERE deployment_id=?
          AND EXISTS (SELECT 1 FROM run_heartbeats h JOIN deployments d ON d.id=h.deployment_id AND d.user_id=h.user_id
            JOIN devices v ON v.id=d.device_id AND v.user_id=d.user_id
            WHERE h.id=? AND h.device_id=? AND h.deployment_id=? AND h.sequence=?
              AND d.version=? AND d.mode=? AND d.state=? AND v.status='active')`)
          .bind(deploymentId, heartbeatId, deviceId, deploymentId, heartbeat.sequence,
            expectedVersion, heartbeat.mode, heartbeat.state),
        ...normalizedPositions.map((position, index) => database.prepare(`INSERT INTO position_snapshots
          (id,user_id,deployment_id,heartbeat_id,market,symbol,side,quantity,entry_price,mark_price,unrealized_pnl,leverage,captured_at)
          SELECT ?,h.user_id,h.deployment_id,h.id,s.market,?,?,?,?,?,?,?,? FROM run_heartbeats h
          JOIN deployments d ON d.id=h.deployment_id AND d.user_id=h.user_id
          JOIN strategy_versions sv ON sv.id=d.strategy_version_id AND sv.user_id=d.user_id
          JOIN strategies s ON s.id=sv.strategy_id AND s.user_id=sv.user_id
          WHERE h.id=? AND h.device_id=? AND h.deployment_id=? AND h.sequence=?
            AND d.version=? AND d.mode=? AND d.state=?`)
          .bind(positionIds[index], position.symbol, position.side, position.quantity, position.entryPrice,
            position.markPrice, position.unrealizedPnl, position.leverage, heartbeat.occurredAt, heartbeatId, deviceId,
            deploymentId, heartbeat.sequence, expectedVersion, heartbeat.mode, heartbeat.state)),
        database.prepare(`INSERT INTO run_heartbeats
          (id,user_id,deployment_id,device_id,sequence,mode,state,health,summary_json,occurred_at)
          SELECT ?,NULL,?,?,?,?,?,?,?,? WHERE NOT EXISTS (
            SELECT 1 FROM run_heartbeats h
            JOIN deployments d ON d.id=h.deployment_id AND d.user_id=h.user_id
            JOIN devices v ON v.id=d.device_id AND v.user_id=d.user_id
            WHERE h.id=? AND h.device_id=? AND h.deployment_id=? AND h.sequence=?
              AND h.mode=? AND h.state=? AND h.health=? AND h.summary_json=? AND h.occurred_at=?
              AND d.version=? AND d.mode=? AND d.state=? AND v.status='active'
              AND (SELECT COUNT(*) FROM position_snapshots p
                WHERE p.heartbeat_id=h.id AND p.deployment_id=h.deployment_id)=?
          )`).bind(heartbeatId, deploymentId, deviceId, heartbeat.sequence, heartbeat.mode, heartbeat.state,
            heartbeat.health, telemetryJson, heartbeat.occurredAt, heartbeatId, deviceId, deploymentId,
            heartbeat.sequence, heartbeat.mode, heartbeat.state, heartbeat.health, telemetryJson, heartbeat.occurredAt,
            expectedVersion, heartbeat.mode, heartbeat.state, normalizedPositions.length),
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

    async ingestOrderTelemetry(input: { deviceId: string; expectedDeploymentVersion: number; mode: "paper" | "futures-demo" | "live";
      deploymentState: "running" | "paused" | "stopped" | "error"; order: OrderInput; fills: FillInput[] }): Promise<{ order: OrderRecord; idempotent: boolean }> {
      exactInput(input, ["deviceId", "expectedDeploymentVersion", "mode", "deploymentState", "order", "fills"]);
      const deviceId = id(input.deviceId, "deviceId");
      const expectedVersion = version(input.expectedDeploymentVersion);
      const order = normalizeOrder(input.order);
      if (input.mode !== "paper" && input.mode !== "futures-demo" && input.mode !== "live") throw new Error("mode is invalid");
      if (input.deploymentState !== "running" && input.deploymentState !== "paused"
        && input.deploymentState !== "stopped" && input.deploymentState !== "error") throw new Error("deploymentState is invalid");
      if (!Array.isArray(input.fills) || input.fills.length > 500) throw new Error("fills must contain at most 500 items");
      const fills = input.fills.map(normalizeFill);
      if (new Set(fills.map((fill) => fill.exchangeFillId)).size !== fills.length) throw new Error("duplicate exchange fill id");
      const assignment = await database.prepare(`SELECT d.user_id AS userId FROM deployments d
        JOIN devices v ON v.id=d.device_id AND v.user_id=d.user_id
        WHERE d.id=? AND d.device_id=? AND d.version=? AND d.mode=? AND d.state=? AND v.status='active'`)
        .bind(order.deploymentId, deviceId, expectedVersion, input.mode, input.deploymentState).first<{ userId: string }>();
      if (!assignment) throw new Error("assigned deployment version, mode, or state fence failed");

      const existing = await getOrderByIdentity(order.deploymentId, order.clientOrderId);
      const winnerId = existing?.id ?? order.id;
      if (existing) {
        const exactRetry = exactOrderMatches(existing, order);
        if (!immutableOrderMatches(existing, order)) throw new Error("order semantic conflict");
        if (existing.exchangeOrderId !== null && existing.exchangeOrderId !== order.exchangeOrderId) throw new Error("exchange order id conflict");
        if (TERMINAL_ORDER_STATES.has(existing.state) && !exactOrderMatches(existing, order)) {
          throw new Error(`terminal order ${existing.state} is immutable`);
        }
        if (existing.averageFillPrice !== null && order.averageFillPrice === null) throw new Error("average fill price cannot be cleared");
        if (!exactRetry && order.updatedAt <= existing.updatedAt) throw new Error("material order update timestamp must increase");
        if (compareUnsignedDecimals(order.filledQuantity, existing.filledQuantity) < 0) throw new Error("filled quantity regression");
        if (order.state !== existing.state && !ORDER_TRANSITIONS[existing.state].includes(order.state)) {
          throw new Error(`illegal order state regression: ${existing.state} -> ${order.state}`);
        }
      }
      const exchangeCollision = order.exchangeOrderId === null ? null : await database.prepare(`SELECT id FROM orders
        WHERE deployment_id=? AND exchange_order_id=? AND client_order_id<>?`)
        .bind(order.deploymentId, order.exchangeOrderId, order.clientOrderId).first<{ id: string }>();
      if (exchangeCollision) throw new Error("exchange order id conflict");

      const newFills: FillInput[] = [];
      for (const fill of fills) {
        const stored = await getFillByExchangeId(order.deploymentId, fill.exchangeFillId);
        if (!stored) newFills.push(fill);
        else if (stored.orderId !== winnerId || !fillMatches(stored, fill)) throw new Error("exchange fill conflict or wrong order");
      }
      if (existing && exactOrderMatches(existing, order) && newFills.length === 0) return { order: existing, idempotent: true };

      const orderStatement = existing
        ? database.prepare(`UPDATE orders SET exchange_order_id=?,state=?,filled_quantity=?,average_fill_price=?,updated_at=?
            WHERE id=? AND deployment_id=? AND client_order_id=? AND exchange_order_id IS ?
              AND state=? AND filled_quantity=? AND average_fill_price IS ? AND updated_at=?
              AND EXISTS (SELECT 1 FROM deployments d JOIN devices v ON v.id=d.device_id AND v.user_id=d.user_id
                WHERE d.id=orders.deployment_id AND d.device_id=? AND d.version=? AND d.mode=? AND d.state=? AND v.status='active')`)
          .bind(order.exchangeOrderId, order.state, order.filledQuantity, order.averageFillPrice, order.updatedAt,
            winnerId, order.deploymentId, order.clientOrderId, existing.exchangeOrderId, existing.state,
            existing.filledQuantity, existing.averageFillPrice, existing.updatedAt,
            deviceId, expectedVersion, input.mode, input.deploymentState)
        : database.prepare(`INSERT INTO orders
            (id,user_id,deployment_id,client_order_id,exchange_order_id,market,symbol,side,position_side,order_type,state,
             price,quantity,filled_quantity,average_fill_price,notional,correlation_id,created_at,updated_at)
            SELECT ?,d.user_id,d.id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM deployments d
            JOIN devices v ON v.id=d.device_id AND v.user_id=d.user_id
            WHERE d.id=? AND d.device_id=? AND d.version=? AND d.mode=? AND d.state=? AND v.status='active'`)
          .bind(winnerId, order.clientOrderId, order.exchangeOrderId, order.market, order.symbol, order.side,
            order.positionSide, order.orderType, order.state, order.price, order.quantity, order.filledQuantity,
            order.averageFillPrice, order.notional, order.correlationId, order.createdAt, order.updatedAt,
            order.deploymentId, deviceId, expectedVersion, input.mode, input.deploymentState);
      const fillStatements = newFills.map((fill) => database.prepare(`INSERT INTO fills
        (id,user_id,deployment_id,order_id,exchange_fill_id,price,quantity,fee,fee_currency,realized_pnl,filled_at)
        SELECT ?,o.user_id,o.deployment_id,o.id,?,?,?,?,?,?,? FROM orders o
        JOIN deployments d ON d.id=o.deployment_id AND d.user_id=o.user_id
        JOIN devices v ON v.id=d.device_id AND v.user_id=d.user_id
        WHERE o.id=? AND o.deployment_id=? AND o.client_order_id=?
          AND d.device_id=? AND d.version=? AND d.mode=? AND d.state=? AND v.status='active'`)
        .bind(fill.id, fill.exchangeFillId, fill.price, fill.quantity, fill.fee, fill.feeCurrency, fill.realizedPnl,
          fill.filledAt, winnerId, order.deploymentId, order.clientOrderId, deviceId, expectedVersion,
          input.mode, input.deploymentState));
      const fillFilter = fills.length === 0
        ? { sql: "0=1", values: [] as string[] }
        : { sql: `f.exchange_fill_id IN (${fills.map(() => "?").join(",")})`, values: fills.map((fill) => fill.exchangeFillId) };
      const guard = database.prepare(`INSERT INTO fills
        (id,user_id,deployment_id,order_id,exchange_fill_id,price,quantity,fee,fee_currency,realized_pnl,filled_at)
        SELECT ?,NULL,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (
          SELECT 1 FROM orders o JOIN deployments d ON d.id=o.deployment_id AND d.user_id=o.user_id
          JOIN devices v ON v.id=d.device_id AND v.user_id=d.user_id
          WHERE o.id=? AND o.deployment_id=? AND o.client_order_id=? AND o.exchange_order_id IS ?
            AND o.market=? AND o.symbol=? AND o.side=? AND o.position_side=? AND o.order_type=? AND o.state=?
            AND o.price IS ? AND o.quantity=? AND o.filled_quantity=? AND o.average_fill_price IS ?
            AND o.notional=? AND o.correlation_id=? AND o.created_at=? AND o.updated_at=?
            AND d.device_id=? AND d.version=? AND d.mode=? AND d.state=? AND v.status='active'
            AND (SELECT COUNT(*) FROM fills f WHERE f.order_id=o.id AND ${fillFilter.sql})=?
        )`).bind(winnerId, order.deploymentId, winnerId, "guard", "1", "1", "0", "NA", null, 0,
          winnerId, order.deploymentId, order.clientOrderId, order.exchangeOrderId, order.market, order.symbol,
          order.side, order.positionSide, order.orderType, order.state, order.price, order.quantity,
          order.filledQuantity, order.averageFillPrice, order.notional, order.correlationId, order.createdAt,
          order.updatedAt, deviceId, expectedVersion, input.mode, input.deploymentState,
          ...fillFilter.values, fills.length);
      try {
        await database.batch([orderStatement, ...fillStatements, guard]);
      } catch (error) {
        const racedOrder = await getOrderByIdentity(order.deploymentId, order.clientOrderId);
        if (racedOrder && exactOrderMatches(racedOrder, order)) {
          const racedFills = await Promise.all(fills.map((fill) => getFillByExchangeId(order.deploymentId, fill.exchangeFillId)));
          if (racedFills.every((row, index) => row && row.orderId === racedOrder.id && fillMatches(row, fills[index]!))) {
            return { order: racedOrder, idempotent: true };
          }
        }
        if (racedOrder) throw new Error("order or fill telemetry conflict");
        throw error;
      }
      const stored = await getOrderByIdentity(order.deploymentId, order.clientOrderId);
      if (!stored || !exactOrderMatches(stored, order)) throw new Error("atomic order telemetry guard failed");
      return { order: stored, idempotent: false };
    },

    getOrderForUser(userId: string, deploymentId: string, clientOrderId: string): Promise<OrderRecord | null> {
      return database.prepare(`SELECT ${orderColumns} FROM orders WHERE user_id=? AND deployment_id=? AND client_order_id=?`)
        .bind(id(userId, "userId"), id(deploymentId, "deploymentId"), id(clientOrderId, "clientOrderId")).first<OrderRecord>();
    },

    async listOrdersForUser(userId: string, options: { limit: number; cursor?: { createdAt: number; id: string } }): Promise<{ items: OrderRecord[]; nextCursor: { createdAt: number; id: string } | null }> {
      exactInput(options, ["limit", "cursor"]); const pageSize = limit(options.limit);
      if (options.cursor) exactInput(options.cursor, ["createdAt", "id"]);
      const cursorTime = options.cursor ? time(options.cursor.createdAt, "cursor.createdAt") : null;
      const cursorId = options.cursor ? id(options.cursor.id, "cursor.id") : null;
      const rows = await database.prepare(`SELECT ${orderColumns} FROM orders WHERE user_id=?
        AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`)
        .bind(id(userId, "userId"), cursorTime, cursorTime, cursorTime, cursorId, pageSize + 1).all<OrderRecord>();
      if (!rows.success) throw new Error("order list failed");
      const items = rows.results.slice(0, pageSize); const last = items.at(-1);
      return { items, nextCursor: rows.results.length > pageSize && last ? { createdAt: last.createdAt, id: last.id } : null };
    },

    async appendUserAudit(input: AuditInput & { userId: string; deviceId?: string }): Promise<{ event: AuditEventRecord; idempotent: boolean }> {
      exactInput(input, ["id", "userId", "deviceId", "deploymentId", "strategyVersionId", "type", "correlationId", "payload", "occurredAt", "now"]);
      const owner = id(input.userId, "userId");
      const deviceId = input.deviceId === undefined ? null : id(input.deviceId, "deviceId");
      const value = normalizeAudit(input);
      const same = (row: AuditEventRecord) => row.userId === owner && row.actorType === "user" && row.actorId === owner
        && row.deviceId === deviceId && row.deploymentId === value.deploymentId
        && row.strategyVersionId === value.strategyVersionId && row.type === value.type
        && row.correlationId === value.correlationId && row.payloadJson === value.payloadJson
        && row.occurredAt === value.occurredAt;
      const existing = await getAuditForActor(value.eventId, "user", owner);
      if (existing) {
        if (!same(existing)) throw new Error("audit event conflict");
        return { event: existing, idempotent: true };
      }
      let row: AuditEventRecord | null;
      try {
        row = await database.prepare(`INSERT INTO audit_events
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
      } catch (error) {
        const winner = await getAuditForActor(value.eventId, "user", owner);
        if (winner && same(winner)) return { event: winner, idempotent: true };
        if (winner || await auditIdExists(value.eventId)) throw new Error("audit event conflict");
        throw error;
      }
      if (!row) {
        if (await auditIdExists(value.eventId)) throw new Error("audit event conflict");
        throw new Error("owned audit actor or target not found");
      }
      return { event: row, idempotent: false };
    },

    async appendDeviceAudit(input: AuditInput & { deviceId: string }): Promise<{ event: AuditEventRecord; idempotent: boolean }> {
      exactInput(input, ["id", "deviceId", "deploymentId", "strategyVersionId", "type", "correlationId", "payload", "occurredAt", "now"]);
      const deviceId = id(input.deviceId, "deviceId");
      const value = normalizeAudit(input);
      const same = (row: AuditEventRecord) => row.actorType === "device" && row.actorId === deviceId
        && row.deviceId === deviceId && row.deploymentId === value.deploymentId
        && row.strategyVersionId === value.strategyVersionId && row.type === value.type
        && row.correlationId === value.correlationId && row.payloadJson === value.payloadJson
        && row.occurredAt === value.occurredAt;
      const existing = await getAuditForActor(value.eventId, "device", deviceId);
      if (existing) {
        if (!same(existing)) throw new Error("audit event conflict");
        return { event: existing, idempotent: true };
      }
      let row: AuditEventRecord | null;
      try {
        row = await database.prepare(`INSERT INTO audit_events
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
      } catch (error) {
        const winner = await getAuditForActor(value.eventId, "device", deviceId);
        if (winner && same(winner)) return { event: winner, idempotent: true };
        if (winner || await auditIdExists(value.eventId)) throw new Error("audit event conflict");
        throw error;
      }
      if (!row) {
        if (await auditIdExists(value.eventId)) throw new Error("audit event conflict");
        throw new Error("owned assigned device audit actor or target not found");
      }
      return { event: row, idempotent: false };
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
