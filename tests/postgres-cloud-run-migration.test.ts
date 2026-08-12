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

if (process.env.REQUIRE_POSTGRES_TEST === "true" && !target) {
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
      risk_json jsonb not null,
      configuration_hash text not null default repeat('a',64),
      version bigint not null default 1,
      last_candle_at bigint,
      updated_at bigint not null default 0,
      stopped_at bigint,
      lease_owner text,
      lease_expires_at bigint
    )`);
    await sql.unsafe(`create table private.cloud_order_intents (
      run_id text not null references public.cloud_strategy_runs(id) on delete cascade,
      candle_close_at bigint not null,
      client_order_id text not null default 'safe-client-id',
      signal_json jsonb not null default '{}'::jsonb,
      intent_json jsonb,
      status text not null check (status in ('claimed', 'risk-rejected', 'acknowledged', 'rejected', 'unknown')),
      exchange_order_id text,
      error_code text,
      created_at bigint not null default 0,
      updated_at bigint not null default 0,
      primary key (run_id, candle_close_at)
    )`);
    await sql.unsafe("grant execute on all functions in schema public to service_role,cryptobot_executor");
  }

  async function insertOldWriter(
    id: string,
    symbol: string,
    state: "running" | "paused" | "stopped" | "error" = "running",
  ): Promise<void> {
    await sql.unsafe(`insert into public.cloud_strategy_runs
      (id,user_id,connection_id,state,config_json,risk_json)
      values ($1,'user_1','connection_1',$2,$3::text::jsonb,$4::text::jsonb)`, [
      id,
      state,
      JSON.stringify({ market: "futures", symbol }),
      JSON.stringify({ allowedSymbols: [symbol] }),
    ]);
  }

  async function stopRun(id = "run_1", version = 1, stoppedAt = 2_000): Promise<unknown[]> {
    return sql.unsafe(`select id,state,version,stopped_at,lease_owner,lease_expires_at
      from private.stop_cloud_strategy_run('user_1',$1,$2,$3)`, [id, version, stoppedAt]);
  }

  async function replaceOrder(input: {
    status: "claimed" | "risk-rejected" | "acknowledged" | "rejected" | "unknown";
    errorCode?: string | null;
    candleCloseAt?: number;
    evidence?: {
      status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED";
      cumulativeFilledQuantity: string;
    } | null;
  }): Promise<void> {
    await sql.unsafe("delete from private.cloud_order_intents where run_id='run_1'");
    const evidence = input.evidence ? JSON.stringify({
      schemaVersion: 1, provider: "weex", observedAt: 2_000,
      clientOrderId: "safe-client-id", exchangeOrderId: "exchange-1",
      symbol: "BTCUSDT", side: "buy", quantity: "1",
      status: input.evidence.status,
      cumulativeFilledQuantity: input.evidence.cumulativeFilledQuantity,
      fills: [],
    }) : null;
    await sql.unsafe(`insert into private.cloud_order_intents
      (run_id,candle_close_at,status,error_code,exchange_order_id,exchange_evidence_json)
      values ('run_1',$1,$2,$3,$4,$5::text::jsonb)`, [input.candleCloseAt ?? 200,
      input.status, input.errorCode ?? null, evidence ? "exchange-1" : null, evidence]);
  }

  it("derives canonical targets without mutating hash-bound config or authorized risk snapshots", async () => {
    await resetBaseTable();
    await sql.unsafe(migration);

    await insertOldWriter("run_1", "BTC_USDT");
    const rows = await sql.unsafe(`select market,symbol,config_json,risk_json,configuration_hash
      from public.cloud_strategy_runs where id='run_1'`);

    expect(rows[0]).toMatchObject({ market: "futures", symbol: "BTCUSDT" });
    expect(rows[0]?.config_json).toEqual({ market: "futures", symbol: "BTC_USDT" });
    expect(rows[0]?.risk_json).toEqual({ allowedSymbols: ["BTC_USDT"] });
    expect(rows[0]?.configuration_hash).toBe("a".repeat(64));

    await sql.unsafe("update public.cloud_strategy_runs set state='stopped' where id='run_1'");
    await insertOldWriter("run_hyphen", "BTC-USDT");
    const hyphenRows = await sql.unsafe(`select symbol,config_json,risk_json
      from public.cloud_strategy_runs where id='run_hyphen'`);
    expect(hyphenRows[0]).toMatchObject({ symbol: "BTCUSDT" });
    expect(hyphenRows[0]?.config_json).toEqual({ market: "futures", symbol: "BTC-USDT" });
    expect(hyphenRows[0]?.risk_json).toEqual({ allowedSymbols: ["BTC-USDT"] });
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
    expect(rows[0]?.config_json).toEqual({ market: "futures", symbol: "ETH_USDT" });
    expect(rows[0]?.risk_json).toEqual({ allowedSymbols: ["CMT_ETHUSDT"] });

    await expect(sql.unsafe(`update public.cloud_strategy_runs
      set market='spot',symbol='BTCUSDT' where id='run_explicit'`)).rejects.toMatchObject({
      code: "23514",
      constraint_name: "cloud_runs_target_from_config_check",
    });
  });

  it("keeps every possibly submitted or not-yet-completed order from releasing its target", async () => {
    const blocked = [
      { label: "claimed", status: "claimed" as const, candleCloseAt: 50 },
      { label: "unknown", status: "unknown" as const, candleCloseAt: 50 },
      { label: "acknowledged", status: "acknowledged" as const, candleCloseAt: 50 },
      { label: "NEW", status: "acknowledged" as const, errorCode: "exchange_order_open", candleCloseAt: 50 },
      { label: "PARTIALLY_FILLED", status: "acknowledged" as const,
        errorCode: "exchange_order_partially_filled", candleCloseAt: 50 },
      { label: "FILLED before completion", status: "acknowledged" as const,
        errorCode: "exchange_order_filled", candleCloseAt: 200,
        evidence: { status: "FILLED" as const, cumulativeFilledQuantity: "1" } },
      { label: "CANCELED with fill before completion", status: "acknowledged" as const,
        errorCode: "exchange_order_cancelled_partially_filled", candleCloseAt: 200,
        evidence: { status: "CANCELED" as const, cumulativeFilledQuantity: "0.1" } },
      { label: "REJECTED before completion", status: "rejected" as const,
        errorCode: "exchange_order_rejected", candleCloseAt: 200 },
      { label: "risk-rejected before completion", status: "risk-rejected" as const,
        errorCode: "risk_limit", candleCloseAt: 200 },
    ];

    for (const order of blocked) {
      await resetBaseTable();
      await sql.unsafe(migration);
      await insertOldWriter("run_1", "BTCUSDT");
      await sql.unsafe("update public.cloud_strategy_runs set last_candle_at=100 where id='run_1'");
      await replaceOrder(order);

      await expect(stopRun(), order.label).rejects.toMatchObject({
        code: "23514",
        constraint_name: "cloud_run_stop_order_in_flight",
      });
      const rows = await sql.unsafe("select state,version,stopped_at from public.cloud_strategy_runs where id='run_1'");
      expect(rows[0], order.label).toMatchObject({ state: "running", version: "1", stopped_at: null });
      await expect(insertOldWriter("run_successor", "CMT_BTC_USDT"), order.label).rejects.toMatchObject({
        code: "23505",
        constraint_name: "cloud_runs_nonterminal_target_uidx",
      });
    }
  });

  it("stops only after terminal evidence has been incorporated into run completion", async () => {
    const terminal = [
      { label: "FILLED", status: "acknowledged" as const, errorCode: "exchange_order_filled",
        evidence: { status: "FILLED" as const, cumulativeFilledQuantity: "1" } },
      { label: "CANCELED after partial fill", status: "acknowledged" as const,
        errorCode: "exchange_order_cancelled_partially_filled",
        evidence: { status: "CANCELED" as const, cumulativeFilledQuantity: "0.1" } },
      { label: "CANCELED", status: "rejected" as const, errorCode: "exchange_order_cancelled",
        evidence: { status: "CANCELED" as const, cumulativeFilledQuantity: "0" } },
      { label: "REJECTED", status: "rejected" as const, errorCode: "exchange_order_rejected",
        evidence: { status: "REJECTED" as const, cumulativeFilledQuantity: "0" } },
      { label: "risk-rejected", status: "risk-rejected" as const, errorCode: "risk_limit" },
    ];

    for (const order of terminal) {
      await resetBaseTable();
      await sql.unsafe(migration);
      await insertOldWriter("run_1", "BTCUSDT");
      await sql.unsafe("update public.cloud_strategy_runs set last_candle_at=200 where id='run_1'");
      await replaceOrder({ ...order, candleCloseAt: 200 });

      await expect(stopRun(), order.label).resolves.toEqual([
        expect.objectContaining({ state: "stopped", version: "2", stopped_at: "2000" }),
      ]);
      await expect(insertOldWriter("run_successor", "CMT_BTC_USDT"), order.label).resolves.toBeUndefined();
    }
  });

  it("requires matching authoritative exchange evidence for provider terminal status codes", async () => {
    await resetBaseTable();
    await sql.unsafe(migration);
    await insertOldWriter("run_1", "BTCUSDT");
    await sql.unsafe("update public.cloud_strategy_runs set last_candle_at=200 where id='run_1'");

    // A pending migration must remain compatible with terminal rows written by
    // the previous executor. Such rows are accepted but quarantined: they
    // cannot release the target until the new executor reconciles a matching
    // provider snapshot.
    await replaceOrder({ status: "acknowledged", errorCode: "exchange_order_filled" });
    await expect(stopRun()).rejects.toMatchObject({
      code: "23514", constraint_name: "cloud_run_stop_order_in_flight",
    });
    await expect(replaceOrder({ status: "acknowledged", errorCode: "exchange_order_filled",
      evidence: { status: "NEW", cumulativeFilledQuantity: "0" } }))
      .rejects.toMatchObject({ code: "23514", constraint_name: "cloud_order_exchange_evidence_valid" });
    await expect(replaceOrder({ status: "acknowledged", errorCode: null,
      evidence: { status: "FILLED", cumulativeFilledQuantity: "1" } }))
      .rejects.toMatchObject({ code: "23514", constraint_name: "cloud_order_exchange_evidence_valid" });
    await expect(replaceOrder({ status: "rejected", errorCode: "exchange_order_cancelled",
      evidence: { status: "CANCELED", cumulativeFilledQuantity: "0.1" } }))
      .rejects.toMatchObject({ code: "23514", constraint_name: "cloud_order_exchange_evidence_valid" });

    await replaceOrder({ status: "acknowledged", errorCode: "exchange_order_open",
      evidence: { status: "NEW", cumulativeFilledQuantity: "0" } });
    await expect(stopRun()).rejects.toMatchObject({
      code: "23514", constraint_name: "cloud_run_stop_order_in_flight",
    });
  });

  it("rejects impossible provider fill quantities before they can become authoritative", async () => {
    await resetBaseTable();
    await sql.unsafe(migration);
    await insertOldWriter("run_1", "BTCUSDT");

    await expect(replaceOrder({ status: "acknowledged", errorCode: "exchange_order_filled",
      evidence: { status: "FILLED", cumulativeFilledQuantity: "999" } }))
      .rejects.toMatchObject({ code: "23514", constraint_name: "cloud_order_exchange_evidence_valid" });
    await expect(replaceOrder({ status: "acknowledged", errorCode: "exchange_order_partially_filled",
      evidence: { status: "PARTIALLY_FILLED", cumulativeFilledQuantity: "1" } }))
      .rejects.toMatchObject({ code: "23514", constraint_name: "cloud_order_exchange_evidence_valid" });
    await expect(replaceOrder({ status: "rejected", errorCode: "exchange_order_rejected",
      evidence: { status: "REJECTED", cumulativeFilledQuantity: "0.1" } }))
      .rejects.toMatchObject({ code: "23514", constraint_name: "cloud_order_exchange_evidence_valid" });
  });

  it("returns no row for the wrong tenant or version and protects direct legacy stop writers", async () => {
    await resetBaseTable();
    await sql.unsafe(migration);
    await insertOldWriter("run_1", "BTCUSDT");

    await expect(sql.unsafe(`select id from private.stop_cloud_strategy_run(
      'user_2','run_1',1,2000)`)).resolves.toEqual([]);
    await expect(stopRun("run_1", 2)).resolves.toEqual([]);
    await expect(sql.unsafe("select state,version from public.cloud_strategy_runs where id='run_1'"))
      .resolves.toEqual([expect.objectContaining({ state: "running", version: "1" })]);

    await replaceOrder({ status: "unknown", candleCloseAt: 50 });
    await expect(sql.unsafe("update public.cloud_strategy_runs set state='stopped' where id='run_1'"))
      .rejects.toMatchObject({ code: "23514", constraint_name: "cloud_run_stop_order_in_flight" });
    await expect(sql.unsafe("select state from public.cloud_strategy_runs where id='run_1'"))
      .resolves.toEqual([expect.objectContaining({ state: "running" })]);
  });

  it("exposes an execute-only stop gateway without granting private order evidence", async () => {
    await resetBaseTable();
    await sql.unsafe(migration);
    await insertOldWriter("run_1", "BTCUSDT");

    const netlifyCanExecute = await sql.unsafe(`select has_function_privilege(
      'cryptobot_netlify','private.stop_cloud_strategy_run(text,text,bigint,bigint)','execute') as allowed`);
    const netlifyCanReadOrders = await sql.unsafe(`select has_table_privilege(
      'cryptobot_netlify','private.cloud_order_intents','select') as allowed`);
    const executorCanExecute = await sql.unsafe(`select has_function_privilege(
      'cryptobot_executor','private.stop_cloud_strategy_run(text,text,bigint,bigint)','execute') as allowed`);
    const netlifyCanListEvidence = await sql.unsafe(`select has_function_privilege(
      'cryptobot_netlify','private.list_cloud_run_order_evidence(text,text,integer)','execute') as allowed`);
    const executorCanListEvidence = await sql.unsafe(`select has_function_privilege(
      'cryptobot_executor','private.list_cloud_run_order_evidence(text,text,integer)','execute') as allowed`);
    const executorCanValidateEvidence = await sql.unsafe(`select has_function_privilege(
      'cryptobot_executor','private.is_valid_cloud_order_evidence(jsonb)','execute') as allowed`);
    const netlifyCanValidateEvidence = await sql.unsafe(`select has_function_privilege(
      'cryptobot_netlify','private.is_valid_cloud_order_evidence(jsonb)','execute') as allowed`);
    const dataApiPrivileges = await sql.unsafe(`select role_name,
      has_function_privilege(role_name,'private.stop_cloud_strategy_run(text,text,bigint,bigint)','execute') as allowed
      from unnest(array['anon','authenticated','service_role']) role_name order by role_name`);

    expect(netlifyCanExecute[0]).toMatchObject({ allowed: true });
    expect(netlifyCanReadOrders[0]).toMatchObject({ allowed: false });
    expect(executorCanExecute[0]).toMatchObject({ allowed: false });
    expect(netlifyCanListEvidence[0]).toMatchObject({ allowed: true });
    expect(executorCanListEvidence[0]).toMatchObject({ allowed: false });
    expect(executorCanValidateEvidence[0]).toMatchObject({ allowed: true });
    expect(netlifyCanValidateEvidence[0]).toMatchObject({ allowed: false });
    expect(dataApiPrivileges.every((row) => row.allowed === false)).toBe(true);
  });

  it("validates exact secret-free snapshots and returns only owner-scoped order evidence", async () => {
    await resetBaseTable();
    await sql.unsafe(migration);
    await insertOldWriter("run_1", "BTCUSDT");
    await sql.unsafe(`insert into private.cloud_order_intents
      (run_id,candle_close_at,client_order_id,signal_json,intent_json,status,exchange_order_id,
       error_code,created_at,updated_at,exchange_evidence_json)
      values ('run_1',1700000000000,'safe-client-id','{"action":"buy"}',
        '{"symbol":"BTCUSDT","side":"buy","quantity":"0.001","price":"64000"}',
        'acknowledged','exchange-1','exchange_order_filled',1700000000001,1700000000100,
        $1::text::jsonb)`, [JSON.stringify({
          schemaVersion: 1,
          provider: "weex",
          observedAt: 1_700_000_000_100,
          clientOrderId: "safe-client-id",
          exchangeOrderId: "exchange-1",
          symbol: "BTCUSDT",
          side: "buy",
          quantity: "0.001",
          status: "FILLED",
          cumulativeFilledQuantity: "0.001",
          averageFillPrice: "64001",
          fees: "0.03",
          fills: [{ exchangeFillId: "fill-1", price: "64001", quantity: "0.001",
            fee: "0.03", feeCurrency: "USDT", realizedPnl: "1.25", filledAt: 1_700_000_000_090 }],
        })]);

    const ownerRows = await sql.begin(async (transaction) => {
      await transaction.unsafe("set local role cryptobot_netlify");
      return transaction.unsafe(`select * from private.list_cloud_run_order_evidence(
        'user_1','run_1',20)`);
    });
    const otherTenantRows = await sql.begin(async (transaction) => {
      await transaction.unsafe("set local role cryptobot_netlify");
      return transaction.unsafe(`select * from private.list_cloud_run_order_evidence(
        'user_2','run_1',20)`);
    });

    expect(ownerRows).toEqual([expect.objectContaining({
      run_id: "run_1",
      lifecycle_status: "acknowledged",
      evidence_level: "authoritative",
      provider_status: "FILLED",
      cumulative_filled_quantity: "0.001",
      fees: "0.03",
      fills_json: [expect.objectContaining({ realizedPnl: "1.25" })],
    })]);
    expect(Object.keys(ownerRows[0] ?? {})).not.toContain("signal_json");
    expect(Object.keys(ownerRows[0] ?? {})).not.toContain("intent_json");
    expect(otherTenantRows).toEqual([]);

    await expect(sql.unsafe(`update private.cloud_order_intents
      set exchange_evidence_json=exchange_evidence_json || '{"secret":"must-not-persist"}'::jsonb
      where run_id='run_1'`)).rejects.toMatchObject({
      code: "23514",
      constraint_name: "cloud_order_exchange_evidence_valid",
    });
    await expect(sql.unsafe(`update private.cloud_order_intents
      set exchange_evidence_json=jsonb_set(exchange_evidence_json,'{clientOrderId}','"other-client"'::jsonb)
      where run_id='run_1'`)).rejects.toMatchObject({
      code: "23514",
      constraint_name: "cloud_order_exchange_evidence_valid",
    });
  });

  it("serializes stop with the executor run lock in both race directions", async () => {
    await resetBaseTable();
    await sql.unsafe(migration);
    await insertOldWriter("run_1", "BTCUSDT");
    await sql.unsafe("update public.cloud_strategy_runs set lease_owner='owner-1' where id='run_1'");
    await replaceOrder({ status: "claimed", candleCloseAt: 200 });

    let releaseSubmission!: () => void;
    let submissionLocked!: () => void;
    const holdSubmission = new Promise<void>((resolve) => { releaseSubmission = resolve; });
    const submissionHasLock = new Promise<void>((resolve) => { submissionLocked = resolve; });
    const submission = sql.begin(async (transaction) => {
      await transaction.unsafe(`select r.state,o.status
        from public.cloud_strategy_runs r
        join private.cloud_order_intents o on o.run_id=r.id and o.candle_close_at=200
        where r.id='run_1' for update of r,o`);
      submissionLocked();
      await holdSubmission;
      await transaction.unsafe(`update private.cloud_order_intents
        set status='unknown',error_code='submission_in_progress' where run_id='run_1'`);
    });
    await submissionHasLock;
    const stopping = stopRun().then(
      (rows) => ({ status: "fulfilled" as const, rows }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseSubmission();
    await submission;
    await expect(stopping).resolves.toMatchObject({
      status: "rejected",
      error: { code: "23514", constraint_name: "cloud_run_stop_order_in_flight" },
    });

    await resetBaseTable();
    await sql.unsafe(migration);
    await insertOldWriter("run_1", "BTCUSDT");
    await sql.unsafe("update public.cloud_strategy_runs set lease_owner='owner-1' where id='run_1'");

    let releaseStop!: () => void;
    let stopLocked!: () => void;
    const holdStop = new Promise<void>((resolve) => { releaseStop = resolve; });
    const stopHasLock = new Promise<void>((resolve) => { stopLocked = resolve; });
    const stoppingFirst = sql.begin(async (transaction) => {
      const rows = await transaction.unsafe(`select id,state from private.stop_cloud_strategy_run(
        'user_1','run_1',1,2000)`);
      stopLocked();
      await holdStop;
      return rows;
    });
    await stopHasLock;
    const submissionAfterStop = sql.begin(async (transaction) => {
      await transaction.unsafe(`insert into private.cloud_order_intents(run_id,candle_close_at,status,error_code)
        values ('run_1',200,'claimed',null)`);
      const rows = await transaction.unsafe(`select r.state,r.lease_owner,o.status
        from public.cloud_strategy_runs r
        join private.cloud_order_intents o on o.run_id=r.id and o.candle_close_at=200
        where r.id='run_1' for update of r,o`);
      return rows[0];
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseStop();
    await expect(stoppingFirst).resolves.toEqual([expect.objectContaining({ state: "stopped" })]);
    await expect(submissionAfterStop).resolves.toMatchObject({ state: "stopped", lease_owner: null, status: "claimed" });
  });

  it("can safely re-run its compatibility repair after an earlier target schema was applied", async () => {
    await resetBaseTable();
    await sql.unsafe("alter table public.cloud_strategy_runs add column market text, add column symbol text");
    await sql.unsafe(migration);
    await expect(sql.unsafe(migration)).resolves.toBeDefined();

    await insertOldWriter("run_rerun", "CMT_SOL_USDT");
    const rows = await sql.unsafe("select market,symbol,config_json from public.cloud_strategy_runs");
    expect(rows[0]).toMatchObject({ market: "futures", symbol: "SOLUSDT" });
    expect(rows[0]?.config_json).toEqual({ market: "futures", symbol: "CMT_SOL_USDT" });
  });
});
