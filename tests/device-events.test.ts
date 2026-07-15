import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../db";
import { createActivityRepository, createDeploymentRepository } from "../db/repositories";
import { createDeviceEventService, parseDeviceEvent } from "../lib/server/device-events";

const base=(type:string,payload:unknown)=>({version:1,id:"evt_1",type,deploymentId:"dep_1",expectedDeploymentVersion:2,correlationId:"corr_1",occurredAt:100,payload});

class Statement implements ControlPlaneStatement { constructor(private raw:StatementSync,private values:unknown[]=[]){ } bind(...values:unknown[]){return new Statement(this.raw,values);} async first<T>(){return(this.raw.get(...this.values as Parameters<StatementSync["get"]>) as T|undefined)??null;} async all<T>(){return{results:this.raw.all(...this.values as Parameters<StatementSync["all"]>) as T[],success:true};} async run(){const result=this.raw.run(...this.values as Parameters<StatementSync["run"]>);return{success:true,meta:{changes:Number(result.changes)}};} }
class Database implements ControlPlaneDatabase { readonly raw=new DatabaseSync(":memory:"); constructor(){this.raw.exec("PRAGMA foreign_keys=ON");const file=readdirSync(resolve("drizzle")).find(name=>name.endsWith(".sql"))!;for(const sql of readFileSync(resolve("drizzle",file),"utf8").split("--> statement-breakpoint"))if(sql.trim())this.raw.exec(sql);} prepare(sql:string){return new Statement(this.raw.prepare(sql));} async batch<T extends readonly ControlPlaneStatement[]>(items:T):Promise<ControlPlaneRunResult[]>{this.raw.exec("BEGIN IMMEDIATE");try{const out=[];for(const item of items)out.push(await item.run());this.raw.exec("COMMIT");return out;}catch(error){this.raw.exec("ROLLBACK");throw error;}} }
const seed=(database:Database)=>database.raw.exec(`INSERT INTO users VALUES ('usr_1','a@example.com','A',1,1);INSERT INTO devices VALUES ('dev_1','usr_1','A','macos','{}','active',1,NULL,NULL,1,1);INSERT INTO strategies VALUES ('strategy_1','usr_1','A','spot','BTCUSDT',1,1);INSERT INTO strategy_versions VALUES ('version_1','usr_1','strategy_1',1,'${"a".repeat(64)}',NULL,'{}',NULL,1);INSERT INTO deployments VALUES ('dep_1','usr_1','dev_1','version_1','A','paper','running',2,'${"b".repeat(64)}',1,1,1,NULL);`);
const heartbeatEvent=()=>base("heartbeat",{heartbeat:{deploymentId:"dep_1",sequence:1,occurredAt:100,mode:"paper",state:"running",health:"healthy",realizedDailyPnl:"0",unrealizedDailyPnl:"0",positions:[]},positionIds:[]});
const fillEvent=()=>({...base("fill",{mode:"paper",deploymentState:"running",order:{id:"order_1",deploymentId:"dep_1",clientOrderId:"client_1",exchangeOrderId:"exchange_1",market:"spot",symbol:"BTCUSDT",side:"buy",positionSide:"net",orderType:"market",state:"filled",price:null,quantity:"1",filledQuantity:"1",averageFillPrice:"100",notional:"100",correlationId:"corr_fill",createdAt:90,updatedAt:100},fills:[{id:"fill_1",exchangeFillId:"exchange_fill_1",price:"100",quantity:"1",fee:"0.1",feeCurrency:"USDT",realizedPnl:null,filledAt:100}]}),id:"evt_fill",correlationId:"corr_fill"});

describe("device event boundary",()=>{
  it("accepts only exact envelopes and event types",()=>{
    expect(()=>parseDeviceEvent({...base("agent-error",{code:"E_AGENT",message:"offline",retryable:true}),extra:true})).toThrow(/fields/i);
    expect(()=>parseDeviceEvent(base("made-up",{}))).toThrow(/type/i);
    expect(parseDeviceEvent(base("agent-error",{code:"E_AGENT",message:"offline",retryable:true}))).toMatchObject({type:"agent-error",expectedDeploymentVersion:2});
  });
  it.each(["secretKey","pass_phrase","ＡＰＩ＿ＫＥＹ","authorization","access-sign","cookie","private-key","raw_account"])("rejects sensitive name %s recursively",(name)=>{
    expect(()=>parseDeviceEvent(base("agent-error",{code:"E",message:"safe",retryable:true,nested:{[name]:"value"}}))).toThrow(/forbidden|credential/i);
  });
  it("rejects secret-shaped values and only accepts a fixed masked suffix",()=>{
    expect(()=>parseDeviceEvent(base("agent-error",{code:"E",message:"Bearer abcdefghijklmnop",retryable:true}))).toThrow(/credential/i);
    expect(()=>parseDeviceEvent(base("key-rotated",{apiKeySuffix:"ABC123"}))).toThrow(/suffix/i);
    expect(parseDeviceEvent(base("key-rotated",{apiKeySuffix:"****A1B2"})).payload).toEqual({apiKeySuffix:"****A1B2"});
  });
  it.each(["apiSecret=abcdefghijklmnop", "passphrase: open-sesame", "cookie: session=abcdef123456",
    "api_key=abcdefghijklmnop", "accessKey: abcdefghijklmnop", "weex key=abcdefghijklmnop",
    "ａｐｉＫｅｙ＝abcdefghijklmnop", "ａｃｃｅｓｓ＿ｋｅｙ：abcdefghijklmnop",
    "raw cred_abcdefghijklmnopQRST", "bst_abcdefghijklmnopQRST", "Ab3dEf6hIj9lMn2pQr5tUv8xYz1Bcd4F"])("rejects credential material hidden in free text: %s",(message)=>{
    expect(()=>parseDeviceEvent(base("agent-error",{code:"E",message,retryable:false}))).toThrow(/credential/i);
  });
  it("requires coherent envelope, heartbeat, order, and fill identities and times",()=>{
    const heartbeat={deploymentId:"dep_1",sequence:1,occurredAt:99,mode:"paper",state:"running",health:"healthy",realizedDailyPnl:"0",unrealizedDailyPnl:"0",positions:[]};
    expect(()=>parseDeviceEvent(base("heartbeat",{heartbeat,positionIds:[]}))).toThrow(/timestamps/i);
    const order={id:"order_1",deploymentId:"dep_1",clientOrderId:"client_1",exchangeOrderId:"exchange_1",market:"spot",symbol:"BTCUSDT",side:"buy",positionSide:"net",orderType:"market",state:"filled",price:null,quantity:"1",filledQuantity:"1",averageFillPrice:"100",notional:"100",correlationId:"corr_wrong",createdAt:90,updatedAt:100};
    const fill={id:"fill_1",exchangeFillId:"exchange_fill_1",price:"100",quantity:"1",fee:"0.1",feeCurrency:"USDT",realizedPnl:null,filledAt:100};
    expect(()=>parseDeviceEvent(base("fill",{mode:"paper",deploymentState:"running",order,fills:[fill]}))).toThrow(/correlation/i);
    expect(()=>parseDeviceEvent(base("fill",{mode:"paper",deploymentState:"running",order:{...order,correlationId:"corr_1",updatedAt:99},fills:[fill]}))).toThrow(/timestamps/i);
    expect(()=>parseDeviceEvent(base("fill",{mode:"paper",deploymentState:"running",order:{...order,correlationId:"corr_1"},fills:[{...fill,filledAt:99}]}))).toThrow(/fill timestamps/i);
  });
  it("does not trust nested deployment identity and dispatches verified device identity",async()=>{
    expect(()=>parseDeviceEvent(base("heartbeat",{heartbeat:{deploymentId:"dep_other",sequence:1,occurredAt:100,mode:"paper",state:"running",health:"healthy",realizedDailyPnl:"0",unrealizedDailyPnl:"0",positions:[]},positionIds:[]}))).toThrow(/fence/i);
    const activity={getDeviceAuditByEventId:vi.fn().mockResolvedValue(null),appendDeviceAudit:vi.fn().mockResolvedValue({event:{id:"evt_1"},idempotent:false})};
    const deployments={getForDevice:vi.fn().mockResolvedValue({id:"dep_1",deviceId:"dev_verified",version:2})};
    const service=createDeviceEventService(activity as never,{deployments:deployments as never,now:()=>101});
    await service.ingest({verified:true,deviceId:"dev_verified"},base("agent-error",{code:"E",message:"safe",retryable:true}));
    expect(activity.appendDeviceAudit).toHaveBeenCalledWith(expect.objectContaining({deviceId:"dev_verified",deploymentId:"dep_1"}));
  });
  it("checks the expected deployment version before every dispatch",async()=>{
    const activity={getDeviceAuditByEventId:vi.fn().mockResolvedValue(null),appendDeviceAudit:vi.fn()};
    const deployments={getForDevice:vi.fn().mockResolvedValue({id:"dep_1",deviceId:"dev_1",version:3})};
    const service=createDeviceEventService(activity as never,{deployments:deployments as never,now:()=>100});
    await expect(service.ingest({verified:true,deviceId:"dev_1"},base("agent-error",{code:"E",message:"safe",retryable:true}))).rejects.toMatchObject({category:"deployment-fence"});
    expect(activity.appendDeviceAudit).not.toHaveBeenCalled();
  });
  it("does not misclassify transient storage failures as deployment fences",async()=>{
    const outage=new Error("temporary storage outage");
    const activity={getDeviceAuditByEventId:vi.fn().mockResolvedValue(null),appendDeviceAudit:vi.fn().mockRejectedValue(outage)};
    const deployments={getForDevice:vi.fn().mockResolvedValue({id:"dep_1",deviceId:"dev_1",version:2})};
    const service=createDeviceEventService(activity as never,{deployments:deployments as never,now:()=>100});
    await expect(service.ingest({verified:true,deviceId:"dev_1"},base("agent-error",{code:"E",message:"safe",retryable:true}))).rejects.toBe(outage);
  });
});

describe("device event sqlite ledger",()=>{
  it("atomically records telemetry and a global append-only exact-retry ledger",async()=>{const database=new Database();seed(database);const service=createDeviceEventService(createActivityRepository(database),{deployments:createDeploymentRepository(database),now:()=>100});expect((await service.ingest({verified:true,deviceId:"dev_1"},heartbeatEvent())).idempotent).toBe(false);expect(database.raw.prepare("SELECT count(*) AS count FROM run_heartbeats").get()).toEqual({count:1});expect(database.raw.prepare("SELECT count(*) AS count FROM audit_events").get()).toEqual({count:1});expect((await service.ingest({verified:true,deviceId:"dev_1"},heartbeatEvent())).idempotent).toBe(true);await expect(service.ingest({verified:true,deviceId:"dev_1"},{...heartbeatEvent(),type:"key-erased",payload:{reason:"different"}})).rejects.toMatchObject({category:"event-conflict"});expect(()=>database.raw.exec("UPDATE audit_events SET type='changed' WHERE id='evt_1'")).toThrow();});
  it("rolls ledger and telemetry back together when deployment version races after service precheck",async()=>{const database=new Database();seed(database);let raced=false;const racing:ControlPlaneDatabase={prepare:(sql)=>database.prepare(sql),batch:async(items)=>{if(!raced){raced=true;database.raw.exec("UPDATE deployments SET version=3 WHERE id='dep_1'");}return database.batch(items);}};const service=createDeviceEventService(createActivityRepository(racing),{deployments:createDeploymentRepository(database),now:()=>100});await expect(service.ingest({verified:true,deviceId:"dev_1"},heartbeatEvent())).rejects.toBeTruthy();expect(database.raw.prepare("SELECT count(*) AS count FROM run_heartbeats").get()).toEqual({count:0});expect(database.raw.prepare("SELECT count(*) AS count FROM audit_events").get()).toEqual({count:0});});
  it("atomically records an order, fills, and their exact event ledger",async()=>{const database=new Database();seed(database);const service=createDeviceEventService(createActivityRepository(database),{deployments:createDeploymentRepository(database),now:()=>100});expect((await service.ingest({verified:true,deviceId:"dev_1"},fillEvent())).idempotent).toBe(false);expect(database.raw.prepare("SELECT (SELECT count(*) FROM orders) AS orders_count,(SELECT count(*) FROM fills) AS fills_count,(SELECT count(*) FROM audit_events) AS audits_count").get()).toEqual({orders_count:1,fills_count:1,audits_count:1});expect((await service.ingest({verified:true,deviceId:"dev_1"},fillEvent())).idempotent).toBe(true);});
  it("atomically fences pure audit insertion by the expected deployment version",async()=>{const database=new Database();seed(database);database.raw.exec("UPDATE deployments SET version=3 WHERE id='dep_1'");const activity=createActivityRepository(database);await expect(activity.appendDeviceAudit({id:"evt_stale",deviceId:"dev_1",deploymentId:"dep_1",expectedDeploymentVersion:2,type:"agent-error",correlationId:"corr_stale",payload:{code:"E"},occurredAt:100,now:100})).rejects.toThrow(/owned|assigned/i);expect(database.raw.prepare("SELECT count(*) AS count FROM audit_events").get()).toEqual({count:0});});
  it("permanently recognizes an exact retry before mutable deployment and clock fences",async()=>{const database=new Database();seed(database);let now=100;const service=createDeviceEventService(createActivityRepository(database),{deployments:createDeploymentRepository(database),now:()=>now});await service.ingest({verified:true,deviceId:"dev_1"},heartbeatEvent());database.raw.exec("UPDATE deployments SET version=3 WHERE id='dep_1'");now=4_000_000_000;await expect(service.ingest({verified:true,deviceId:"dev_1"},heartbeatEvent())).resolves.toMatchObject({kind:"ledger",idempotent:true});await expect(service.ingest({verified:true,deviceId:"dev_1"},{...heartbeatEvent(),correlationId:"changed"})).rejects.toMatchObject({category:"event-conflict"});});
  it("recognizes E1 order retry after E2 has advanced the mutable order",async()=>{const database=new Database();seed(database);const service=createDeviceEventService(createActivityRepository(database),{deployments:createDeploymentRepository(database),now:()=>100});const order={id:"order_retry",deploymentId:"dep_1",clientOrderId:"client_retry",exchangeOrderId:"exchange_retry",market:"spot",symbol:"BTCUSDT",side:"buy",positionSide:"net",orderType:"market",state:"acknowledged",price:null,quantity:"2",filledQuantity:"0",averageFillPrice:null,notional:"200",correlationId:"corr_order",createdAt:90,updatedAt:100};const e1={...base("order-state",{mode:"paper",deploymentState:"running",order,fills:[]}),id:"evt_order_1",correlationId:"corr_order"};const fill={id:"fill_retry",exchangeFillId:"exchange_fill_retry",price:"100",quantity:"1",fee:"0.1",feeCurrency:"USDT",realizedPnl:null,filledAt:110};const e2={...base("fill",{mode:"paper",deploymentState:"running",order:{...order,state:"partially-filled",filledQuantity:"1",averageFillPrice:"100",updatedAt:110},fills:[fill]}),id:"evt_order_2",correlationId:"corr_order",occurredAt:110};await service.ingest({verified:true,deviceId:"dev_1"},e1);await service.ingest({verified:true,deviceId:"dev_1"},e2);await expect(service.ingest({verified:true,deviceId:"dev_1"},e1)).resolves.toMatchObject({kind:"ledger",idempotent:true});expect(database.raw.prepare("SELECT state,filled_quantity AS filledQuantity FROM orders WHERE id='order_retry'").get()).toEqual({state:"partially-filled",filledQuantity:"1"});});
  it("recognizes an old heartbeat exact retry after a newer snapshot",async()=>{const database=new Database();seed(database);const service=createDeviceEventService(createActivityRepository(database),{deployments:createDeploymentRepository(database),now:()=>100});const e1=heartbeatEvent();const e2={...heartbeatEvent(),id:"evt_2",occurredAt:110,payload:{heartbeat:{...(heartbeatEvent().payload as {heartbeat:Record<string,unknown>}).heartbeat,sequence:2,occurredAt:110},positionIds:[]}};await service.ingest({verified:true,deviceId:"dev_1"},e1);await service.ingest({verified:true,deviceId:"dev_1"},e2);await expect(service.ingest({verified:true,deviceId:"dev_1"},e1)).resolves.toMatchObject({kind:"ledger",idempotent:true});expect(database.raw.prepare("SELECT max(sequence) AS sequence FROM run_heartbeats").get()).toEqual({sequence:2});});
});
