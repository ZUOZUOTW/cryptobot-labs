import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../db";
import { createActivityRepository } from "../db/repositories";

class SqliteStatement implements ControlPlaneStatement {
  constructor(private readonly statement: StatementSync, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]): ControlPlaneStatement { return new SqliteStatement(this.statement, values); }
  async first<T>(): Promise<T | null> { return (this.statement.get(...this.values as Parameters<StatementSync["get"]>) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[]; success: boolean }> { return { results: this.statement.all(...this.values as Parameters<StatementSync["all"]>) as T[], success: true }; }
  async run(): Promise<ControlPlaneRunResult> { const result = this.statement.run(...this.values as Parameters<StatementSync["run"]>); return { success: true, meta: { changes: Number(result.changes) } }; }
}
class BeforeFirstStatement implements ControlPlaneStatement {
  constructor(private readonly inner: ControlPlaneStatement, private readonly before: () => Promise<void>) {}
  bind(...values: unknown[]): ControlPlaneStatement { return new BeforeFirstStatement(this.inner.bind(...values), this.before); }
  async first<T>(): Promise<T | null> { await this.before(); return this.inner.first<T>(); }
  all<T>(): Promise<{ results: T[]; success: boolean }> { return this.inner.all<T>(); }
  run(): Promise<ControlPlaneRunResult> { return this.inner.run(); }
}
class SqliteDatabase implements ControlPlaneDatabase {
  readonly raw = new DatabaseSync(":memory:");
  constructor() { this.raw.exec("PRAGMA foreign_keys=ON"); const file = readdirSync(resolve("drizzle")).find((name) => name.endsWith(".sql"))!;
    for (const sql of readFileSync(resolve("drizzle", file), "utf8").split("--> statement-breakpoint")) if (sql.trim()) this.raw.exec(sql); }
  prepare(sql: string): ControlPlaneStatement { return new SqliteStatement(this.raw.prepare(sql)); }
  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> { this.raw.exec("BEGIN IMMEDIATE");
    try { const rows=[]; for (const statement of statements) rows.push(await statement.run()); this.raw.exec("COMMIT"); return rows; }
    catch (error) { this.raw.exec("ROLLBACK"); throw error; } }
}

const heartbeat = (sequence: number, positions = [{ symbol: "BTCUSDT", side: "long" as const, quantity: "1",
  entryPrice: "100", markPrice: "101", unrealizedPnl: "1", leverage: "1" }]) => ({
  deploymentId: "dep_a", sequence, occurredAt: 1_000 + sequence, mode: "paper" as const,
  state: "running" as const, health: "healthy" as const, positions,
});

describe("activity repository", () => {
  let database: SqliteDatabase;
  let activity: ReturnType<typeof createActivityRepository>;
  beforeEach(() => {
    database = new SqliteDatabase(); activity = createActivityRepository(database);
    database.raw.exec(`
      INSERT INTO users VALUES ('usr_a','a@example.com','A',1,1),('usr_b','b@example.com','B',1,1);
      INSERT INTO devices VALUES ('dev_a','usr_a','A','macos','{}','active',1,NULL,NULL,1,1),('dev_b','usr_b','B','windows','{}','active',1,NULL,NULL,1,1);
      INSERT INTO strategies VALUES ('strategy_a','usr_a','A','spot','BTCUSDT',1,1),('strategy_b','usr_b','B','spot','BTCUSDT',1,1);
      INSERT INTO strategy_versions VALUES ('version_a','usr_a','strategy_a',1,'${"a".repeat(64)}',NULL,'{}',NULL,1),('version_b','usr_b','strategy_b',1,'${"b".repeat(64)}',NULL,'{}',NULL,1);
      INSERT INTO deployments VALUES ('dep_a','usr_a','dev_a','version_a','A','paper','running',2,'${"c".repeat(64)}',1,1,1,NULL),('dep_b','usr_b','dev_b','version_b','B','paper','running',1,'${"d".repeat(64)}',1,1,1,NULL);
    `);
  });

  it("ingests heartbeat and complete positions only for the assigned device and version fence", async () => {
    await expect(activity.ingestHeartbeat({ id: "hb_cross", deviceId: "dev_b", expectedDeploymentVersion: 2,
      positionIds: ["pos_cross"], heartbeat: heartbeat(1) })).rejects.toThrow(/assigned|version/i);
    await expect(activity.ingestHeartbeat({ id: "hb_stale", deviceId: "dev_a", expectedDeploymentVersion: 1,
      positionIds: ["pos_stale"], heartbeat: heartbeat(1) })).rejects.toThrow(/assigned|version/i);
    const result = await activity.ingestHeartbeat({ id: "hb_a", deviceId: "dev_a", expectedDeploymentVersion: 2,
      positionIds: ["pos_a"], heartbeat: heartbeat(1) });
    expect(result.idempotent).toBe(false);
    expect(database.raw.prepare("SELECT market,symbol,quantity FROM position_snapshots").all())
      .toEqual([{ market: "spot", symbol: "BTCUSDT", quantity: "1" }]);
  });

  it("atomically replaces all positions and retries identical telemetry idempotently", async () => {
    const first = { id: "hb_a", deviceId: "dev_a", expectedDeploymentVersion: 2,
      positionIds: ["pos_a"], heartbeat: heartbeat(1) };
    await activity.ingestHeartbeat(first);
    expect((await activity.ingestHeartbeat({ ...first, id: "hb_retry", positionIds: ["pos_retry"] })).idempotent).toBe(true);
    await activity.ingestHeartbeat({ id: "hb_b", deviceId: "dev_a", expectedDeploymentVersion: 2,
      positionIds: [], heartbeat: heartbeat(2, []) });
    expect(database.raw.prepare("SELECT count(*) AS count FROM position_snapshots WHERE deployment_id='dep_a'").get()).toEqual({ count: 0 });
    await expect(activity.ingestHeartbeat({ id: "hb_bad", deviceId: "dev_a", expectedDeploymentVersion: 2,
      positionIds: ["pos_collision"], heartbeat: heartbeat(3, [{ ...heartbeat(1).positions[0]!, quantity: "1e3" }]) }))
      .rejects.toThrow(/decimal|十進位/i);
    expect(database.raw.prepare("SELECT count(*) AS count FROM run_heartbeats WHERE sequence=3").get()).toEqual({ count: 0 });
  });

  it("rolls heartbeat insertion and position replacement back on a database collision", async () => {
    await activity.ingestHeartbeat({ id: "hb_a", deviceId: "dev_a", expectedDeploymentVersion: 2,
      positionIds: ["pos_a"], heartbeat: heartbeat(1) });
    database.raw.exec(`INSERT INTO position_snapshots VALUES
      ('pos_collision','usr_b','dep_b',NULL,'spot','BTCUSDT','long','1','100','100','0','1',1)`);
    await expect(activity.ingestHeartbeat({ id: "hb_b", deviceId: "dev_a", expectedDeploymentVersion: 2,
      positionIds: ["pos_collision"], heartbeat: heartbeat(2) })).rejects.toThrow();
    expect(database.raw.prepare("SELECT id FROM position_snapshots WHERE deployment_id='dep_a'").all()).toEqual([{ id: "pos_a" }]);
    expect(database.raw.prepare("SELECT count(*) AS count FROM run_heartbeats WHERE id='hb_b'").get()).toEqual({ count: 0 });
  });

  it("rejects sequence rollback, duplicate positions, version races, and old heartbeat ID reuse without changing current positions", async () => {
    await activity.ingestHeartbeat({ id: "hb_10", deviceId: "dev_a", expectedDeploymentVersion: 2,
      positionIds: ["pos_10"], heartbeat: heartbeat(10) });
    await expect(activity.ingestHeartbeat({ id: "hb_9", deviceId: "dev_a", expectedDeploymentVersion: 2,
      positionIds: ["pos_9"], heartbeat: heartbeat(9) })).rejects.toThrow(/sequence/i);
    const duplicated = [heartbeat(1).positions[0]!, { ...heartbeat(1).positions[0]!, quantity: "2" }];
    await expect(activity.ingestHeartbeat({ id: "hb_dup", deviceId: "dev_a", expectedDeploymentVersion: 2,
      positionIds: ["pos_dup_a", "pos_dup_b"], heartbeat: heartbeat(11, duplicated) })).rejects.toThrow(/duplicate/i);
    await expect(activity.ingestHeartbeat({ id: "hb_10", deviceId: "dev_a", expectedDeploymentVersion: 2,
      positionIds: ["pos_attack"], heartbeat: heartbeat(11) })).rejects.toThrow();
    expect(database.raw.prepare("SELECT id FROM position_snapshots WHERE deployment_id='dep_a'").all()).toEqual([{ id: "pos_10" }]);

    let raced = false;
    const racingDatabase: ControlPlaneDatabase = {
      prepare: (sql) => database.prepare(sql),
      batch: async (statements) => {
        if (!raced) { raced = true; database.raw.exec("UPDATE deployments SET version=3 WHERE id='dep_a'"); }
        return database.batch(statements);
      },
    };
    const racingActivity = createActivityRepository(racingDatabase);
    await expect(racingActivity.ingestHeartbeat({ id: "hb_race", deviceId: "dev_a", expectedDeploymentVersion: 2,
      positionIds: ["pos_race"], heartbeat: heartbeat(11) })).rejects.toThrow(/constraint|guard/i);
    expect(database.raw.prepare("SELECT id FROM position_snapshots WHERE deployment_id='dep_a'").all()).toEqual([{ id: "pos_10" }]);
  });

  it("appends scoped user/device audit and lists stable cursor ties without cross-tenant leaks", async () => {
    const base = { type: "run.started", correlationId: "corr_a", payload: { reason: "user" }, occurredAt: 500, now: 501 };
    await activity.appendUserAudit({ id: "audit_a", userId: "usr_a", deploymentId: "dep_a", deviceId: "dev_a", strategyVersionId: "version_a", ...base });
    await activity.appendUserAudit({ id: "audit_c", userId: "usr_a", deploymentId: "dep_a", deviceId: "dev_a", strategyVersionId: "version_a", ...base });
    await expect(activity.appendDeviceAudit({ id: "audit_spoof", deviceId: "dev_b", deploymentId: "dep_a", strategyVersionId: "version_a", ...base }))
      .rejects.toThrow(/owned|assigned/i);
    await expect(activity.appendUserAudit({ id: "audit_secret", userId: "usr_a", ...base,
      payload: { secretKey: "must-not-persist" } })).rejects.toThrow(/敏感|sensitive/i);
    await expect(activity.appendUserAudit({ id: "audit_actor_spoof", userId: "usr_a", actorId: "usr_b", ...base } as never))
      .rejects.toThrow(/unknown|sensitive/i);
    expect(await activity.getAuditForUser("usr_b", "audit_a")).toBeNull();
    const first = await activity.listAuditForUser("usr_a", { limit: 1 });
    expect(first.items.map((event) => event.id)).toEqual(["audit_c"]);
    expect((await activity.listAuditForUser("usr_a", { limit: 2, cursor: first.nextCursor! })).items.map((event) => event.id)).toEqual(["audit_a"]);
  });

  it("lists owner-scoped enriched activity with bounded time filters and stable cursors", async () => {
    const input = { type: "signal", correlationId: "corr_a", payload: { reason: "entry" }, now: 1_000 };
    await activity.appendUserAudit({ id: "audit_old", userId: "usr_a", deploymentId: "dep_a",
      strategyVersionId: "version_a", occurredAt: 100, ...input });
    await activity.appendUserAudit({ id: "audit_new", userId: "usr_a", deploymentId: "dep_a",
      strategyVersionId: "version_a", occurredAt: 200, ...input });
    await activity.appendUserAudit({ id: "audit_other", userId: "usr_b", deploymentId: "dep_b",
      strategyVersionId: "version_b", occurredAt: 200, ...input });
    const first = await activity.listActivityForUser("usr_a", { limit: 1, from: 100, to: 200 });
    expect(first.items).toMatchObject([{ id: "audit_new", deploymentConfigurationHash: "c".repeat(64),
      deploymentStrategyVersionId: "version_a", strategyVersion: 1, strategyConfigHash: "a".repeat(64) }]);
    expect((await activity.listActivityForUser("usr_a", { limit: 2, from: 100, to: 200,
      cursor: first.nextCursor! })).items.map((event) => event.id)).toEqual(["audit_old"]);
    expect((await activity.listActivityForUser("usr_b", { limit: 10 })).items.map((event) => event.id))
      .toEqual(["audit_other"]);
    await expect(activity.listActivityForUser("usr_a", { limit: 10, from: 201, to: 200 }))
      .rejects.toThrow(/range/i);
  });

  it("attributes order evidence only to order events in the same owned non-null deployment", async () => {
    database.raw.exec(`
      INSERT INTO deployments VALUES ('dep_other','usr_a','dev_a','version_a','Other','paper','running',2,
        '${"e".repeat(64)}',1,1,1,NULL);
      INSERT INTO orders (id,user_id,deployment_id,client_order_id,exchange_order_id,market,symbol,side,
        position_side,order_type,state,price,quantity,filled_quantity,average_fill_price,notional,
        correlation_id,created_at,updated_at) VALUES
        ('order_same','usr_a','dep_a','client_same','exchange_same','spot','BTCUSDT','buy','net','market',
          'acknowledged',NULL,'1','0',NULL,'100','corr_shared',90,100),
        ('order_other','usr_a','dep_other','client_other','exchange_other','spot','BTCUSDT','buy','net','market',
          'filled',NULL,'1','1','100','100','corr_shared',90,200),
        ('order_cross','usr_a','dep_other','client_cross','exchange_cross','spot','BTCUSDT','buy','net','market',
          'filled',NULL,'1','1','100','100','corr_cross',90,300);
    `);
    const common = { deviceId: "dev_a", expectedDeploymentVersion: 2, occurredAt: 300, now: 301 };
    await activity.appendDeviceAudit({ id: "evt_order", deploymentId: "dep_a", type: "order-state",
      correlationId: "corr_shared", payload: {}, ...common });
    await activity.appendDeviceAudit({ id: "evt_cross", deploymentId: "dep_a", type: "fill",
      correlationId: "corr_cross", payload: {}, ...common });
    await activity.appendDeviceAudit({ id: "evt_unrelated", deploymentId: "dep_a", type: "agent-error",
      correlationId: "corr_shared", payload: {}, ...common });
    await activity.appendUserAudit({ id: "evt_null_deployment", userId: "usr_a", type: "order-state",
      correlationId: "corr_shared", payload: {}, occurredAt: 300, now: 301 });

    const rows = (await activity.listActivityForUser("usr_a", { limit: 10 })).items;
    expect(rows.find((row) => row.id === "evt_order")).toMatchObject({
      clientOrderId: "client_same", exchangeOrderId: "exchange_same", orderStatus: "acknowledged",
    });
    for (const eventId of ["evt_cross", "evt_unrelated", "evt_null_deployment"]) {
      expect(rows.find((row) => row.id === eventId)).toMatchObject({
        clientOrderId: null, exchangeOrderId: null, orderStatus: null,
      });
    }
    expect(JSON.stringify(rows)).not.toContain("client_cross");
  });

  it("keeps audit rows immutable at the database boundary", async () => {
    await activity.appendUserAudit({ id: "audit_a", userId: "usr_a", type: "run.started", correlationId: "corr_a",
      payload: {}, occurredAt: 500, now: 501 });
    expect(() => database.raw.exec("UPDATE audit_events SET type='tampered' WHERE id='audit_a'")).toThrow(/append-only/i);
    expect(() => database.raw.exec("DELETE FROM audit_events WHERE id='audit_a'")).toThrow(/append-only/i);
  });

  it("makes user and device audit retries semantic and tenant scoped", async () => {
    const user = { id: "audit_user", userId: "usr_a", deploymentId: "dep_a", type: "run.started",
      correlationId: "corr_user", payload: { reason: "user" }, occurredAt: 500, now: 501 };
    expect((await activity.appendUserAudit(user)).idempotent).toBe(false);
    expect(await activity.appendUserAudit({ ...user, now: 999 }))
      .toMatchObject({ idempotent: true, event: { id: "audit_user", createdAt: 501 } });
    await expect(activity.appendUserAudit({ ...user, now: 999, payload: { reason: "other" } })).rejects.toThrow(/conflict/i);
    await expect(activity.appendUserAudit({ ...user, userId: "usr_b", now: 999 })).rejects.toThrow(/conflict/i);

    const device = { id: "audit_device", deviceId: "dev_a", deploymentId: "dep_a", type: "heartbeat.accepted",
      correlationId: "corr_device", payload: { sequence: 1 }, occurredAt: 600, now: 601 };
    expect((await activity.appendDeviceAudit(device)).idempotent).toBe(false);
    expect(await activity.appendDeviceAudit({ ...device, now: 777 }))
      .toMatchObject({ idempotent: true, event: { id: "audit_device", createdAt: 601 } });
  });

  it("authoritatively re-reads an audit winner after an interleaved insert constraint", async () => {
    const input = { id: "audit_race", userId: "usr_a", deploymentId: "dep_a", type: "run.started",
      correlationId: "corr_race", payload: { reason: "user" }, occurredAt: 700, now: 701 };
    const winner = createActivityRepository(database);
    let interleaved = false;
    const racingDatabase: ControlPlaneDatabase = {
      prepare: (sql) => {
        const statement = database.prepare(sql);
        if (!sql.includes("INSERT INTO audit_events")) return statement;
        return new BeforeFirstStatement(statement, async () => {
          if (!interleaved) { interleaved = true; await winner.appendUserAudit(input); }
        });
      },
      batch: (statements) => database.batch(statements),
    };
    const loser = createActivityRepository(racingDatabase);
    await expect(loser.appendUserAudit({ ...input, now: 999 })).resolves.toMatchObject({
      idempotent: true, event: { id: "audit_race", createdAt: 701 },
    });
  });
});
