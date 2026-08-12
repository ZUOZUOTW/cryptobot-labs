// @vitest-environment node

import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260812090000_enforce_cloud_run_target_exclusivity.sql";
const databaseUrl = process.env.POSTGRES_TEST_URL;

function localTestDatabase(value: string | undefined): URL | null {
  if (!value) return null;
  const parsed = new URL(value);
  const localHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  return localHost && parsed.pathname === "/cryptobot_test" ? parsed : null;
}

const target = localTestDatabase(databaseUrl);

if (process.env.CI && !target) {
  throw new Error("POSTGRES_TEST_URL must target the local cryptobot_test database in CI");
}

const describePostgres = target ? describe : describe.skip;

describePostgres("PostgreSQL cloud-run target rollout", () => {
  let sql: Sql<Record<string, never>>;
  let migration = "";

  beforeAll(async () => {
    sql = postgres(target!.toString(), { max: 2, prepare: false });
    migration = await readFile(migrationPath, "utf8");
    for (const role of ["anon", "authenticated", "service_role", "cryptobot_netlify", "cryptobot_executor"]) {
      const existing = await sql.unsafe("select 1 from pg_roles where rolname=$1", [role]);
      if (existing.length === 0) await sql.unsafe(`create role ${role} nologin`);
    }
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe("drop table if exists public.cloud_strategy_runs cascade");
    await sql.unsafe("drop schema if exists private cascade");
    await sql.end({ timeout: 5 });
  });

  async function resetBaseTable(): Promise<void> {
    await sql.unsafe("drop table if exists public.cloud_strategy_runs cascade");
    await sql.unsafe("drop schema if exists private cascade");
    await sql.unsafe("create schema private");
    await sql.unsafe(`create table public.cloud_strategy_runs (
      id text primary key,
      user_id text not null,
      connection_id text not null,
      state text not null check (state in ('running', 'paused', 'stopped', 'error')),
      config_json jsonb not null,
      risk_json jsonb not null
    )`);
  }

  async function insertOldWriter(
    id: string,
    symbol: string,
    state: "running" | "paused" | "stopped" | "error" = "running",
  ): Promise<void> {
    await sql.unsafe(`insert into public.cloud_strategy_runs
      (id,user_id,connection_id,state,config_json,risk_json)
      values ($1,'user_1','connection_1',$2,$3::jsonb,$4::jsonb)`, [
      id,
      state,
      JSON.stringify({ market: "futures", symbol }),
      JSON.stringify({ allowedSymbols: [symbol] }),
    ]);
  }

  it("keeps the pre-migration writer compatible and canonicalizes indexed targets", async () => {
    await resetBaseTable();
    await sql.unsafe(migration);

    await insertOldWriter("run_1", "BTC_USDT");
    const rows = await sql.unsafe(`select market,symbol,config_json,risk_json
      from public.cloud_strategy_runs where id='run_1'`);

    expect(rows[0]).toMatchObject({ market: "futures", symbol: "BTCUSDT" });
    expect(rows[0]?.config_json).toMatchObject({ market: "futures", symbol: "BTCUSDT" });
    expect(rows[0]?.risk_json).toMatchObject({ allowedSymbols: ["BTCUSDT"] });
  });

  it("rejects equivalent aliases under concurrency while allowing a stopped predecessor", async () => {
    await resetBaseTable();
    await sql.unsafe(migration);

    const results = await Promise.allSettled([
      insertOldWriter("run_a", "BTCUSDT"),
      insertOldWriter("run_b", "CMT_BTC_USDT", "paused"),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "23505", constraint_name: "cloud_runs_nonterminal_target_uidx" }),
    });

    await sql.unsafe("update public.cloud_strategy_runs set state='stopped'");
    await expect(insertOldWriter("run_c", "BTC/USDT", "error")).resolves.toBeUndefined();
  });

  it("fails the migration before constraints when legacy aliases already duplicate a live target", async () => {
    await resetBaseTable();
    await insertOldWriter("legacy_a", "BTC_USDT");
    await insertOldWriter("legacy_b", "CMT_BTCUSDT", "paused");

    await expect(sql.unsafe(migration)).rejects.toMatchObject({
      code: "23505",
      constraint_name: "cloud_runs_nonterminal_target_uidx",
    });

    const columns = await sql.unsafe(`select column_name,is_nullable
      from information_schema.columns
      where table_schema='public' and table_name='cloud_strategy_runs'
        and column_name in ('market','symbol') order by column_name`);
    expect(columns).toEqual([]);
  });

  it("derives target columns from config and prevents explicit-column bypasses", async () => {
    await resetBaseTable();
    await sql.unsafe(migration);

    await sql.unsafe(`insert into public.cloud_strategy_runs
      (id,user_id,connection_id,state,config_json,risk_json,market,symbol)
      values ('run_explicit','user_1','connection_1','running',
        '{"market":"futures","symbol":"ETH_USDT"}',
        '{"allowedSymbols":["CMT_ETHUSDT"]}',
        'spot','BTCUSDT')`);
    const rows = await sql.unsafe("select market,symbol,config_json,risk_json from public.cloud_strategy_runs");
    expect(rows[0]).toMatchObject({ market: "futures", symbol: "ETHUSDT" });
    expect(rows[0]?.config_json).toMatchObject({ symbol: "ETHUSDT" });
    expect(rows[0]?.risk_json).toMatchObject({ allowedSymbols: ["ETHUSDT"] });

    await expect(sql.unsafe(`update public.cloud_strategy_runs
      set market='spot',symbol='BTCUSDT' where id='run_explicit'`)).rejects.toMatchObject({
      code: "23514",
      constraint_name: "cloud_runs_target_from_config_check",
    });
  });

  it("can safely re-run its compatibility repair after an earlier target schema was applied", async () => {
    await resetBaseTable();
    await sql.unsafe("alter table public.cloud_strategy_runs add column market text, add column symbol text");
    await sql.unsafe(migration);
    await expect(sql.unsafe(migration)).resolves.toBeDefined();

    await insertOldWriter("run_rerun", "CMT_SOL_USDT");
    const rows = await sql.unsafe("select market,symbol,config_json from public.cloud_strategy_runs");
    expect(rows[0]).toMatchObject({ market: "futures", symbol: "SOLUSDT" });
    expect(rows[0]?.config_json).toMatchObject({ symbol: "SOLUSDT" });
  });
});
