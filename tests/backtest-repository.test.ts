import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../db";
import { createBacktestRepository } from "../db/repositories";

class SqliteStatement implements ControlPlaneStatement {
  constructor(private readonly statement: StatementSync, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]): ControlPlaneStatement { return new SqliteStatement(this.statement, values); }
  async first<T>(): Promise<T | null> {
    return (this.statement.get(...this.values as Parameters<StatementSync["get"]>) as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: this.statement.all(...this.values as Parameters<StatementSync["all"]>) as T[], success: true };
  }
  async run(): Promise<ControlPlaneRunResult> {
    const result = this.statement.run(...this.values as Parameters<StatementSync["run"]>);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SqliteDatabase implements ControlPlaneDatabase {
  readonly raw = new DatabaseSync(":memory:");
  constructor() {
    this.raw.exec("PRAGMA foreign_keys = ON");
    const migrationFile = readdirSync(resolve("drizzle")).find((file) => file.endsWith(".sql"));
    if (!migrationFile) throw new Error("migration missing");
    const migration = readFileSync(resolve("drizzle", migrationFile), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) this.raw.exec(statement);
  }
  prepare(sql: string): ControlPlaneStatement { return new SqliteStatement(this.raw.prepare(sql)); }
  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results: ControlPlaneRunResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
}

const request = (strategyVersionId: string) => ({
  strategyVersionId,
  market: "spot" as const,
  symbol: "BTCUSDT",
  interval: "1h",
  startTime: 1_000,
  endTime: 2_000,
  initialCapital: "1000",
  feeRate: "0.001",
  slippageRate: "0.0005",
  leverage: "1",
  fundingMode: "none" as const,
  gapPolicy: "fail" as const,
});

const completion = (suffix = "a") => ({
  completedAt: 500,
  dataset: {
    id: `dataset_${suffix}`,
    market: "spot" as const,
    symbol: "BTCUSDT",
    interval: "1h",
    source: "WEEX public market data",
    requestedStartAt: 1_000,
    requestedEndAt: 2_000,
    actualStartAt: 1_000,
    actualEndAt: 2_000,
    complete: true,
    gaps: [],
    checksum: "a".repeat(64),
    createdAt: 500,
  },
  result: {
    id: `result_${suffix}`,
    initialCapital: "1000",
    feeRate: "0.001",
    slippageRate: "0.0005",
    leverage: "1",
    funding: [],
    metrics: { totalReturn: "0.1" },
    provenance: { source: "WEEX public market data" },
    equityCurve: [{ at: 1_000, equity: "1000" }],
    engineVersion: "1.0.0",
    configurationHash: "b".repeat(64),
    strategyHash: "c".repeat(64),
    scriptHash: null,
    createdAt: 500,
  },
});

describe("backtest repository", () => {
  let database: SqliteDatabase;
  let repository: ReturnType<typeof createBacktestRepository>;

  beforeEach(() => {
    database = new SqliteDatabase();
    repository = createBacktestRepository(database);
    database.raw.exec(`
      INSERT INTO users VALUES ('usr_a', 'a@example.com', 'A', 1, 1), ('usr_b', 'b@example.com', 'B', 1, 1);
      INSERT INTO strategies VALUES
        ('strategy_a', 'usr_a', 'A', 'spot', 'BTCUSDT', 1, 1),
        ('strategy_b', 'usr_b', 'B', 'spot', 'BTCUSDT', 1, 1);
      INSERT INTO strategy_versions VALUES
        ('version_a', 'usr_a', 'strategy_a', 1, '${"a".repeat(64)}', NULL, '{}', NULL, 1),
        ('version_b', 'usr_b', 'strategy_b', 1, '${"b".repeat(64)}', NULL, '{}', NULL, 1);
    `);
  });

  const create = (id: string, userId = "usr_a", version = "version_a", now = 100) =>
    repository.createJob({ id, userId, request: request(version), now });

  const start = async (id: string, userId = "usr_a") => {
    expect(await repository.advanceStatus(userId, id, "queued", "fetching-data", 200)).not.toBeNull();
    expect(await repository.advanceStatus(userId, id, "fetching-data", "running", 300)).not.toBeNull();
  };

  it("creates only through an owned strategy version and never leaks cross-tenant rows", async () => {
    await expect(create("job_cross", "usr_a", "version_b")).rejects.toThrow(/owned/i);
    await create("job_a");
    expect(await repository.getById("usr_b", "job_a")).toBeNull();
    expect((await repository.list("usr_b", { limit: 10 })).items).toEqual([]);
    expect(await repository.advanceStatus("usr_b", "job_a", "queued", "fetching-data", 200)).toBeNull();
    expect((await repository.getById("usr_a", "job_a"))?.status).toBe("queued");
  });

  it("uses a bounded stable createdAt+id cursor", async () => {
    await create("job_a", "usr_a", "version_a", 100);
    await create("job_c", "usr_a", "version_a", 100);
    await create("job_b", "usr_a", "version_a", 90);
    const first = await repository.list("usr_a", { limit: 2 });
    expect(first.items.map((job) => job.id)).toEqual(["job_c", "job_a"]);
    expect(first.nextCursor).toEqual({ createdAt: 100, id: "job_a" });
    const second = await repository.list("usr_a", { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((job) => job.id)).toEqual(["job_b"]);
    await expect(repository.list("usr_a", { limit: 101 })).rejects.toThrow(/limit/);
  });

  it("enforces legal conditional status transitions and rejects stale writers", async () => {
    await create("job_a");
    await expect(repository.advanceStatus("usr_a", "job_a", "queued", "running", 200)).rejects.toThrow(/transition/i);
    expect(await repository.advanceStatus("usr_a", "job_a", "fetching-data", "running", 200)).toBeNull();
    expect(await repository.advanceStatus("usr_a", "job_a", "queued", "fetching-data", 200)).toMatchObject({ status: "fetching-data" });
    expect(await repository.advanceStatus("usr_a", "job_a", "queued", "fetching-data", 201)).toBeNull();
    expect(await repository.advanceStatus("usr_a", "job_a", "fetching-data", "running", 202)).toMatchObject({ status: "running" });
  });

  it("atomically persists dataset, result, and succeeded state and retries identical content idempotently", async () => {
    await create("job_a");
    await start("job_a");
    const first = await repository.completeSuccess("usr_a", "job_a", completion("a"));
    expect(first.idempotent).toBe(false);
    expect(first.job.status).toBe("succeeded");
    const again = await repository.completeSuccess("usr_a", "job_a", completion("a"));
    expect(again.idempotent).toBe(true);
    expect(database.raw.prepare("SELECT count(*) AS count FROM backtest_datasets WHERE backtest_job_id = 'job_a'").get()).toEqual({ count: 1 });
    expect(database.raw.prepare("SELECT count(*) AS count FROM backtest_results WHERE backtest_job_id = 'job_a'").get()).toEqual({ count: 1 });
    await expect(repository.completeSuccess("usr_a", "job_a", completion("different"))).rejects.toThrow(/conflict/i);
  });

  it("rolls the entire completion back when any result insert fails", async () => {
    await create("job_other");
    await start("job_other");
    await repository.completeSuccess("usr_a", "job_other", completion("collision"));

    await create("job_a");
    await start("job_a");
    const colliding = completion("a");
    colliding.result.id = "result_collision";
    await expect(repository.completeSuccess("usr_a", "job_a", colliding)).rejects.toThrow();
    expect(database.raw.prepare("SELECT count(*) AS count FROM backtest_datasets WHERE backtest_job_id = 'job_a'").get()).toEqual({ count: 0 });
    expect((await repository.getById("usr_a", "job_a"))?.status).toBe("running");
  });

  it("stores bounded failures only from running and never over an existing result", async () => {
    await create("job_a");
    expect(await repository.fail("usr_a", "job_a", "running", { code: "data-gap", message: "Candle gap", completedAt: 400 })).toBeNull();
    await start("job_a");
    expect(await repository.fail("usr_b", "job_a", "running", { code: "data-gap", message: "Candle gap", completedAt: 400 })).toBeNull();
    expect(await repository.fail("usr_a", "job_a", "running", { code: "data-gap", message: "Candle gap", completedAt: 400 }))
      .toMatchObject({ status: "failed", errorCode: "data-gap" });
    await expect(repository.fail("usr_a", "job_a", "failed", { code: "x", message: "x".repeat(513), completedAt: 401 }))
      .rejects.toThrow(/message/i);
  });
});
