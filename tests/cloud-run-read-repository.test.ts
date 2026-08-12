// @vitest-environment node

import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ControlPlaneDatabase,
  ControlPlaneRunResult,
  ControlPlaneStatement,
} from "../db";
import { createCloudRunRepository } from "../lib/server/cloud-runs";
import { STRATEGY_PRESETS } from "../data/strategies";
import { historicalConfigurationHash } from "../lib/historical-evidence";
import { validFormalEvidenceRow } from "./helpers/formal-evidence";

class Statement implements ControlPlaneStatement {
  private bindings: unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]): ControlPlaneStatement {
    this.bindings = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.statement.get(...this.bindings as SQLInputValue[]) as T | undefined ?? null;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: this.statement.all(...this.bindings as SQLInputValue[]) as T[], success: true };
  }

  async run(): Promise<ControlPlaneRunResult> {
    const result = this.statement.run(...this.bindings as SQLInputValue[]);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Database implements ControlPlaneDatabase {
  readonly raw = new DatabaseSync(":memory:");

  prepare(sql: string): ControlPlaneStatement {
    const sqliteSql = sql.replace(/\b([a-z_][a-z0-9_.]*)::text\b/gi, "cast($1 as text)");
    return new Statement(this.raw.prepare(sqliteSql));
  }

  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> {
    const results: ControlPlaneRunResult[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

const databases: Database[] = [];
const openDatabase = (): Database => {
  const database = new Database();
  databases.push(database);
  return database;
};

afterEach(() => {
  for (const database of databases.splice(0)) database.raw.close();
});

const createRunsTable = (database: Database) => database.raw.exec(`create table cloud_strategy_runs (
  id text primary key,
  user_id text not null,
  name text not null default 'Run',
  mode text not null default 'live',
  state text not null,
  market text not null default 'futures',
  symbol text not null default 'BTCUSDT',
  version integer not null default 1,
  last_candle_at integer,
  last_evaluated_at integer,
  last_signal_json text,
  last_error_code text,
  consecutive_failures integer not null default 0,
  created_at integer not null,
  updated_at integer not null default 1,
  risk_json text not null default '{"allowedSymbols":["BTCUSDT"],"maxTotalExposure":"100","maxDailyLoss":"10"}',
  account_asset text,
  account_observed_at integer,
  account_equity text,
  available_equity text,
  unrealized_pnl text,
  positions_json text not null default '[]',
  evaluation_count integer not null default 0,
  signal_count integer not null default 0,
  config_json text not null default '{"market":"futures","symbol":"BTCUSDT"}'
);`);

describe("cloud run read repository", () => {
  it("allows a cloud launch to reach persistence with exact formal evidence", async () => {
    const evidence = validFormalEvidenceRow();
    const persisted = {
      id: "cloud_1", name: "Verified", mode: "futures-demo" as const, state: "running" as const,
      market: "futures" as const, symbol: "BTCUSDT", version: 1, lastCandleAt: null,
      lastEvaluatedAt: null, lastSignalJson: null, lastErrorCode: null, consecutiveFailures: 0,
      createdAt: 5_000, updatedAt: 5_000, allowedSymbols: ["BTCUSDT"], accountAsset: null,
      accountObservedAt: null, accountEquity: null, availableEquity: null, unrealizedPnl: null,
      positionsJson: [], evaluationCount: 0, signalCount: 0, maxTotalExposure: "200", maxDailyLoss: "20",
    };
    let query = 0;
    const database: ControlPlaneDatabase = {
      prepare() {
        query += 1;
        return {
          bind() { return this; },
          async first<T>() { return (query === 1 ? evidence : persisted) as T; },
          async all<T>() { return { results: [] as T[], success: true }; },
          async run() { return { success: true, meta: { changes: 1 } }; },
        };
      },
      async batch() { return []; },
    };

    const run = await createCloudRunRepository(database).create({
      id: "cloud_1", userId: "user_1", strategyVersionId: evidence.strategyVersionId,
      name: "Verified", configurationHash: evidence.configHash, mode: "futures-demo",
      risk: { allowedSymbols: ["BTCUSDT"], maxOrderNotional: "25", maxPositionNotional: "100",
        maxTotalExposure: "200", maxSimultaneousPositions: 1, maxDailyLoss: "20", maxLeverage: "6",
        maxSlippageBps: 30, minSignalCooldownMs: 60_000, maxConsecutiveFailures: 3,
        operationMode: "automatic" },
      now: 5_000,
    });

    expect(run).toEqual(persisted);
    expect(query).toBe(2);
  });

  it("refuses launch when the only succeeded backtest has empty formal provenance", async () => {
    const database = openDatabase();
    const config = STRATEGY_PRESETS[0]!;
    const configHash = historicalConfigurationHash(config);
    database.raw.exec(`
      create table strategy_versions (id text,user_id text,config_hash text,source_hash text,
        config_json text,source_code text);
      create table backtest_jobs (id text,user_id text,strategy_version_id text,status text,
        evidence_level text,request_json text,completed_at integer);
      create table backtest_datasets (id text,user_id text,backtest_job_id text,market text,symbol text,
        interval text,source text,requested_start_at integer,requested_end_at integer,
        actual_start_at integer,actual_end_at integer,complete integer,gaps_json text,checksum text);
      create table backtest_results (id text,user_id text,backtest_job_id text,dataset_id text,
        evidence_level text,initial_capital text,fee_rate text,slippage_rate text,leverage text,
        funding_json text,metrics_json text,provenance_json text,equity_curve_json text,
        engine_version text,configuration_hash text,strategy_hash text,script_hash text);
    `);
    database.raw.prepare(`insert into strategy_versions values (?,?,?,?,?,?)`)
      .run("version_1", "user_1", configHash, null, JSON.stringify(config), null);
    database.raw.prepare(`insert into backtest_jobs values (?,?,?,?,?,?,?)`).run(
      "job_1", "user_1", "version_1", "succeeded", "historical",
      JSON.stringify({ strategyVersionId: "version_1", market: config.market, symbol: config.symbol,
        interval: config.timeframe, startTime: 1_000, endTime: 3_000, initialCapital: "10000",
        feeRate: "0.001", slippageRate: "0.0005", leverage: String(config.leverage),
        fundingMode: "none", gapPolicy: "fail" }),
      4_000,
    );
    database.raw.prepare(`insert into backtest_datasets values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "dataset_1", "user_1", "job_1", config.market, config.symbol, config.timeframe, "WEEX public API",
      1_000, 3_000, 1_000, 2_999, 1, "[]", "b".repeat(64),
    );
    database.raw.prepare(`insert into backtest_results values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "result_1", "user_1", "job_1", "dataset_1", "historical", "10000", "0.001", "0.0005",
      String(config.leverage), JSON.stringify({ mode: "none", events: [] }), JSON.stringify({}), "{}",
      JSON.stringify([{ timestamp: 1_000, equity: "10000" }, { timestamp: 2_999, equity: "10000" }]),
      "test", configHash, configHash, null,
    );

    const run = await createCloudRunRepository(database).create({
      id: "cloud_1",
      userId: "user_1",
      strategyVersionId: "version_1",
      name: "Invalid evidence",
      configurationHash: configHash,
      mode: "futures-demo",
      risk: {
        allowedSymbols: [config.symbol], maxOrderNotional: "25", maxPositionNotional: "100",
        maxTotalExposure: "200", maxSimultaneousPositions: 1, maxDailyLoss: "20", maxLeverage: "6",
        maxSlippageBps: 30, minSignalCooldownMs: 60_000, maxConsecutiveFailures: 3,
        operationMode: "automatic",
      },
      now: 5_000,
    });

    expect(run).toBeNull();
  });

  it("keeps an older non-stopped run after 101 newer stopped rows without crossing tenants", async () => {
    const database = openDatabase();
    createRunsTable(database);
    const insert = database.raw.prepare(`insert into cloud_strategy_runs
      (id,user_id,state,created_at) values (?,?,?,?)`);
    for (let index = 1; index <= 101; index += 1) {
      const createdAt = index >= 100 ? 1_101 : 1_000 + index;
      insert.run(`stopped_${String(index).padStart(3, "0")}`, "user_1", "stopped", createdAt);
    }
    insert.run("running_old", "user_1", "running", 1);
    insert.run("other_tenant_running", "user_2", "running", 2_000);
    insert.run("other_tenant_stopped", "user_2", "stopped", 2_001);

    const rows = await createCloudRunRepository(database).list("user_1");

    expect(rows).toHaveLength(101);
    expect(rows.map(({ id }) => id)).toContain("running_old");
    expect(rows.map(({ id }) => id)).not.toContain("stopped_001");
    expect(rows.map(({ id }) => id)).not.toContain("other_tenant_running");
    expect(rows.slice(0, 2).map(({ id }) => id)).toEqual(["stopped_101", "stopped_100"]);
    expect(rows.at(-1)?.id).toBe("running_old");
  });

  it("buckets 00:30 Asia/Taipei into the new local day", async () => {
    const database = openDatabase();
    database.raw.exec(`create table weex_realized_pnl_ledger (
      connection_id text not null,user_id text not null,net_pnl numeric not null,traded_at integer not null
    );`);
    const insert = database.raw.prepare(`insert into weex_realized_pnl_ledger
      (connection_id,user_id,net_pnl,traded_at) values (?,?,?,?)`);
    insert.run("connection_1", "user_1", 2, Date.parse("2026-01-01T23:30:00+08:00"));
    insert.run("connection_1", "user_1", 3, Date.parse("2026-01-02T00:30:00+08:00"));
    insert.run("connection_1", "other_user", 100, Date.parse("2026-01-02T00:30:00+08:00"));

    const series = await createCloudRunRepository(database).realizedPnl("user_1", "connection_1");

    expect(series).toEqual({
      total: "5",
      tradeCount: 2,
      points: [
        {
          observedAt: Date.parse("2026-01-01T00:00:00+08:00"),
          netPnl: "2",
          cumulativeNetPnl: "2",
          tradeCount: 1,
        },
        {
          observedAt: Date.parse("2026-01-02T00:00:00+08:00"),
          netPnl: "3",
          cumulativeNetPnl: "5",
          tradeCount: 1,
        },
      ],
    });
  });

  it("returns days 3 through 368 while preserving all-time totals", async () => {
    const database = openDatabase();
    database.raw.exec(`create table weex_realized_pnl_ledger (
      connection_id text not null,user_id text not null,net_pnl numeric not null,traded_at integer not null
    );`);
    const insert = database.raw.prepare(`insert into weex_realized_pnl_ledger
      (connection_id,user_id,net_pnl,traded_at) values (?,?,?,?)`);
    const firstTradeAt = Date.parse("2025-01-01T00:30:00+08:00");
    for (let day = 0; day < 368; day += 1) {
      insert.run("connection_1", "user_1", 1, firstTradeAt + day * 86_400_000);
    }

    const series = await createCloudRunRepository(database).realizedPnl("user_1", "connection_1");

    expect(series.points).toHaveLength(366);
    expect(series.points[0]).toMatchObject({
      observedAt: Date.parse("2025-01-03T00:00:00+08:00"),
      cumulativeNetPnl: "3",
    });
    expect(series.points.at(-1)).toMatchObject({ cumulativeNetPnl: "368" });
    expect(series).toMatchObject({ total: "368", tradeCount: 368 });
  });
});
