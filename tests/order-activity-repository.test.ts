// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../db";
import { createActivityRepository } from "../db/repositories";

class Statement implements ControlPlaneStatement {
  constructor(private readonly raw: StatementSync, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]): ControlPlaneStatement { return new Statement(this.raw, values); }
  async first<T>(): Promise<T | null> { return (this.raw.get(...this.values as Parameters<StatementSync["get"]>) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[]; success: boolean }> { return { results: this.raw.all(...this.values as Parameters<StatementSync["all"]>) as T[], success: true }; }
  async run(): Promise<ControlPlaneRunResult> { const result=this.raw.run(...this.values as Parameters<StatementSync["run"]>); return { success:true, meta:{ changes:Number(result.changes) } }; }
}
class Database implements ControlPlaneDatabase {
  readonly raw=new DatabaseSync(":memory:");
  constructor(){ this.raw.exec("PRAGMA foreign_keys=ON"); const file=readdirSync(resolve("drizzle")).find((name)=>name.endsWith(".sql"))!;
    for(const sql of readFileSync(resolve("drizzle",file),"utf8").split("--> statement-breakpoint")) if(sql.trim()) this.raw.exec(sql); }
  prepare(sql:string):ControlPlaneStatement{return new Statement(this.raw.prepare(sql));}
  async batch<T extends readonly ControlPlaneStatement[]>(items:T):Promise<ControlPlaneRunResult[]>{this.raw.exec("BEGIN IMMEDIATE");try{const rows=[];for(const item of items)rows.push(await item.run());this.raw.exec("COMMIT");return rows;}catch(error){this.raw.exec("ROLLBACK");throw error;}}
}
const order=(state="acknowledged")=>({id:"order_a",deploymentId:"dep_a",clientOrderId:"client_a",exchangeOrderId:"exchange_a",
  market:"spot",symbol:"BTCUSDT",side:"buy",positionSide:"net",orderType:"market",state,price:null,quantity:"1",
  filledQuantity:state==="filled"?"1":"0",averageFillPrice:state==="filled"?"100":null,notional:"100",correlationId:"corr_a",createdAt:100,updatedAt:200});
const fill=()=>({id:"fill_a",exchangeFillId:"exchange_fill_a",price:"100",quantity:"1",fee:"0.1",feeCurrency:"USDT",realizedPnl:null,filledAt:210});

describe("order activity repository",()=>{
  let database:Database; let activity:ReturnType<typeof createActivityRepository>;
  beforeEach(()=>{database=new Database();activity=createActivityRepository(database);database.raw.exec(`
    INSERT INTO users VALUES ('usr_a','a@example.com','A',1,1),('usr_b','b@example.com','B',1,1);
    INSERT INTO devices VALUES ('dev_a','usr_a','A','macos','{}','active',1,NULL,NULL,1,1),('dev_b','usr_b','B','windows','{}','active',1,NULL,NULL,1,1);
    INSERT INTO strategies VALUES ('strategy_a','usr_a','A','spot','BTCUSDT',1,1),('strategy_b','usr_b','B','spot','BTCUSDT',1,1);
    INSERT INTO strategy_versions VALUES ('version_a','usr_a','strategy_a',1,'${"a".repeat(64)}',NULL,'{}',NULL,1),('version_b','usr_b','strategy_b',1,'${"b".repeat(64)}',NULL,'{}',NULL,1);
    INSERT INTO deployments VALUES ('dep_a','usr_a','dev_a','version_a','A','paper','running',2,'${"c".repeat(64)}',1,1,1,NULL),('dep_b','usr_b','dev_b','version_b','B','paper','running',1,'${"d".repeat(64)}',1,1,1,NULL);`);});
  const ingest=(overrides:Record<string,unknown>={})=>activity.ingestOrderTelemetry({deviceId:"dev_a",expectedDeploymentVersion:2,mode:"paper",deploymentState:"running",order:order(),fills:[],...overrides} as never);

  it("fences device/version and keeps user reads tenant scoped",async()=>{await expect(ingest({deviceId:"dev_b"})).rejects.toThrow(/assigned|version/i);await ingest();expect(await activity.getOrderForUser("usr_b","dep_a","client_a")).toBeNull();expect((await activity.listOrdersForUser("usr_a",{limit:10})).items).toHaveLength(1);});
  it("makes order identity semantic and rejects state regression",async()=>{expect((await ingest()).idempotent).toBe(false);expect((await ingest({order:{...order(),id:"retry"}})).idempotent).toBe(true);await expect(ingest({order:{...order(),symbol:"ETHUSDT"}})).rejects.toThrow(/conflict/i);await ingest({order:{...order("filled"),updatedAt:300}});await expect(ingest({order:{...order("acknowledged"),updatedAt:400}})).rejects.toThrow(/state|regress|terminal|immutable/i);});
  it("ingests fills atomically and makes exchange fill identity semantic",async()=>{const completed={...order("filled"),updatedAt:300};expect((await ingest({order:completed,fills:[fill()]})).idempotent).toBe(false);expect((await ingest({order:{...completed,id:"retry"},fills:[{...fill(),id:"retry_fill"}]})).idempotent).toBe(true);await expect(ingest({order:completed,fills:[{...fill(),fee:"0.2"}]})).rejects.toThrow(/conflict/i);expect(database.raw.prepare("SELECT count(*) AS count FROM fills").get()).toEqual({count:1});});
  it("rolls order and fills back together on a fill collision",async()=>{database.raw.exec(`INSERT INTO orders VALUES ('other','usr_b','dep_b','other_client','other_exchange','spot','BTCUSDT','buy','net','market','filled',NULL,'1','1','100','100','other_corr',1,1);INSERT INTO fills VALUES ('fill_collision','usr_b','dep_b','other','other_fill','100','1','0.1','USDT',NULL,1)`);await expect(ingest({order:order("filled"),fills:[{...fill(),id:"fill_collision"}]})).rejects.toThrow();expect(database.raw.prepare("SELECT count(*) AS count FROM orders WHERE deployment_id='dep_a'").get()).toEqual({count:0});});

  it("handles exact existing orders with new fills and mixed fill retries",async()=>{
    const completed={...order("filled"),updatedAt:300};
    await ingest({order:completed,fills:[]});
    expect((await ingest({order:{...completed,id:"retry"},fills:[fill()]})).idempotent).toBe(false);
    expect((await ingest({order:{...completed,id:"retry_two"},fills:[{...fill(),id:"retry_fill"}]})).idempotent).toBe(true);
  });

  it("rejects exchange identities reused by another order",async()=>{
    const completed={...order("filled"),updatedAt:300};
    await ingest({order:completed,fills:[fill()]});
    const another={...completed,id:"order_b",clientOrderId:"client_b",exchangeOrderId:"exchange_b",correlationId:"corr_b"};
    await expect(ingest({order:{...another,exchangeOrderId:"exchange_a"},fills:[]})).rejects.toThrow(/exchange order id/i);
    await expect(ingest({order:another,fills:[{...fill(),id:"fill_b"}]})).rejects.toThrow(/fill conflict|wrong order/i);
  });

  it("constraint-rolls back a precheck version race and lists stable cursor ties",async()=>{
    let raced=false;
    const racingDatabase:ControlPlaneDatabase={prepare:(sql)=>database.prepare(sql),batch:async(items)=>{
      if(!raced){raced=true;database.raw.exec("UPDATE deployments SET version=3 WHERE id='dep_a'");}
      return database.batch(items);
    }};
    const racing=createActivityRepository(racingDatabase);
    await expect(racing.ingestOrderTelemetry({deviceId:"dev_a",expectedDeploymentVersion:2,mode:"paper",deploymentState:"running",order:order(),fills:[]})).rejects.toThrow(/constraint|guard/i);
    expect(database.raw.prepare("SELECT count(*) AS count FROM orders WHERE deployment_id='dep_a'").get()).toEqual({count:0});
    database.raw.exec("UPDATE deployments SET version=2 WHERE id='dep_a'");
    await ingest();
    await ingest({order:{...order(),id:"order_c",clientOrderId:"client_c",exchangeOrderId:"exchange_c",correlationId:"corr_c"}});
    const first=await activity.listOrdersForUser("usr_a",{limit:1});
    expect(first.items.map((item)=>item.id)).toEqual(["order_c"]);
    expect((await activity.listOrdersForUser("usr_a",{limit:2,cursor:first.nextCursor!})).items.map((item)=>item.id)).toEqual(["order_a"]);
  });

  it("CAS-rejects an interleaved same-timestamp material update",async()=>{
    const initial={...order(),quantity:"2",notional:"200"};
    await ingest({order:initial});
    let raced=false;
    const racingDatabase:ControlPlaneDatabase={prepare:(sql)=>database.prepare(sql),batch:async(items)=>{
      if(!raced){raced=true;database.raw.exec("UPDATE orders SET state='partially-filled',filled_quantity='1.5',average_fill_price='101',updated_at=300 WHERE client_order_id='client_a'");}
      return database.batch(items);
    }};
    const racing=createActivityRepository(racingDatabase);
    await expect(racing.ingestOrderTelemetry({deviceId:"dev_a",expectedDeploymentVersion:2,mode:"paper",deploymentState:"running",
      order:{...initial,state:"partially-filled",filledQuantity:"1",averageFillPrice:"100",updatedAt:300},fills:[]})).rejects.toThrow(/conflict|guard/i);
    expect(database.raw.prepare("SELECT filled_quantity AS quantity FROM orders WHERE client_order_id='client_a'").get()).toEqual({quantity:"1.5"});
  });

  it("allows cancel-pending with no new fills without counting historical fills",async()=>{
    const partial={...order("partially-filled"),quantity:"2",notional:"200",filledQuantity:"1",averageFillPrice:"100",updatedAt:300};
    await ingest({order:partial,fills:[fill()]});
    await expect(ingest({order:{...partial,state:"cancel-pending",updatedAt:400},fills:[]})).resolves.toMatchObject({
      idempotent:false,order:{state:"cancel-pending"},
    });
    const pending={...order(),id:"order_pending",clientOrderId:"client_pending",exchangeOrderId:"exchange_pending",
      correlationId:"corr_pending",state:"cancel-pending",updatedAt:300};
    await ingest({order:pending,fills:[]});
    await expect(ingest({order:{...pending,state:"unknown",updatedAt:400},fills:[]})).rejects.toThrow(/state|illegal/i);
  });
});
