import type { createActivityRepository } from "../../db/repositories/activity";
import type { createDeploymentRepository } from "../../db/repositories/deployments";
import { safeCanonicalJsonStringify } from "../control-plane/schemas";
import type { JsonObject } from "../control-plane/types";

export const DEVICE_EVENT_TYPES = [
  "heartbeat", "connection-verified", "signal", "risk-block", "order-state", "fill",
  "deployment-state", "key-rotated", "key-erased", "agent-error",
] as const;
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];

export interface VerifiedDeviceIdentity { readonly deviceId: string; readonly verified: true }
export interface DeviceEventEnvelope {
  version: 1; id: string; type: DeviceEventType; deploymentId: string;
  expectedDeploymentVersion: number; correlationId: string; occurredAt: number; payload: JsonObject;
}

export class DeviceEventError extends Error {
  constructor(readonly category: "invalid-event" | "forbidden-data" | "deployment-fence" | "event-conflict", message: string) {
    super(message); this.name = "DeviceEventError";
  }
}

type Activity = ReturnType<typeof createActivityRepository>;
type Deployments = Pick<ReturnType<typeof createDeploymentRepository>, "getForDevice">;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._:-]{1,63}$/;
const MASKED_SUFFIX = /^\*{4}[A-Za-z0-9]{4}$/;
const FORBIDDEN_NAMES = ["secret", "apikey", "accesskey", "passphrase", "accesssign", "signature", "credential",
  "authorization", "authentication", "cookie", "privatekey", "rawaccount", "header", "token"];

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new DeviceEventError("invalid-event", `${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
};
const exact = (value: Record<string, unknown>, keys: readonly string[], label: string) => {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  const missing = keys.find((key) => !Object.hasOwn(value, key));
  if (unknown || missing) throw new DeviceEventError("invalid-event", `${label} fields are invalid`);
};
const text = (value: unknown, label: string, max = 256): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new DeviceEventError("invalid-event", `${label} is invalid`);
  }
  return value;
};
const id = (value: unknown, label: string): string => {
  const result = text(value, label, 128); if (!ID.test(result)) throw new DeviceEventError("invalid-event", `${label} is invalid`); return result;
};
const integer = (value: unknown, label: string, min = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min) throw new DeviceEventError("invalid-event", `${label} is invalid`);
  return value as number;
};
const decimal = (value: unknown, label: string, signed = false, positive = false): string => {
  const result = text(value, label, 128);
  if (!(signed ? SIGNED_DECIMAL : DECIMAL).test(result) || (positive && Number(result) <= 0)) {
    throw new DeviceEventError("invalid-event", `${label} is invalid`);
  }
  return result;
};
const oneOf = <T extends string>(value: unknown, values: readonly T[], label: string): T => {
  if (typeof value !== "string" || !values.includes(value as T)) throw new DeviceEventError("invalid-event", `${label} is invalid`);
  return value as T;
};
const optional = <T>(value: unknown, parse: (value: unknown) => T): T | null => value === null ? null : parse(value);

const normalizedName = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
const rejectSecrets = (value: unknown): void => {
  const seen = new WeakSet<object>(); let nodes = 0;
  const walk = (item: unknown, key = "", depth = 0): void => {
    if (++nodes > 2_048 || depth > 32) throw new DeviceEventError("invalid-event", "event payload is too complex");
    if (key) {
      const normalized = normalizedName(key);
      if (normalized !== "apikeysuffix" && normalized !== "maskedapikeysuffix"
        && FORBIDDEN_NAMES.some((part) => normalized.includes(part))) {
        throw new DeviceEventError("forbidden-data", "event contains forbidden credential material");
      }
    }
    if (typeof item === "string") {
      const lower = item.toLowerCase();
      if (/-----begin (?:rsa |ec |ed25519 )?private key-----/.test(lower)
        || /^(?:bearer|basic)\s+[a-z0-9+/_=-]{8,}$/i.test(item)
        || /(?:api[_ -]?secret|secret[_ -]?key|pass[_ -]?phrase|weex[_ -]?access[_ -]?sign|access[_ -]?sign|authorization|set-cookie|cookie)\s*[:=]/i.test(item)
        || /\b(?:cred|bst)_[A-Za-z0-9_-]{16,}\b/.test(item)
        || /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}\b/.test(item)) {
        throw new DeviceEventError("forbidden-data", "event contains forbidden credential material");
      }
      return;
    }
    if (item === null || typeof item !== "object") return;
    if (seen.has(item)) throw new DeviceEventError("invalid-event", "event payload cannot be cyclic");
    seen.add(item);
    if (Array.isArray(item)) item.forEach((entry) => walk(entry, "", depth + 1));
    else Object.entries(item).forEach(([name, entry]) => walk(entry, name, depth + 1));
    seen.delete(item);
  };
  walk(value);
};

const parsePosition = (value: unknown) => {
  const item = record(value, "position");
  exact(item, ["symbol", "side", "quantity", "entryPrice", "markPrice", "unrealizedPnl", "leverage"], "position");
  const symbol = text(item.symbol, "symbol", 64); if (!SYMBOL.test(symbol)) throw new DeviceEventError("invalid-event", "symbol is invalid");
  return { symbol, side: oneOf(item.side, ["long", "short"] as const, "side"), quantity: decimal(item.quantity, "quantity", false, true),
    entryPrice: decimal(item.entryPrice, "entryPrice", false, true), markPrice: decimal(item.markPrice, "markPrice", false, true),
    unrealizedPnl: decimal(item.unrealizedPnl, "unrealizedPnl", true), leverage: decimal(item.leverage, "leverage", false, true) };
};
const parseOrder = (value: unknown) => {
  const item = record(value, "order");
  exact(item, ["id", "deploymentId", "clientOrderId", "exchangeOrderId", "market", "symbol", "side", "positionSide",
    "orderType", "state", "price", "quantity", "filledQuantity", "averageFillPrice", "notional", "correlationId", "createdAt", "updatedAt"], "order");
  const symbol = text(item.symbol, "symbol", 64); if (!SYMBOL.test(symbol)) throw new DeviceEventError("invalid-event", "symbol is invalid");
  return { id:id(item.id,"order.id"), deploymentId:id(item.deploymentId,"order.deploymentId"), clientOrderId:id(item.clientOrderId,"clientOrderId"),
    exchangeOrderId:optional(item.exchangeOrderId,(v)=>id(v,"exchangeOrderId")), market:oneOf(item.market,["spot","futures"] as const,"market"), symbol,
    side:oneOf(item.side,["buy","sell"] as const,"side"), positionSide:oneOf(item.positionSide,["net","long","short"] as const,"positionSide"),
    orderType:oneOf(item.orderType,["market","limit"] as const,"orderType"), state:oneOf(item.state,["proposed","risk-rejected","submitting","acknowledged","partially-filled","filled","cancel-pending","cancelled","rejected","unknown","reconciled"] as const,"state"),
    price:optional(item.price,(v)=>decimal(v,"price",false,true)), quantity:decimal(item.quantity,"quantity",false,true), filledQuantity:decimal(item.filledQuantity,"filledQuantity"),
    averageFillPrice:optional(item.averageFillPrice,(v)=>decimal(v,"averageFillPrice",false,true)), notional:decimal(item.notional,"notional",false,true),
    correlationId:id(item.correlationId,"order.correlationId"), createdAt:integer(item.createdAt,"createdAt"), updatedAt:integer(item.updatedAt,"updatedAt") };
};
const parseFill = (value: unknown) => {
  const item=record(value,"fill"); exact(item,["id","exchangeFillId","price","quantity","fee","feeCurrency","realizedPnl","filledAt"],"fill");
  return {id:id(item.id,"fill.id"),exchangeFillId:id(item.exchangeFillId,"exchangeFillId"),price:decimal(item.price,"fill.price",false,true),quantity:decimal(item.quantity,"fill.quantity",false,true),fee:decimal(item.fee,"fee"),feeCurrency:text(item.feeCurrency,"feeCurrency",32),realizedPnl:optional(item.realizedPnl,(v)=>decimal(v,"realizedPnl",true)),filledAt:integer(item.filledAt,"filledAt")};
};

const payloadParsers: Record<DeviceEventType, (value: unknown, deploymentId: string) => JsonObject> = {
  heartbeat(value, deploymentId) { const p=record(value,"heartbeat payload"); exact(p,["heartbeat","positionIds"],"heartbeat payload"); const h=record(p.heartbeat,"heartbeat"); exact(h,["deploymentId","sequence","occurredAt","mode","state","health","positions"],"heartbeat");
    if(id(h.deploymentId,"heartbeat.deploymentId")!==deploymentId) throw new DeviceEventError("deployment-fence","event deployment fence failed");
    if(!Array.isArray(h.positions)||h.positions.length>100||!Array.isArray(p.positionIds)||p.positionIds.length!==h.positions.length) throw new DeviceEventError("invalid-event","heartbeat positions are invalid");
    return {heartbeat:{deploymentId,sequence:integer(h.sequence,"sequence",1),occurredAt:integer(h.occurredAt,"heartbeat.occurredAt"),mode:oneOf(h.mode,["paper","futures-demo","live"] as const,"mode"),state:oneOf(h.state,["running","paused","stopped","error"] as const,"state"),health:oneOf(h.health,["healthy","degraded","paused"] as const,"health"),positions:h.positions.map(parsePosition)},positionIds:p.positionIds.map((v)=>id(v,"positionId"))}; },
  "connection-verified"(value){const p=record(value,"connection payload");exact(p,["mode","market","accountAlias","apiKeySuffix"],"connection payload");const suffix=text(p.apiKeySuffix,"apiKeySuffix",8);if(!MASKED_SUFFIX.test(suffix))throw new DeviceEventError("forbidden-data","masked suffix is invalid");return {mode:oneOf(p.mode,["paper","futures-demo","live"] as const,"mode"),market:oneOf(p.market,["spot","futures"] as const,"market"),accountAlias:text(p.accountAlias,"accountAlias",64),apiKeySuffix:suffix};},
  signal(value){const p=record(value,"signal payload");exact(p,["symbol","action","side","quantity","price","reason"],"signal payload");const symbol=text(p.symbol,"symbol",64);if(!SYMBOL.test(symbol))throw new DeviceEventError("invalid-event","symbol is invalid");return {symbol,action:oneOf(p.action,["enter","exit","hold"] as const,"action"),side:oneOf(p.side,["buy","sell"] as const,"side"),quantity:decimal(p.quantity,"quantity",false,true),price:optional(p.price,(v)=>decimal(v,"price",false,true)),reason:text(p.reason,"reason",256)};},
  "risk-block"(value){const p=record(value,"risk payload");exact(p,["code","symbol","message"],"risk payload");return {code:text(p.code,"code",64),symbol:optional(p.symbol,(v)=>{const s=text(v,"symbol",64);if(!SYMBOL.test(s))throw new DeviceEventError("invalid-event","symbol is invalid");return s;}),message:text(p.message,"message",512)};},
  "order-state":parseOrderTelemetry,
  fill(value,deploymentId){const result=parseOrderTelemetry(value,deploymentId);if(!Array.isArray(result.fills)||result.fills.length<1)throw new DeviceEventError("invalid-event","fill event requires fills");return result;},
  "deployment-state"(value){const p=record(value,"state payload");exact(p,["state","reason"],"state payload");return {state:oneOf(p.state,["running","paused","stopped","error"] as const,"state"),reason:text(p.reason,"reason",256)};},
  "key-rotated"(value){const p=record(value,"key payload");exact(p,["apiKeySuffix"],"key payload");const suffix=text(p.apiKeySuffix,"apiKeySuffix",8);if(!MASKED_SUFFIX.test(suffix))throw new DeviceEventError("forbidden-data","masked suffix is invalid");return {apiKeySuffix:suffix};},
  "key-erased"(value){const p=record(value,"erase payload");exact(p,["reason"],"erase payload");return {reason:text(p.reason,"reason",256)};},
  "agent-error"(value){const p=record(value,"error payload");exact(p,["code","message","retryable"],"error payload");if(typeof p.retryable!=="boolean")throw new DeviceEventError("invalid-event","retryable is invalid");return {code:text(p.code,"code",64),message:text(p.message,"message",512),retryable:p.retryable};},
};
function parseOrderTelemetry(value: unknown, deploymentId: string): JsonObject {const p=record(value,"order payload");exact(p,["mode","deploymentState","order","fills"],"order payload");const order=parseOrder(p.order);if(order.deploymentId!==deploymentId)throw new DeviceEventError("deployment-fence","event deployment fence failed");if(!Array.isArray(p.fills)||p.fills.length>500)throw new DeviceEventError("invalid-event","fills are invalid");return {mode:oneOf(p.mode,["paper","futures-demo","live"] as const,"mode"),deploymentState:oneOf(p.deploymentState,["running","paused","stopped","error"] as const,"deploymentState"),order,fills:p.fills.map(parseFill)};}

export function parseDeviceEvent(value: unknown): DeviceEventEnvelope {
  rejectSecrets(value); const envelope=record(value,"event");
  exact(envelope,["version","id","type","deploymentId","expectedDeploymentVersion","correlationId","occurredAt","payload"],"event");
  if(envelope.version!==1)throw new DeviceEventError("invalid-event","event version is unsupported");
  const type=oneOf(envelope.type,DEVICE_EVENT_TYPES,"event type"); const deploymentId=id(envelope.deploymentId,"deploymentId");
  const parsed:DeviceEventEnvelope={version:1,id:id(envelope.id,"eventId"),type,deploymentId,expectedDeploymentVersion:integer(envelope.expectedDeploymentVersion,"expectedDeploymentVersion",1),correlationId:id(envelope.correlationId,"correlationId"),occurredAt:integer(envelope.occurredAt,"occurredAt"),payload:payloadParsers[type](envelope.payload,deploymentId)};
  if (type === "heartbeat") {
    const heartbeat = parsed.payload.heartbeat as unknown as { occurredAt: number };
    if (heartbeat.occurredAt !== parsed.occurredAt) throw new DeviceEventError("invalid-event", "heartbeat and envelope timestamps must match");
  }
  if (type === "order-state" || type === "fill") {
    const order = parsed.payload.order as unknown as { correlationId: string; createdAt: number; updatedAt: number };
    const fills = parsed.payload.fills as unknown as Array<{ filledAt: number }>;
    if (order.correlationId !== parsed.correlationId) throw new DeviceEventError("invalid-event", "order and envelope correlation ids must match");
    if (order.createdAt > order.updatedAt || order.updatedAt !== parsed.occurredAt) {
      throw new DeviceEventError("invalid-event", "order and envelope timestamps are incoherent");
    }
    if (fills.some((fill) => fill.filledAt < order.createdAt || fill.filledAt > parsed.occurredAt)
      || (fills.length > 0 && Math.max(...fills.map((fill) => fill.filledAt)) !== parsed.occurredAt)) {
      throw new DeviceEventError("invalid-event", "fill timestamps must be bounded and end at the event timestamp");
    }
  }
  // Re-clone, bound and canonicalize before anything reaches persistence.
  parsed.payload=JSON.parse(safeCanonicalJsonStringify(parsed.payload,"device event payload",65_536)) as JsonObject;
  return parsed;
}

export function createDeviceEventService(activity: Activity, options: { deployments: Deployments; now?:()=>number }) {
  return { async ingest(identity: VerifiedDeviceIdentity, input: unknown) {
    if(identity?.verified!==true)throw new DeviceEventError("invalid-event","verified device identity is required");
    const event=parseDeviceEvent(input); const now=(options.now??Date.now)();
    try {
      const persistedTimes = [event.occurredAt];
      if (event.type === "order-state" || event.type === "fill") {
        const order = event.payload.order as unknown as { createdAt: number; updatedAt: number };
        const fills = event.payload.fills as unknown as Array<{ filledAt: number }>;
        persistedTimes.push(order.createdAt, order.updatedAt, ...fills.map((fill) => fill.filledAt));
      }
      if (persistedTimes.some((value) => value > now + 300_000 || value < now - 2_592_000_000)) {
        throw new DeviceEventError("invalid-event", "event timestamp is outside the accepted clock window");
      }
      const deployment = await options.deployments.getForDevice(identity.deviceId, event.deploymentId);
      if (!deployment || deployment.version !== event.expectedDeploymentVersion) {
        throw new DeviceEventError("deployment-fence", "deployment fence failed");
      }
      const ledger={version:1 as const,expectedDeploymentVersion:event.expectedDeploymentVersion,type:event.type,correlationId:event.correlationId,payload:event.payload,occurredAt:event.occurredAt,now};
      if(event.type==="heartbeat") { const p=event.payload as unknown as {heartbeat: Parameters<Activity["ingestHeartbeat"]>[0]["heartbeat"];positionIds:string[]}; return {kind:"heartbeat" as const,...await activity.ingestHeartbeat({id:event.id,deviceId:identity.deviceId,expectedDeploymentVersion:event.expectedDeploymentVersion,heartbeat:p.heartbeat,positionIds:p.positionIds,event:ledger})}; }
      if(event.type==="order-state"||event.type==="fill") { const p=event.payload as unknown as {mode:"paper"|"futures-demo"|"live";deploymentState:"running"|"paused"|"stopped"|"error";order:Parameters<Activity["ingestOrderTelemetry"]>[0]["order"];fills:Parameters<Activity["ingestOrderTelemetry"]>[0]["fills"]}; return {kind:"order" as const,...await activity.ingestOrderTelemetry({deviceId:identity.deviceId,expectedDeploymentVersion:event.expectedDeploymentVersion,...p,event:{id:event.id,...ledger}})}; }
      const audit=await activity.appendDeviceAudit({id:event.id,deviceId:identity.deviceId,deploymentId:event.deploymentId,expectedDeploymentVersion:event.expectedDeploymentVersion,type:event.type,correlationId:event.correlationId,payload:{version:1,expectedDeploymentVersion:event.expectedDeploymentVersion,payload:event.payload},occurredAt:event.occurredAt,now});
      return {kind:"audit" as const,...audit};
    } catch(error) { if(error instanceof DeviceEventError)throw error; const message=error instanceof Error?error.message:"event persistence failed"; throw new DeviceEventError(/conflict|duplicate|sequence/i.test(message)?"event-conflict":"deployment-fence",/conflict|duplicate|sequence/i.test(message)?"event conflict":"deployment fence failed"); }
  }};
}
