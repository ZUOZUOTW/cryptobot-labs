// @vitest-environment node

import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260812072739_add_strategy_publication_discovery_projection.sql";
const databaseUrl = process.env.POSTGRES_TEST_URL;

function localTestDatabase(value: string | undefined): URL | null {
  if (!value) return null;
  const parsed = new URL(value);
  const localHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  return localHost && parsed.pathname === "/cryptobot_test" ? parsed : null;
}

const target = localTestDatabase(databaseUrl);
if (process.env.REQUIRE_POSTGRES_TEST === "true" && !target) {
  throw new Error("POSTGRES_TEST_URL must target the local cryptobot_test database in CI");
}
const describePostgres = target ? describe : describe.skip;

describePostgres("PostgreSQL strategy discovery projection rollout", () => {
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
    for (const table of [
      "strategy_publications", "backtest_results", "backtest_datasets", "backtest_jobs", "strategy_versions", "strategies",
    ]) await sql.unsafe(`drop table if exists public.${table} cascade`);
    await sql.end({ timeout: 5 });
  });

  async function resetBaseTables(): Promise<void> {
    for (const table of [
      "strategy_publications", "backtest_results", "backtest_datasets", "backtest_jobs", "strategy_versions", "strategies",
    ]) await sql.unsafe(`drop table if exists public.${table} cascade`);
    await sql.unsafe("drop function if exists public.derive_strategy_publication_discovery_projection() cascade");
    await sql.unsafe(`create table public.strategies (
      id text primary key,user_id text not null,name text not null,market text not null,symbol text not null
    )`);
    await sql.unsafe(`create table public.strategy_versions (
      id text primary key,user_id text not null,strategy_id text not null,config_hash text not null,
      source_hash text,config_json text not null
    )`);
    await sql.unsafe(`create table public.backtest_jobs (
      id text primary key,user_id text not null,strategy_version_id text not null,status text not null,evidence_level text not null
    )`);
    await sql.unsafe(`create table public.backtest_datasets (
      id text primary key,user_id text not null,backtest_job_id text not null,complete integer not null,gaps_json text not null
    )`);
    await sql.unsafe(`create table public.backtest_results (
      id text primary key,user_id text not null,backtest_job_id text not null,dataset_id text not null,
      evidence_level text not null,configuration_hash text not null,strategy_hash text not null,script_hash text,
      metrics_json text not null
    )`);
    await sql.unsafe(`create table public.strategy_publications (
      id text primary key,user_id text not null,strategy_version_id text not null,backtest_job_id text not null,
      slug text not null,description text not null,publisher_name text not null,weex_referral_url text,
      published_at bigint not null,updated_at bigint not null
    )`);
    await sql.unsafe(`insert into public.strategies values ('strategy_a','user_a','Needle Momentum','futures','BTCUSDT')`);
    await sql.unsafe(`insert into public.strategy_versions values (
      'version_a','user_a','strategy_a',$1,null,$2
    )`, ["a".repeat(64), JSON.stringify({ name: "Needle Momentum", market: "futures", symbol: "BTCUSDT", timeframe: "4h", leverage: 4 })]);
    await sql.unsafe(`insert into public.backtest_jobs values ('job_a','user_a','version_a','succeeded','historical')`);
    await sql.unsafe(`insert into public.backtest_datasets values ('dataset_a','user_a','job_a',1,'[]')`);
    await sql.unsafe(`insert into public.backtest_results values (
      'result_a','user_a','job_a','dataset_a','historical',$1,$1,null,$2
    )`, ["a".repeat(64), JSON.stringify({ totalReturn: "0.25", maxDrawdown: "-0.13", winRate: "0.60", sharpe: "1.2", trades: 80 })]);
  }

  it("backfills old writers and prevents callers from spoofing indexed discovery values", async () => {
    await resetBaseTables();
    await sql.unsafe(`create function public.derive_strategy_publication_discovery_projection()
      returns trigger language plpgsql as $$ begin return new; end $$`);
    await sql.unsafe(`grant execute on function public.derive_strategy_publication_discovery_projection()
      to service_role,cryptobot_executor`);
    await sql.unsafe(`insert into public.strategy_publications values (
      'publication_old','user_a','version_a','job_a','strategy-oldrelease',
      'A complete formal historical strategy','Alice',null,10,10
    )`);
    await sql.unsafe(`insert into public.strategy_publications values (
      'publication_legacy_invalid','user_a','version_a','missing_job','strategy-invalidlegacy',
      'Legacy row without complete evidence','Alice',null,9,9
    )`);
    await sql.unsafe(migration);

    const backfilled = await sql.unsafe(`select discovery_market,discovery_timeframe,discovery_risk,search_text,
      discovery_total_return,discovery_max_drawdown,discovery_win_rate
      from public.strategy_publications where id='publication_old'`);
    expect(backfilled[0]).toMatchObject({
      discovery_market: "futures",
      discovery_timeframe: "4h",
      discovery_risk: "中",
      discovery_total_return: 0.25,
      discovery_max_drawdown: 0.13,
      discovery_win_rate: 0.6,
    });
    expect(backfilled[0]?.search_text).toContain("needle momentum");
    const invalidLegacy = await sql.unsafe(`select search_text,discovery_recommended
      from public.strategy_publications where id='publication_legacy_invalid'`);
    expect(invalidLegacy[0]).toMatchObject({ search_text: "", discovery_recommended: 0 });

    await sql.unsafe(`insert into public.strategy_publications (
      id,user_id,strategy_version_id,backtest_job_id,slug,description,publisher_name,
      discovery_market,discovery_timeframe,discovery_risk,search_text,discovery_total_return,
      discovery_max_drawdown,discovery_win_rate,discovery_stability,discovery_recommended,published_at,updated_at
    ) values (
      'publication_spoof','user_a','version_a','job_a','strategy-spoofrelease','Formal evidence','Alice',
      'spot','1m','低','spoof',999,0,1,100,999,11,11
    )`);
    const spoofed = await sql.unsafe(`select discovery_market,discovery_timeframe,discovery_risk,discovery_total_return
      from public.strategy_publications where id='publication_spoof'`);
    expect(spoofed[0]).toMatchObject({
      discovery_market: "futures",
      discovery_timeframe: "4h",
      discovery_risk: "中",
      discovery_total_return: 0.25,
    });
  });

  it("installs the bounded query indexes and least-privilege invoker trigger function", async () => {
    const indexes = await sql.unsafe(`select indexname from pg_indexes
      where schemaname='public' and tablename='strategy_publications' and indexname like 'strategy_publications_%_idx'`);
    expect(indexes.map(({ indexname }) => indexname)).toEqual(expect.arrayContaining([
      "strategy_publications_market_timeframe_idx",
      "strategy_publications_recommended_idx",
      "strategy_publications_search_trgm_idx",
    ]));
    const functionRows = await sql.unsafe(`select prosecdef,
      has_function_privilege('cryptobot_netlify',oid,'EXECUTE') as netlify_execute,
      has_function_privilege('cryptobot_executor',oid,'EXECUTE') as executor_execute,
      has_function_privilege('service_role',oid,'EXECUTE') as service_role_execute,
      has_function_privilege('authenticated',oid,'EXECUTE') as authenticated_execute
      from pg_proc where oid=to_regprocedure('public.derive_strategy_publication_discovery_projection()')`);
    expect(functionRows[0]).toMatchObject({
      prosecdef: false,
      netlify_execute: true,
      executor_execute: false,
      service_role_execute: false,
      authenticated_execute: false,
    });
  });
});
