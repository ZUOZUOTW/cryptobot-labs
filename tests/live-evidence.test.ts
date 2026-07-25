import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../db";
import { createLiveDataRepository } from "../db/repositories/live";

class Statement implements ControlPlaneStatement {
  constructor(private raw: StatementSync, private values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.raw, values); }
  async first<T>() { return (this.raw.get(...this.values as Parameters<StatementSync["get"]>) as T | undefined) ?? null; }
  async all<T>() { return { results: this.raw.all(...this.values as Parameters<StatementSync["all"]>) as T[], success: true }; }
  async run() { const result = this.raw.run(...this.values as Parameters<StatementSync["run"]>); return { success: true, meta: { changes: Number(result.changes) } }; }
}
class Database implements ControlPlaneDatabase {
  readonly raw = new DatabaseSync(":memory:");
  constructor() { this.raw.exec("PRAGMA foreign_keys=ON"); for (const file of readdirSync(resolve("drizzle")).filter((name) => name.endsWith(".sql")).sort()) for (const sql of readFileSync(resolve("drizzle", file), "utf8").split("--> statement-breakpoint")) if (sql.trim()) this.raw.exec(sql); }
  prepare(sql: string) { return new Statement(this.raw.prepare(sql)); }
  async batch<T extends readonly ControlPlaneStatement[]>(items: T): Promise<ControlPlaneRunResult[]> { return Promise.all(items.map((item) => item.run())); }
}
const ledger = (expectedDeploymentVersion: number, payload: object) => JSON.stringify({ version: 1, expectedDeploymentVersion, payload });
const position = (unrealizedPnl: string) => ({ symbol: "BTCUSDT", side: "long", quantity: "1", entryPrice: "100", markPrice: "101", unrealizedPnl, leverage: "2" });
const seed = (database: Database) => database.raw.exec(`
  INSERT INTO users (id,normalized_email,display_name,created_at,updated_at) VALUES ('usr_1','a@example.com','A',1,1),('usr_2','b@example.com','B',1,1);
  INSERT INTO devices (id,user_id,name,platform,public_key_jwk,status,paired_at,created_at,updated_at) VALUES ('dev_1','usr_1','A','macos','{}','active',1,1,1),('dev_2','usr_2','B','macos','{}','active',1,1,1);
  INSERT INTO strategies (id,user_id,name,market,symbol,created_at,updated_at) VALUES ('strategy_1','usr_1','A','futures','BTCUSDT',1,1);
  INSERT INTO strategy_versions (id,user_id,strategy_id,version,config_hash,config_json,created_at) VALUES ('version_1','usr_1','strategy_1',1,'${"a".repeat(64)}','{}',1);
  INSERT INTO deployments (id,user_id,device_id,strategy_version_id,name,mode,state,version,configuration_hash,created_at,updated_at) VALUES ('dep_1','usr_1','dev_1','version_1','A','paper','running',2,'${"b".repeat(64)}',1,1);
`);
const heartbeat = (database: Database, id: string, sequence: number, version: number, occurredAt: number, pnl: string) => {
  const summary = JSON.stringify({ health: "healthy", mode: "paper", realizedDailyPnl:"2",
    unrealizedDailyPnl:pnl,positions: [position(pnl)], state: "running" });
  database.raw.prepare("INSERT INTO audit_events (id,user_id,actor_type,actor_id,device_id,deployment_id,type,correlation_id,payload_json,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, "usr_1", "device", "dev_1", "dev_1", "dep_1", "heartbeat", `corr_${id}`, ledger(version, { heartbeat: { deploymentId: "dep_1" } }), occurredAt, occurredAt);
  database.raw.prepare("INSERT INTO run_heartbeats (id,user_id,deployment_id,device_id,sequence,mode,state,health,summary_json,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, "usr_1", "dep_1", "dev_1", sequence, "paper", "running", "healthy", summary, occurredAt);
};
const audit = (database: Database, id: string, type: "signal" | "risk-block", version: number, occurredAt: number, payload: object) => database.raw.prepare("INSERT INTO audit_events (id,user_id,actor_type,actor_id,device_id,deployment_id,type,correlation_id,payload_json,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
  .run(id, "usr_1", "device", "dev_1", "dev_1", "dep_1", type, `corr_${id}`, ledger(version, payload), occurredAt, occurredAt);

describe("current run evidence", () => {
  it("returns only owner-scoped evidence fenced to the requested current deployment version", async () => {
    const database = new Database(); seed(database);
    heartbeat(database, "hb_old", 1, 1, 100, "999"); heartbeat(database, "hb_current", 2, 2, 200, "3.50");
    audit(database, "sig_old", "signal", 1, 205, { symbol: "BTCUSDT", action: "enter", side: "buy", quantity: "1", price: "101", reason: "old" });
    audit(database, "sig_current", "signal", 2, 210, { symbol: "BTCUSDT", action: "hold", side: "buy", quantity: "1", price: null, reason: "current" });
    audit(database, "risk_old", "risk-block", 1, 215, { code: "OLD", symbol: null, message: "old" });
    audit(database, "risk_current", "risk-block", 2, 220, { code: "LIMIT", symbol: "BTCUSDT", message: "blocked" });
    const repository = createLiveDataRepository(database);
    await expect(repository.getEvidenceForUser("usr_1", "dep_1", 2)).resolves.toMatchObject({
      health: "healthy", pnl: "5.5", realizedPnl:"2",unrealizedPnl:"3.50",
      heartbeatOccurredAt: 200, heartbeatExpectedDeploymentVersion: 2,
      lastSignal: { action: "hold", reason: "current", occurredAt: 210, expectedDeploymentVersion: 2 },
      riskBlocks: [{ code: "LIMIT", reason: "blocked", occurredAt: 220, expectedDeploymentVersion: 2 }],
    });
    await expect(repository.getEvidenceForUser("usr_2", "dep_1", 2)).resolves.toMatchObject({ health: null, pnl: null, positions: [], lastSignal: null, riskBlocks: [] });
  });

  it("does not present a previous deployment version heartbeat as current evidence", async () => {
    const database = new Database(); seed(database); heartbeat(database, "hb_v2", 1, 2, 200, "7");
    database.raw.exec("UPDATE deployments SET version=3 WHERE id='dep_1'");
    await expect(createLiveDataRepository(database).getEvidenceForUser("usr_1", "dep_1", 3)).resolves.toMatchObject({
      health: null, pnl: null, positions: [], heartbeatOccurredAt: null, heartbeatExpectedDeploymentVersion: null,
    });
  });
});
