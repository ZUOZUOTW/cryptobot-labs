// @vitest-environment node

import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalizeWeexSymbol } from "../packages/weex-client/src/symbol";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("cloud strategy target exclusivity", () => {
  it("uses a canonical partial unique index for every non-stopped state", async () => {
    const migration = await readFile(
      "supabase/migrations/20260812090000_enforce_cloud_run_target_exclusivity.sql",
      "utf8",
    );
    const repository = await readFile("lib/server/cloud-runs.ts", "utf8");
    const index = migration.match(/create unique index(?: if not exists)? cloud_runs_nonterminal_target_uidx[\s\S]*?;/i)?.[0];

    expect(index).toBeTruthy();
    expect(migration).not.toMatch(/\b(?:alter table|update|from|on) cloud_strategy_runs\b/i);
    expect(migration).toMatch(/alter table public\.cloud_strategy_runs/i);
    expect(index).toMatch(/on public\.cloud_strategy_runs/i);
    expect(migration).toMatch(/group by user_id, connection_id, market, symbol[\s\S]*having count\(\*\) > 1/i);
    expect(migration).toMatch(/migration blocked by duplicate non-stopped runs/i);
    expect(migration).toMatch(/explicitly stop all but one run/i);
    expect(index).toMatch(/\(user_id, connection_id, market, symbol\)/i);
    expect(index).toMatch(/where state <> 'stopped'/i);
    expect(index).not.toMatch(/json_extract|insert\s+or\s+ignore/i);
    expect(migration).toMatch(/before insert or update of config_json, risk_json/i);
    expect(migration).not.toMatch(/update of config_json, risk_json, market, symbol/i);
    expect(migration).toMatch(/security invoker[\s\S]*set search_path = ''/i);
    expect(migration).toMatch(/revoke all on function private\.synchronize_cloud_run_target\(\)/i);
    expect(migration).toMatch(/regexp_replace\([\s\S]*'\^CMT_'[\s\S]*'\[-\/_\]'/i);
    expect(migration).not.toContain("'[/_-]'");
    expect(repository).toContain("'[-/_]'");
    expect(repository).not.toContain("'[/_-]'");
    expect(migration).toMatch(/new\.market := configured_market[\s\S]*new\.symbol := configured_symbol/i);
    expect(migration).toMatch(/new\.config_json := jsonb_set\([\s\S]*symbol[\s\S]*configured_symbol/i);
    expect(migration).toMatch(/new\.risk_json := jsonb_set\([\s\S]*allowedSymbols[\s\S]*canonical_allowed_symbols/i);
    expect(migration).toMatch(/cloud_runs_risk_target_check/i);
    expect(migration).toMatch(/jsonb_typeof\(allowed_value\) is distinct from 'string'/i);
    expect(migration).toMatch(/update public\.cloud_strategy_runs[\s\S]*set config_json = config_json,[\s\S]*risk_json = risk_json/i);

    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec(`create table cloud_strategy_runs (
      id text primary key,
      user_id text not null,
      connection_id text not null,
      market text not null,
      symbol text not null,
      state text not null
    );`);
    database.exec(index!.replace("public.cloud_strategy_runs", "cloud_strategy_runs"));
    const insert = database.prepare(`insert into cloud_strategy_runs
      (id,user_id,connection_id,market,symbol,state) values (?,?,?,?,?,?)`);
    const insertAlias = (id: string, market: string, symbol: string, state: string) => insert.run(
      id,
      "user_1",
      "connection_1",
      market,
      canonicalizeWeexSymbol(symbol),
      state,
    );

    insertAlias("run_1", "futures", "BTC_USDT", "running");
    expect(() => insertAlias("run_2", "futures", "CMT_BTCUSDT", "paused"))
      .toThrow(/unique constraint failed/i);

    insertAlias("run_spot", "spot", "BTC/USDT", "running");
    insertAlias("run_eth", "futures", "ETHUSDT", "running");
    insertAlias("run_stopped", "futures", "CMT_BTC_USDT", "stopped");

    database.prepare("update cloud_strategy_runs set state='stopped' where id='run_1'").run();
    insertAlias("run_2", "futures", "BTCUSDT", "error");
    expect(() => insertAlias("run_3", "futures", "BTC_USDT", "running"))
      .toThrow(/unique constraint failed/i);
  });
});
