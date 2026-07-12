import type { ControlPlaneDatabase } from "../index";
import type { ConnectionPermissions } from "./connections";
import { id } from "./shared";

export interface LiveConnectionRecord {
  status: "verified" | "erased"; hasLocalCredential: boolean; withdrawalAccessAbsent: boolean;
  version: number; verifiedAt: number | null; permissions: ConnectionPermissions;
}
export interface RunEvidence {
  state: "running" | "paused" | "stopped" | "error" | null;
  health: "healthy" | "degraded" | "paused" | null;
  positions: Array<{symbol:string;side:"long"|"short";quantity:string;entryPrice:string;markPrice:string;unrealizedPnl:string;leverage:string}>;
  openOrders: Array<{id:string;symbol:string;side:"buy"|"sell";state:string;quantity:string;price:string|null}>;
  pnl: string | null;
  heartbeatOccurredAt: number | null;
  heartbeatExpectedDeploymentVersion: number | null;
  lastSignal: { action: "enter" | "exit" | "hold"; reason: string; occurredAt: number; expectedDeploymentVersion: number } | null;
  riskBlocks: Array<{ code: string; reason: string; occurredAt: number; expectedDeploymentVersion: number }>;
}

interface ConnectionRow { status: string; hasLocalCredential: number | boolean; withdrawalAccessAbsent: number | boolean;
  version: number; verifiedAt: number | null; permissionsJson: string }
interface HeartbeatRow { state: "running" | "paused" | "stopped" | "error"; health: "healthy" | "degraded" | "paused"; summaryJson: string; occurredAt: number; payloadJson: string }
interface AuditRow { type: string; payloadJson: string; occurredAt: number }

const permissions = (value: string): ConnectionPermissions => {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (!parsed || Object.keys(parsed).sort().join(",") !== "futuresTrade,read,spotTrade,withdrawal"
    || parsed.read !== true || typeof parsed.spotTrade !== "boolean" || typeof parsed.futuresTrade !== "boolean"
    || parsed.withdrawal !== false) throw new Error("stored connection permissions are invalid");
  return parsed as unknown as ConnectionPermissions;
};
const DECIMAL=/^(?:0|[1-9]\d*)(?:\.\d+)?$/; const SIGNED=/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/; const SYMBOL=/^[A-Z0-9][A-Z0-9._:-]{1,63}$/;
const position=(value:unknown):RunEvidence["positions"][number]=>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("stored position is invalid");const p=value as Record<string,unknown>;if(Object.keys(p).sort().join(",")!=="entryPrice,leverage,markPrice,quantity,side,symbol,unrealizedPnl"||typeof p.symbol!=="string"||!SYMBOL.test(p.symbol)||(p.side!=="long"&&p.side!=="short")||typeof p.quantity!=="string"||!DECIMAL.test(p.quantity)||typeof p.entryPrice!=="string"||!DECIMAL.test(p.entryPrice)||typeof p.markPrice!=="string"||!DECIMAL.test(p.markPrice)||typeof p.unrealizedPnl!=="string"||!SIGNED.test(p.unrealizedPnl)||typeof p.leverage!=="string"||!DECIMAL.test(p.leverage))throw new Error("stored position is invalid");return{symbol:p.symbol,side:p.side as "long"|"short",quantity:p.quantity,entryPrice:p.entryPrice,markPrice:p.markPrice,unrealizedPnl:p.unrealizedPnl,leverage:p.leverage}};
const order=(value:unknown):RunEvidence["openOrders"][number]=>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("stored order is invalid");const o=value as Record<string,unknown>;if(Object.keys(o).sort().join(",")!=="id,price,quantity,side,state,symbol"||typeof o.id!=="string"||typeof o.symbol!=="string"||!SYMBOL.test(o.symbol)||(o.side!=="buy"&&o.side!=="sell")||typeof o.state!=="string"||o.state.length<1||o.state.length>64||typeof o.quantity!=="string"||!DECIMAL.test(o.quantity)||(o.price!==null&&(typeof o.price!=="string"||!DECIMAL.test(o.price))))throw new Error("stored order is invalid");return{id:o.id,symbol:o.symbol,side:o.side as "buy"|"sell",state:o.state,quantity:o.quantity,price:o.price as string|null}};
const ledger=(value:string,expectedVersion:number):Record<string,unknown>=>{const parsed=JSON.parse(value) as unknown;if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("stored audit payload is invalid");const item=parsed as Record<string,unknown>;if(Object.keys(item).sort().join(",")!=="expectedDeploymentVersion,payload,version"||item.version!==1||item.expectedDeploymentVersion!==expectedVersion||!item.payload||typeof item.payload!=="object"||Array.isArray(item.payload))throw new Error("stored audit payload is invalid");return item.payload as Record<string,unknown>};
const bounded=(value:unknown,label:string,max:number)=>{if(typeof value!=="string"||value.length<1||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new Error(`stored ${label} is invalid`);return value};
const signal=(row:AuditRow,expectedVersion:number):RunEvidence["lastSignal"]=>{const payload=ledger(row.payloadJson,expectedVersion);if(Object.keys(payload).sort().join(",")!=="action,price,quantity,reason,side,symbol"||(payload.action!=="enter"&&payload.action!=="exit"&&payload.action!=="hold")||typeof payload.symbol!=="string"||!SYMBOL.test(payload.symbol)||(payload.side!=="buy"&&payload.side!=="sell")||typeof payload.quantity!=="string"||!DECIMAL.test(payload.quantity)||(payload.price!==null&&(typeof payload.price!=="string"||!DECIMAL.test(payload.price))))throw new Error("stored signal payload is invalid");return{action:payload.action,reason:bounded(payload.reason,"signal reason",256),occurredAt:row.occurredAt,expectedDeploymentVersion:expectedVersion}};
const riskBlock=(row:AuditRow,expectedVersion:number):RunEvidence["riskBlocks"][number]=>{const payload=ledger(row.payloadJson,expectedVersion);if(Object.keys(payload).sort().join(",")!=="code,message,symbol"||(payload.symbol!==null&&(typeof payload.symbol!=="string"||!SYMBOL.test(payload.symbol))))throw new Error("stored risk payload is invalid");return{code:bounded(payload.code,"risk code",64),reason:bounded(payload.message,"risk message",512),occurredAt:row.occurredAt,expectedDeploymentVersion:expectedVersion}};
const addSignedDecimals=(values:string[]):string=>{let scale=0;const parts=values.map(value=>{const negative=value.startsWith("-");const raw=negative?value.slice(1):value;const [whole,fraction=""]=raw.split(".");scale=Math.max(scale,fraction.length);return{negative,whole:whole!,fraction}});let total=BigInt(0);for(const part of parts){const units=BigInt(part.whole+part.fraction.padEnd(scale,"0"));total+=part.negative?-units:units}const negative=total<BigInt(0);let digits=(negative?-total:total).toString().padStart(scale+1,"0");if(scale){const whole=digits.slice(0,-scale),fraction=digits.slice(-scale).replace(/0+$/,"");digits=fraction?`${whole}.${fraction}`:whole}return `${negative&&digits!=="0"?"-":""}${digits}`};

export function createLiveDataRepository(database: ControlPlaneDatabase) {
  return {
    async getMarketForUser(userId: string, strategyVersionId: string): Promise<"spot" | "futures" | null> {
      const row = await database.prepare(`SELECT s.market FROM strategy_versions sv
        JOIN strategies s ON s.id=sv.strategy_id AND s.user_id=sv.user_id
        WHERE sv.user_id=? AND sv.id=?`).bind(id(userId,"userId"),id(strategyVersionId,"strategyVersionId"))
        .first<{market:string}>();
      if (!row) return null;
      if (row.market !== "spot" && row.market !== "futures") throw new Error("stored strategy market is invalid");
      return row.market;
    },
    async getConnectionForUser(userId: string, deviceId: string): Promise<LiveConnectionRecord | null> {
      const row = await database.prepare(`SELECT c.status,c.has_local_credential AS hasLocalCredential,
        c.withdrawal_access_absent AS withdrawalAccessAbsent,c.version,c.verified_at AS verifiedAt,
        c.permissions_json AS permissionsJson FROM device_connections c JOIN devices d
        ON d.id=c.device_id AND d.user_id=c.user_id WHERE c.user_id=? AND c.device_id=? AND d.status='active'`)
        .bind(id(userId,"userId"),id(deviceId,"deviceId")).first<ConnectionRow>();
      if (!row) return null;
      if (row.status !== "verified" && row.status !== "erased") throw new Error("stored connection status is invalid");
      return { status: row.status, hasLocalCredential: Boolean(row.hasLocalCredential),
        withdrawalAccessAbsent: Boolean(row.withdrawalAccessAbsent), version: row.version,
        verifiedAt: row.verifiedAt, permissions: permissions(row.permissionsJson) };
    },
    async getEvidenceForUser(userId: string, deploymentId: string, expectedDeploymentVersion: number): Promise<RunEvidence> {
      const owner=id(userId,"userId"), target=id(deploymentId,"deploymentId");
      if(!Number.isSafeInteger(expectedDeploymentVersion)||expectedDeploymentVersion<1)throw new Error("expected deployment version is invalid");
      const heartbeat=await database.prepare(`SELECT h.state,h.health,h.summary_json AS summaryJson,h.occurred_at AS occurredAt,a.payload_json AS payloadJson
        FROM run_heartbeats h JOIN deployments d ON d.id=h.deployment_id AND d.user_id=h.user_id
        JOIN audit_events a ON a.id=h.id AND a.user_id=h.user_id AND a.actor_type='device' AND a.actor_id=h.device_id
          AND a.device_id=h.device_id AND a.deployment_id=h.deployment_id AND a.type='heartbeat'
        WHERE h.user_id=? AND h.deployment_id=? AND h.device_id=d.device_id AND d.version=?
          AND CAST(json_extract(a.payload_json,'$.expectedDeploymentVersion') AS INTEGER)=d.version
        ORDER BY h.sequence DESC LIMIT 1`).bind(owner,target,expectedDeploymentVersion).first<HeartbeatRow>();
      let positions: RunEvidence["positions"]=[];
      let heartbeatState:RunEvidence["state"]=null;
      if (heartbeat) {
        ledger(heartbeat.payloadJson,expectedDeploymentVersion);
        if(!["running","paused","stopped","error"].includes(heartbeat.state))throw new Error("stored heartbeat state is invalid");
        heartbeatState=heartbeat.state;
        const parsed=JSON.parse(heartbeat.summaryJson) as unknown;
        if (!parsed || typeof parsed!=="object" || Array.isArray(parsed)
          || !Array.isArray((parsed as {positions?:unknown}).positions)) throw new Error("stored heartbeat summary is invalid");
        const raw=(parsed as {positions:unknown[]}).positions;if(raw.length>100)throw new Error("stored position summary is too large");positions=raw.map(position);
      }
      const orders=await database.prepare(`SELECT id,symbol,side,state,quantity,price
        FROM orders o WHERE user_id=? AND deployment_id=? AND state IN ('proposed','submitting','acknowledged','partially-filled','cancel-pending','unknown','reconciled')
        AND EXISTS (SELECT 1 FROM audit_events a JOIN deployments d ON d.id=a.deployment_id AND d.user_id=a.user_id
          WHERE a.user_id=o.user_id AND a.deployment_id=o.deployment_id AND a.actor_type='device'
            AND a.type IN ('order-state','fill') AND d.version=?
            AND CAST(json_extract(a.payload_json,'$.expectedDeploymentVersion') AS INTEGER)=d.version
            AND json_extract(a.payload_json,'$.payload.order.id')=o.id)
        ORDER BY updated_at DESC,id DESC LIMIT 100`).bind(owner,target,expectedDeploymentVersion).all<unknown>();
      if (!orders.success) throw new Error("run evidence query failed");
      const lastSignalRow=await database.prepare(`SELECT a.type,a.payload_json AS payloadJson,a.occurred_at AS occurredAt
        FROM audit_events a JOIN deployments d ON d.id=a.deployment_id AND d.user_id=a.user_id
        WHERE a.user_id=? AND a.deployment_id=? AND a.actor_type='device' AND a.type='signal' AND d.version=?
          AND CAST(json_extract(a.payload_json,'$.expectedDeploymentVersion') AS INTEGER)=d.version
        ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1`).bind(owner,target,expectedDeploymentVersion).first<AuditRow>();
      const riskRows=await database.prepare(`SELECT a.type,a.payload_json AS payloadJson,a.occurred_at AS occurredAt
        FROM audit_events a JOIN deployments d ON d.id=a.deployment_id AND d.user_id=a.user_id
        WHERE a.user_id=? AND a.deployment_id=? AND a.actor_type='device' AND a.type='risk-block' AND d.version=?
          AND CAST(json_extract(a.payload_json,'$.expectedDeploymentVersion') AS INTEGER)=d.version
        ORDER BY a.occurred_at DESC,a.id DESC LIMIT 20`).bind(owner,target,expectedDeploymentVersion).all<AuditRow>();
      if(!riskRows.success)throw new Error("run risk evidence query failed");
      return { state:heartbeatState, health: heartbeat?.health ?? null, positions, openOrders: orders.results.map(order),
        pnl:heartbeat?addSignedDecimals(positions.map(item=>item.unrealizedPnl)):null,
        heartbeatOccurredAt:heartbeat?.occurredAt??null,
        heartbeatExpectedDeploymentVersion:heartbeat?expectedDeploymentVersion:null,
        lastSignal:lastSignalRow?signal(lastSignalRow,expectedDeploymentVersion):null,
        riskBlocks:riskRows.results.map(row=>riskBlock(row,expectedDeploymentVersion)) };
    },
  };
}
