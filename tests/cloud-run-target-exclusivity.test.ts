// @vitest-environment node

import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("cloud strategy target exclusivity", () => {
  it("uses a PostgreSQL and SQLite compatible partial unique index for every non-stopped state", async () => {
    const migration = await readFile(
      "supabase/migrations/20260812090000_enforce_cloud_run_target_exclusivity.sql",
      "utf8",
    );
    const index = migration.match(/create unique index cloud_runs_nonterminal_target_uidx[\s\S]*?;/i)?.[0];

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

    insert.run("run_1", "user_1", "connection_1", "futures", "BTCUSDT", "running");
    expect(() => insert.run(
      "run_2", "user_1", "connection_1", "futures", "BTCUSDT", "paused",
    )).toThrow(/unique constraint failed/i);

    insert.run("run_spot", "user_1", "connection_1", "spot", "BTCUSDT", "running");
    insert.run("run_eth", "user_1", "connection_1", "futures", "ETHUSDT", "running");
    insert.run("run_stopped", "user_1", "connection_1", "futures", "BTCUSDT", "stopped");

    database.prepare("update cloud_strategy_runs set state='stopped' where id='run_1'").run();
    insert.run("run_2", "user_1", "connection_1", "futures", "BTCUSDT", "error");
    expect(() => insert.run(
      "run_3", "user_1", "connection_1", "futures", "BTCUSDT", "running",
    )).toThrow(/unique constraint failed/i);
  });
});
