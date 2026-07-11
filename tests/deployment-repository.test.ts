import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../db";
import { createCommandRepository, createDeploymentRepository } from "../db/repositories";

class SqliteStatement implements ControlPlaneStatement {
  constructor(private readonly statement: StatementSync, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]): ControlPlaneStatement { return new SqliteStatement(this.statement, values); }
  async first<T>(): Promise<T | null> { return (this.statement.get(...this.values as Parameters<StatementSync["get"]>) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[]; success: boolean }> { return { results: this.statement.all(...this.values as Parameters<StatementSync["all"]>) as T[], success: true }; }
  async run(): Promise<ControlPlaneRunResult> { const result = this.statement.run(...this.values as Parameters<StatementSync["run"]>); return { success: true, meta: { changes: Number(result.changes) } }; }
}

class SqliteDatabase implements ControlPlaneDatabase {
  readonly raw = new DatabaseSync(":memory:");
  constructor() {
    this.raw.exec("PRAGMA foreign_keys = ON");
    const file = readdirSync(resolve("drizzle")).find((name) => name.endsWith(".sql"));
    if (!file) throw new Error("migration missing");
    for (const sql of readFileSync(resolve("drizzle", file), "utf8").split("--> statement-breakpoint")) if (sql.trim()) this.raw.exec(sql);
  }
  prepare(sql: string): ControlPlaneStatement { return new SqliteStatement(this.raw.prepare(sql)); }
  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> {
    this.raw.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.raw.exec("COMMIT"); return results; }
    catch (error) { this.raw.exec("ROLLBACK"); throw error; }
  }
}

const risk = (id = "risk_a") => ({
  id, allowedSymbols: ["BTCUSDT", "ETHUSDT"], maxOrderNotional: "100", maxPositionNotional: "500",
  maxTotalExposure: "1000", maxSimultaneousPositions: 3, maxDailyLoss: "50", maxLeverage: "2",
  maxSlippageBps: 50, minSignalCooldownMs: 1_000, maxConsecutiveFailures: 3,
  operationMode: "approval-required" as const,
});

describe("deployment, risk, and command repositories", () => {
  let database: SqliteDatabase;
  let deployments: ReturnType<typeof createDeploymentRepository>;
  let commands: ReturnType<typeof createCommandRepository>;

  beforeEach(() => {
    database = new SqliteDatabase();
    deployments = createDeploymentRepository(database);
    commands = createCommandRepository(database);
    database.raw.exec(`
      INSERT INTO users VALUES ('usr_a','a@example.com','A',1,1),('usr_b','b@example.com','B',1,1);
      INSERT INTO devices VALUES
        ('dev_a','usr_a','A','macos','{}','active',1,NULL,NULL,1,1),
        ('dev_b','usr_b','B','windows','{}','active',1,NULL,NULL,1,1);
      INSERT INTO strategies VALUES ('strategy_a','usr_a','A','spot','BTCUSDT',1,1),('strategy_b','usr_b','B','spot','BTCUSDT',1,1);
      INSERT INTO strategy_versions VALUES
        ('version_a','usr_a','strategy_a',1,'${"a".repeat(64)}',NULL,'{}',NULL,1),
        ('version_b','usr_b','strategy_b',1,'${"b".repeat(64)}',NULL,'{}',NULL,1);
    `);
  });

  const create = (overrides: Record<string, unknown> = {}) => deployments.create({
    id: "dep_a", userId: "usr_a", deviceId: "dev_a", strategyVersionId: "version_a", name: "Paper bot",
    mode: "paper", configurationHash: "c".repeat(64), risk: risk(), now: 100, ...overrides,
  } as never);

  it("atomically creates an owned deployment and strict risk policy", async () => {
    await expect(create({ deviceId: "dev_b" })).rejects.toThrow(/owned/i);
    expect(database.raw.prepare("SELECT count(*) AS count FROM deployments").get()).toEqual({ count: 0 });
    await expect(create({ risk: { ...risk(), maxOrderNotional: "1e3" } })).rejects.toThrow(/decimal/i);
    const created = await create();
    expect(created.deployment).toMatchObject({ id: "dep_a", version: 1, state: "stopped", mode: "paper" });
    expect(created.risk.allowedSymbolsJson).toBe('["BTCUSDT","ETHUSDT"]');
  });

  it("rolls deployment creation back when the risk insert conflicts", async () => {
    await create({ id: "dep_existing", risk: risk("risk_shared") });
    await expect(create({ id: "dep_collision", risk: risk("risk_shared") })).rejects.toThrow();
    expect(database.raw.prepare("SELECT count(*) AS count FROM deployments WHERE id='dep_collision'").get()).toEqual({ count: 0 });
  });

  it("separates user and assigned-device reads with stable bounded pagination", async () => {
    await create();
    expect(await deployments.getForUser("usr_b", "dep_a")).toBeNull();
    expect(await deployments.getForDevice("dev_b", "dep_a")).toBeNull();
    expect(await deployments.getForDevice("dev_a", "dep_a")).toMatchObject({ userId: "usr_a" });
    await expect(deployments.listForUser("usr_a", { limit: 101 })).rejects.toThrow(/limit/i);
    expect((await deployments.listForUser("usr_a", { limit: 1 })).items).toHaveLength(1);
  });

  it("uses a legal expected-version CAS and increments exactly once", async () => {
    await create();
    await expect(deployments.transitionState("usr_a", "dep_a", 1, "stopped", "paused", 200)).rejects.toThrow(/transition/i);
    expect(await deployments.transitionState("usr_b", "dep_a", 1, "stopped", "running", 200)).toBeNull();
    expect(await deployments.transitionState("usr_a", "dep_a", 1, "stopped", "running", 200)).toMatchObject({ state: "running", version: 2 });
    expect(await deployments.transitionState("usr_a", "dep_a", 1, "stopped", "running", 201)).toBeNull();
  });

  it("updates strict risk and deployment version in one CAS batch", async () => {
    await create();
    const updated = await deployments.updateRisk("usr_a", "dep_a", 1, { ...risk(), maxOrderNotional: "200" }, 200);
    expect(updated?.deployment.version).toBe(2);
    expect(updated?.risk.maxOrderNotional).toBe("200");
    expect(await deployments.updateRisk("usr_a", "dep_a", 1, risk(), 201)).toBeNull();
  });

  it("enqueues only owned, version-fenced commands and makes correlation idempotent", async () => {
    await create();
    const input = { id: "cmd_a", userId: "usr_a", deploymentId: "dep_a", type: "pause" as const, version: 1,
      correlationId: "corr_a", expectedDeploymentVersion: 1, payload: { reason: "user" }, now: 200, expiresAt: 300 };
    await expect(commands.enqueue({ ...input, userId: "usr_b" })).rejects.toThrow(/owned|version/i);
    expect((await commands.enqueue(input)).idempotent).toBe(false);
    expect((await commands.enqueue(input)).idempotent).toBe(true);
    await expect(commands.enqueue({ ...input, id: "cmd_b", type: "close-positions" })).rejects.toThrow(/conflict/i);
    await expect(commands.enqueue({ ...input, id: "cmd_c", correlationId: "corr_stale", expectedDeploymentVersion: 2 })).rejects.toThrow(/version/i);
  });

  it("polls only unexpired unacked commands for the assigned device", async () => {
    await create();
    await commands.enqueue({ id: "cmd_a", userId: "usr_a", deploymentId: "dep_a", type: "pause", version: 1,
      correlationId: "corr_a", expectedDeploymentVersion: 1, payload: {}, now: 200, expiresAt: 300 });
    expect((await commands.pollForDevice("dev_b", { now: 250, limit: 10 })).items).toEqual([]);
    expect((await commands.pollForDevice("dev_a", { now: 300, limit: 10 })).items).toEqual([]);
    expect((await commands.pollForDevice("dev_a", { now: 250, limit: 10 })).items.map((item) => item.id)).toEqual(["cmd_a"]);
    await deployments.updateRisk("usr_a", "dep_a", 1, risk(), 260);
    expect((await commands.pollForDevice("dev_a", { now: 261, limit: 10 })).items).toEqual([]);
  });

  it("acks atomically and idempotently only for the assigned device and matching version fence", async () => {
    await create();
    await commands.enqueue({ id: "cmd_a", userId: "usr_a", deploymentId: "dep_a", type: "pause", version: 1,
      correlationId: "corr_a", expectedDeploymentVersion: 1, payload: {}, now: 200, expiresAt: 300 });
    const ack = { id: "ack_a", deviceId: "dev_a", commandId: "cmd_a", deploymentId: "dep_a",
      expectedDeploymentVersion: 1, status: "ok" as const, payload: { applied: true }, now: 250 };
    expect(await commands.ack({ ...ack, deviceId: "dev_b" })).toBeNull();
    expect((await commands.ack(ack))?.idempotent).toBe(false);
    expect((await commands.ack(ack))?.idempotent).toBe(true);
    await expect(commands.ack({ ...ack, id: "ack_other", status: "failed" })).rejects.toThrow(/conflict/i);
    expect((await commands.pollForDevice("dev_a", { now: 251, limit: 10 })).items).toEqual([]);
  });
});
