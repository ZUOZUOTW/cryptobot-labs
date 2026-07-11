import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { webcrypto } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../db";
import { createActivityRepository, createDeploymentRepository } from "../db/repositories";
import { createAgentHandlers } from "../lib/server/agent-routes";
import { CommandServiceError } from "../lib/server/commands";
import { createDeviceEventService, DeviceEventError } from "../lib/server/device-events";
import {
  canonicalDeviceRequest, createDeviceRequestVerifier, createDeviceSignatureHeaders, DeviceAuthenticationError,
  sha256Hex, type DeviceCrypto,
} from "../lib/server/device-signature";

class Statement implements ControlPlaneStatement {
  constructor(private readonly statement: StatementSync, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.statement, values); }
  async first<T>() { return (this.statement.get(...this.values as Parameters<StatementSync["get"]>) as T | undefined) ?? null; }
  async all<T>() { return { results: this.statement.all(...this.values as Parameters<StatementSync["all"]>) as T[], success: true }; }
  async run() { const result = this.statement.run(...this.values as Parameters<StatementSync["run"]>); return { success: true, meta: { changes: Number(result.changes) } }; }
}
class Database implements ControlPlaneDatabase {
  readonly raw = new DatabaseSync(":memory:");
  constructor() {
    this.raw.exec("PRAGMA foreign_keys=ON");
    const migration = readdirSync(resolve("drizzle")).find((file) => file.endsWith(".sql"))!;
    for (const sql of readFileSync(resolve("drizzle", migration), "utf8").split("--> statement-breakpoint")) if (sql.trim()) this.raw.exec(sql);
  }
  prepare(sql: string) { return new Statement(this.raw.prepare(sql)); }
  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> {
    this.raw.exec("BEGIN IMMEDIATE");
    try { const results=[]; for(const statement of statements)results.push(await statement.run());this.raw.exec("COMMIT");return results; }
    catch(error){this.raw.exec("ROLLBACK");throw error;}
  }
}

const now = 1_700_000_000_000;
const identity = { userId: "usr_a", deviceId: "dev_a", capability: "agent.events" };
const event = (id: string, type = "signal") => ({ version: 1, id, type, deploymentId: "dep_a",
  expectedDeploymentVersion: 1, correlationId: `cor_${id}`, occurredAt: now,
  payload: { symbol: "BTCUSDT", action: "hold", side: "buy", quantity: "1", price: null, reason: "test" } });
const fakeDependencies = () => ({
  verify: vi.fn(async () => identity),
  eventService: { ingest: vi.fn(async () => ({ idempotent: false })) },
  commandService: {
    poll: vi.fn(async () => ({ items: [], nextCursor: null })),
    ack: vi.fn(async () => ({ acknowledgement: {}, idempotent: false })),
  },
});
const post = (path: string, value: string, headers: Record<string,string> = {}) => new Request(`https://labs.test${path}`, {
  method: "POST", body: value, headers: { "content-type": "application/json", ...headers },
});

describe("signed agent HTTP routes", () => {
  it("verifies exact raw bytes before fatal UTF-8/JSON parsing and uses only verified identity", async () => {
    const dependencies = fakeDependencies();
    dependencies.verify.mockImplementation(async (input) => {
      expect(new TextDecoder().decode(input.body)).toBe('{"not":"json"');
      expect(input.capability).toBe("agent.heartbeat");
      return { userId: "usr_verified", deviceId: "dev_verified", capability: input.capability };
    });
    const handler = createAgentHandlers(dependencies);
    const response = await handler.heartbeat(post("/api/agent/heartbeat", '{"not":"json"'));
    expect(response.status).toBe(400);
    expect(dependencies.verify).toHaveBeenCalledOnce();
    expect(dependencies.eventService.ingest).not.toHaveBeenCalled();

    dependencies.verify.mockImplementation(async (input) => ({ userId: "usr_verified", deviceId: "dev_verified", capability: input.capability }));
    const invalidUtf8 = new Request("https://labs.test/api/agent/heartbeat", { method:"POST",
      headers:{"content-type":"application/json"}, body:new Uint8Array([0xc3,0x28]) });
    expect((await handler.heartbeat(invalidUtf8)).status).toBe(400);
    expect(dependencies.verify).toHaveBeenCalledTimes(2);
  });

  it("keeps heartbeat separate and accepts idempotent batches with stable per-event ids", async () => {
    const dependencies = fakeDependencies();
    const seen = new Set<string>();
    dependencies.eventService.ingest.mockImplementation(async (_identity, value) => {
      const id = (value as {id:string}).id; const idempotent = seen.has(id); seen.add(id); return { idempotent };
    });
    const handlers = createAgentHandlers(dependencies);
    const misplaced = await handlers.events(post("/api/agent/events", JSON.stringify({events:[event("evt_a","heartbeat")] })));
    expect(misplaced.status).toBe(207);
    expect(await misplaced.json()).toEqual({results:[{index:0,eventId:"evt_a",status:"rejected",code:"invalid_event"}]});
    const body = JSON.stringify({ events: [event("evt_a"), event("evt_b")] });
    const first = await handlers.events(post("/api/agent/events", body));
    const retry = await handlers.events(post("/api/agent/events", body));
    expect(await first.json()).toEqual({results:[{index:0,eventId:"evt_a",status:"accepted",code:"accepted"},{index:1,eventId:"evt_b",status:"accepted",code:"accepted"}]});
    expect(await retry.json()).toEqual({results:[{index:0,eventId:"evt_a",status:"duplicate",code:"duplicate"},{index:1,eventId:"evt_b",status:"duplicate",code:"duplicate"}]});
    expect(dependencies.eventService.ingest).toHaveBeenCalledWith({deviceId:"dev_a",verified:true}, expect.anything());
    expect(JSON.stringify(await (await handlers.events(post("/api/agent/events", JSON.stringify({events:[event("evt_c")]})))).json())).not.toContain("payload");
  });

  it("maps event conflicts generically and enforces media, size, length, batch, and unknown-field bounds", async () => {
    const dependencies = fakeDependencies();
    dependencies.eventService.ingest.mockRejectedValue(new DeviceEventError("event-conflict", "SECRET payload conflict"));
    const handlers = createAgentHandlers(dependencies);
    const conflict = await handlers.events(post("/api/agent/events", JSON.stringify({events:[event("evt_a")]})));
    expect(conflict.status).toBe(207); expect(await conflict.text()).not.toContain("SECRET");
    expect((await handlers.events(post("/api/agent/events", "{}"))).status).toBe(400);
    expect((await handlers.events(post("/api/agent/events", JSON.stringify({events:[],extra:true})))).status).toBe(400);
    expect((await handlers.events(new Request("https://labs.test/api/agent/events", {method:"POST",body:"{}"}))).status).toBe(415);
    expect((await handlers.events(post("/api/agent/events", "{}", {"content-length":"9999999"}))).status).toBe(413);
    expect((await handlers.events(post("/api/agent/events", "{}", {"content-length":"3"}))).status).toBe(400);
  });

  it("continues a real SQLite-backed event batch after a fenced event and makes response-loss retries actionable", async () => {
    const database = new Database();
    database.raw.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run("usr_a","a@test","A",1,1);
    database.raw.prepare("INSERT INTO devices VALUES (?,?,?,?,?,'active',?,NULL,NULL,?,?)")
      .run("dev_a","usr_a","Mac","macos","{}",1,1,1);
    database.raw.prepare("INSERT INTO strategies VALUES (?,?,?,?,?,?,?)")
      .run("str_a","usr_a","S","spot","BTCUSDT",1,1);
    database.raw.prepare("INSERT INTO strategy_versions VALUES (?,?,?,?,?,?,?,?,?)")
      .run("sv_a","usr_a","str_a",1,"a".repeat(64),null,"{}",null,1);
    database.raw.prepare("INSERT INTO deployments VALUES (?,?,?,?,?,'paper','running',1,?,?,?,NULL,NULL)")
      .run("dep_a","usr_a","dev_a","sv_a","D","b".repeat(64),1,1);
    const dependencies = fakeDependencies();
    const nonces = new Set<string>();
    dependencies.verify.mockImplementation(async (input) => {
      const nonce = input.headers.get("x-test-nonce");
      if (!nonce || nonces.has(nonce)) throw new DeviceAuthenticationError();
      nonces.add(nonce);
      return { ...identity, capability: input.capability };
    });
    const service = createDeviceEventService(createActivityRepository(database), { deployments: createDeploymentRepository(database), now:()=>now });
    const handlers = createAgentHandlers({...dependencies,eventService:service});
    const fenced={...event("evt_real_b"),expectedDeploymentVersion:2};
    const body=JSON.stringify({events:[event("evt_real_a"),fenced,event("evt_real_c")]});
    const first=await handlers.events(post("/api/agent/events",body,{"x-test-nonce":"nonce_batch_1"}));
    expect(first.status).toBe(207);
    expect(await first.json()).toEqual({results:[
      {index:0,eventId:"evt_real_a",status:"accepted",code:"accepted"},
      {index:1,eventId:"evt_real_b",status:"rejected",code:"deployment_fence"},
      {index:2,eventId:"evt_real_c",status:"accepted",code:"accepted"},
    ]});
    expect(database.raw.prepare("SELECT count(*) AS count FROM audit_events").get()).toEqual({count:2});
    expect((await handlers.events(post("/api/agent/events",body,{"x-test-nonce":"nonce_batch_1"}))).status).toBe(401);
    const retry=await handlers.events(post("/api/agent/events",body,{"x-test-nonce":"nonce_batch_2"}));
    expect(await retry.json()).toEqual({results:[
      {index:0,eventId:"evt_real_a",status:"duplicate",code:"duplicate"},
      {index:1,eventId:"evt_real_b",status:"rejected",code:"deployment_fence"},
      {index:2,eventId:"evt_real_c",status:"duplicate",code:"duplicate"},
    ]});
  });

  it("marks unknown per-event failures retryable, keeps processing, and never reflects unsafe ids or secrets", async () => {
    const dependencies=fakeDependencies();
    dependencies.eventService.ingest.mockImplementation(async (_identity,value)=>{
      if((value as {id:string}).id==="evt_fail")throw new Error("SECRET database outage");return {idempotent:false};
    });
    const handlers=createAgentHandlers(dependencies);
    const unsafe={...event("evt_unused"),id:"unsafe id SECRET"};
    const response=await handlers.events(post("/api/agent/events",JSON.stringify({events:[event("evt_before"),event("evt_fail"),unsafe,event("evt_after")]})));
    expect(response.status).toBe(207);
    const text=await response.text();expect(text).not.toContain("SECRET");
    expect(JSON.parse(text).results).toEqual([
      {index:0,eventId:"evt_before",status:"accepted",code:"accepted"},
      {index:1,eventId:"evt_fail",status:"retryable",code:"internal"},
      {index:2,status:"accepted",code:"accepted"},
      {index:3,eventId:"evt_after",status:"accepted",code:"accepted"},
    ]);
    expect(dependencies.eventService.ingest).toHaveBeenCalledTimes(4);
  });

  it("signs the original GET query, rejects duplicates/body headers, and exposes only command contract fields", async () => {
    const dependencies = fakeDependencies();
    dependencies.commandService.poll.mockResolvedValue({items:[{id:"cmd_a",userId:"usr_SECRET",deviceId:"dev_SECRET",
      deploymentId:"dep_a",type:"pause",version:1,correlationId:"cor_a",expectedDeploymentVersion:2,
      payloadJson:'{"reason":"test"}',status:"pending",createdAt:2,expiresAt:3}],nextCursor:null});
    const handlers = createAgentHandlers(dependencies);
    const url = "https://labs.test/api/agent/commands?limit=10&cursorCreatedAt=5&cursorId=cmd_0";
    const response = await handlers.commands(new Request(url));
    expect(response.status).toBe(200);
    expect(dependencies.verify.mock.calls[0]![0]).toMatchObject({method:"GET",url,capability:"agent.commands.read"});
    expect(dependencies.verify.mock.calls[0]![0].body).toHaveLength(0);
    const text = await response.text(); expect(text).not.toContain("usr_SECRET");expect(text).not.toContain("dev_SECRET");
    expect(JSON.parse(text).commands[0]).toEqual({id:"cmd_a",deploymentId:"dep_a",type:"pause",version:1,
      correlationId:"cor_a",expectedDeploymentVersion:2,payload:{reason:"test"},createdAt:2,expiresAt:3});
    expect((await handlers.commands(new Request("https://labs.test/api/agent/commands?limit=1&limit=2"))).status).toBe(400);
    expect((await handlers.commands(new Request("https://labs.test/api/agent/commands?unknown=1"))).status).toBe(400);
    expect((await handlers.commands(new Request("https://labs.test/api/agent/commands", {headers:{"content-type":"application/json"}}))).status).toBe(400);
  });

  it("binds acknowledgements to the signed path and rejects body command ids, wrong fences, and unknown fields", async () => {
    const dependencies = fakeDependencies(); const handlers=createAgentHandlers(dependencies);
    const body={id:"ack_a",deploymentId:"dep_a",expectedDeploymentVersion:2,status:"ok",payload:{code:"ok",message:"done",applied:true}};
    const response=await handlers.ack(post("/api/agent/commands/cmd_a/ack",JSON.stringify(body)),{params:{id:"cmd_a"}});
    expect(response.status).toBe(200);
    expect(dependencies.commandService.ack).toHaveBeenCalledWith({deviceId:"dev_a",verified:true},{...body,commandId:"cmd_a"});
    expect(dependencies.verify.mock.calls[0]![0].url).toContain("/cmd_a/ack");
    expect((await handlers.ack(post("/api/agent/commands/cmd_a/ack",JSON.stringify({...body,commandId:"cmd_b"})),{params:{id:"cmd_a"}})).status).toBe(400);
    dependencies.commandService.ack.mockRejectedValueOnce(new CommandServiceError("deployment-fence","SECRET wrong device/version"));
    const fence=await handlers.ack(post("/api/agent/commands/cmd_a/ack",JSON.stringify(body)),{params:{id:"cmd_a"}});
    expect(fence.status).toBe(409);expect(await fence.text()).not.toContain("SECRET");
  });

  it("integrates real Ed25519 verification with SQLite and rejects tamper, replay, and revocation", async () => {
    const database=new Database(); const subtle=webcrypto.subtle as unknown as DeviceCrypto;
    const pair=await webcrypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]) as CryptoKeyPair;
    const jwk=await webcrypto.subtle.exportKey("jwk",pair.publicKey);delete jwk.alg;
    const credential=`cred_${Buffer.from(new Uint8Array(32).fill(7)).toString("base64url")}`;
    database.raw.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run("usr_a","a@test","A",1,1);
    database.raw.prepare("INSERT INTO devices VALUES (?,?,?,?,?,'active',?,NULL,NULL,?,?)")
      .run("dev_a","usr_a","Mac","macos",JSON.stringify(jwk),1,1,1);
    database.raw.prepare("INSERT INTO device_credentials VALUES (?,?,?,?,NULL,?)")
      .run("dev_a","usr_a",await sha256Hex(credential,subtle),now+1_000_000,1);
    const verify=createDeviceRequestVerifier({database,capabilities:["agent.heartbeat","agent.events","agent.commands.read","agent.commands.ack"],crypto:subtle,now:()=>now});
    const dependencies=fakeDependencies();const handlers=createAgentHandlers({...dependencies,verify});
    const body=JSON.stringify({...event("evt_heart","heartbeat"),payload:{}});
    const url="https://labs.test/api/agent/heartbeat";
    const signed=async(nonce:string,wire=body)=>{const bytes=new TextEncoder().encode(wire);const canonical=await canonicalDeviceRequest({method:"POST",url,timestamp:now,nonce,body:bytes,crypto:subtle});
      const signature=new Uint8Array(await webcrypto.subtle.sign({name:"Ed25519"},pair.privateKey,new TextEncoder().encode(canonical)));
      const headers=createDeviceSignatureHeaders({credential,deviceId:"dev_a",timestamp:now,nonce,signature:Buffer.from(signature).toString("base64url")});headers.set("content-type","application/json");return headers;};
    const headers=await signed("nonce_route_replay_123");
    const first=await handlers.heartbeat(new Request(url,{method:"POST",headers,body}));
    expect(first.status).toBe(200);
    expect((await handlers.heartbeat(new Request(url,{method:"POST",headers,body}))).status).toBe(401);
    const tamperHeaders=await signed("nonce_route_tamper_123");
    expect((await handlers.heartbeat(new Request(url,{method:"POST",headers:tamperHeaders,body:`${body} `}))).status).toBe(401);
    database.raw.prepare("UPDATE devices SET status='revoked',revoked_at=? WHERE id='dev_a'").run(now);
    const revokedHeaders=await signed("nonce_route_revoked_12");
    expect((await handlers.heartbeat(new Request(url,{method:"POST",headers:revokedHeaders,body}))).status).toBe(401);
  });
});
