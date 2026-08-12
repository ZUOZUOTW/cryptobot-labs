import { describe, expect, it, vi } from "vitest";

import {
  createCloudRunRepository,
  isRecentLiveConfirmation,
  parseCloudRisk,
  type CloudRiskInput,
} from "../lib/server/cloud-runs";
import { validFormalEvidenceRow } from "./helpers/formal-evidence";

const risk: CloudRiskInput = {
  allowedSymbols: ["BTCUSDT"],
  maxOrderNotional: "25",
  maxPositionNotional: "100",
  maxTotalExposure: "200",
  maxSimultaneousPositions: 1,
  maxDailyLoss: "20",
  maxLeverage: "6",
  maxSlippageBps: 30,
  minSignalCooldownMs: 60_000,
  maxConsecutiveFailures: 3,
  operationMode: "automatic",
};

describe("cloud strategy launch prerequisites", () => {
  it("accepts only a recent, exact, affirmative live-funds confirmation", () => {
    const now = 1_700_000_000_000;
    expect(isRecentLiveConfirmation({ acknowledged: true, acceptedAt: now }, now)).toBe(true);
    expect(isRecentLiveConfirmation({ acknowledged: false, acceptedAt: now }, now)).toBe(false);
    expect(isRecentLiveConfirmation({ acknowledged: true, acceptedAt: now - 600_001 }, now)).toBe(false);
    expect(isRecentLiveConfirmation({ acknowledged: true, acceptedAt: now, extra: true }, now)).toBe(false);
  });

  it("canonicalizes and deduplicates risk symbols before persistence", () => {
    expect(parseCloudRisk({
      ...risk,
      allowedSymbols: ["BTC_USDT", "CMT_BTCUSDT", "ETH/USDT"],
    })).toMatchObject({ allowedSymbols: ["BTCUSDT", "ETHUSDT"] });
    expect(parseCloudRisk({ ...risk, allowedSymbols: ["ALL"] })).toBeNull();
  });

  it("requires mode-specific futures permissions and complete matching historical evidence", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const database = {
      prepare: vi.fn((statement: string) => {
        return { bind: vi.fn((...values: unknown[]) => {
          statements.push({ sql: statement, bindings: values });
          return {
            first: vi.fn().mockResolvedValue(
              /from strategy_versions s\s+join backtest_jobs j/i.test(statement)
                ? validFormalEvidenceRow()
                : null,
            ),
          };
        }) };
      }),
    };
    await createCloudRunRepository(database as never).create({
      id: "crun_1", userId: "user_1", strategyVersionId: "sv_1",
      name: "突破獵手", configurationHash: "a".repeat(64), mode: "futures-demo", risk, now: 100,
    });

    const evidence = statements.find(({ sql: statement }) => /from strategy_versions s\s+join backtest_jobs j/i.test(statement));
    const insert = statements.find(({ sql: statement }) => /insert into cloud_strategy_runs/i.test(statement));
    expect(evidence).toBeDefined();
    expect(evidence!.sql).toMatch(/r\.strategy_hash as strategyHash/);
    expect(evidence!.sql).toMatch(/r\.script_hash as scriptHash/);
    expect(evidence!.sql).toMatch(/d\.gaps_json as gapsJson,d\.checksum/);
    expect(evidence!.bindings).toEqual(["user_1", "sv_1", "a".repeat(64)]);
    expect(insert).toBeDefined();
    const { sql, bindings } = insert!;

    expect(sql).toMatch(/permissions_json\s+@>\s+'\\?{"read":true}/);
    expect(sql).toMatch(/spotTrade/);
    expect(sql).toMatch(/futuresTrade/);
    expect(sql).toMatch(/futuresDemoTrade/);
    expect(sql).toMatch(/liveVerified/);
    expect(sql).toMatch(/\?='futures-demo'[\s\S]*futuresDemoTrade/);
    expect(sql).toMatch(/\?='live'[\s\S]*spotTrade/);
    expect(sql).toMatch(/select \?,s\.user_id,c\.id,c\.executor_shard_id,s\.id,\?,\?,'running'/);
    expect(sql).toMatch(/\?='futures-demo' and t\.market='futures'/);
    expect(sql).toMatch(/s\.source_code is null and s\.source_hash is null/);
    expect(sql).toMatch(/exists\s*\(\s*select 1 from backtest_jobs/i);
    expect(sql).toMatch(/j\.status='succeeded'/);
    expect(sql).toMatch(/d\.complete=1/);
    expect(sql).toMatch(/r\.configuration_hash=s\.config_hash/);
    expect(sql).toMatch(/\?::text::jsonb/);
    expect(sql).not.toMatch(/\?::jsonb/);
    expect(sql).toMatch(/configuration_hash,version/);
    expect(sql).not.toMatch(/configuration_hash,market,symbol,version/);
    expect(sql).toMatch(/active\.config_json->>'market'=t\.market/);
    expect(sql).toMatch(/active\.config_json->>'symbol'/);
    expect(sql).toMatch(/regexp_replace/);
    expect(sql).toMatch(/jsonb_array_elements_text\(\?::text::jsonb->'allowedSymbols'\)/);
    expect(sql).toMatch(/active\.state<>'stopped'/);
    expect(sql).toMatch(/on conflict do nothing/i);
    expect(sql).not.toMatch(/insert\s+or\s+ignore/i);
    expect(bindings[2]).toBe("futures-demo");
    expect(JSON.parse(String(bindings[3]))).toEqual(risk);
    expect(JSON.parse(String(bindings[13]))).toEqual(risk);
    expect(bindings).toHaveLength(16);
    expect(sql.match(/\?/g)).toHaveLength(bindings.length);
    expect(bindings.slice(-2)).toEqual(["futures-demo", "futures-demo"]);
    expect(statements).toHaveLength(2);
  });

  it("selects the rollback-compatible config target for every dashboard run", async () => {
    let sql = "";
    const all = vi.fn().mockResolvedValue({ results: [] });
    const database = {
      prepare: vi.fn((statement: string) => {
        sql = statement;
        return { bind: vi.fn(() => ({ all })) };
      }),
    };

    await createCloudRunRepository(database as never).list("user_1");

    expect(sql).toMatch(/select[\s\S]*state,config_json->>'market' as market[\s\S]*config_json->>'symbol' as symbol[\s\S]*from cloud_strategy_runs/i);
    expect(all).toHaveBeenCalledOnce();
  });

  it("finds a non-terminal run targeting the same WEEX connection, market, and symbol", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const first = vi.fn().mockResolvedValue({ conflict: 1 });
    const database = {
      prepare: vi.fn((statement: string) => {
        sql = statement;
        return { bind: vi.fn((...values: unknown[]) => {
          bindings = values;
          return { first };
        }) };
      }),
    };

    await expect(createCloudRunRepository(database as never).hasActiveTargetConflict({
      id: "crun_new",
      userId: "user_1",
      strategyVersionId: "sv_1",
      configurationHash: "a".repeat(64),
    })).resolves.toBe(true);

    expect(sql).toMatch(/active\.connection_id=requested_connection\.id/);
    expect(sql).toMatch(/active\.config_json->>'market'=requested_version\.config_json::jsonb->>'market'/);
    expect(sql).toMatch(/active\.config_json->>'symbol'/);
    expect(sql).toMatch(/requested_version\.config_json::jsonb->>'symbol'/);
    expect(sql).toMatch(/active\.id<>\?/);
    expect(sql).toMatch(/active\.state<>'stopped'/);
    expect(sql).not.toMatch(/json_extract|insert\s+or\s+ignore/i);
    expect(bindings).toEqual(["user_1", "sv_1", "a".repeat(64), "crun_new"]);
  });

  it("clears stale failure and lease state when a user resumes an errored run", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const first = vi.fn().mockResolvedValue(null);
    const database = {
      prepare: vi.fn((statement: string) => {
        sql = statement;
        return { bind: vi.fn((...values: unknown[]) => {
          bindings = values;
          return { first };
        }) };
      }),
    };

    await createCloudRunRepository(database as never).transition({
      userId: "user_1",
      id: "crun_1",
      state: "running",
      expectedVersion: 4,
      allowLiveResume: false,
      now: 1_700_000_000_000,
    });

    expect(sql).toMatch(/consecutive_failures=case when \?='running' then 0/);
    expect(sql).toMatch(/lease_owner=null,lease_expires_at=null/);
    expect(sql).toMatch(/\?<>'running' or target\.mode<>'live' or \?/);
    expect(sql).toMatch(/\?<>'running' or not exists/);
    expect(sql).toMatch(/active\.connection_id=target\.connection_id/);
    expect(sql).toMatch(/active\.config_json->>'market'=target\.config_json->>'market'/);
    expect(sql).toMatch(/active\.config_json->>'symbol'/);
    expect(sql).toMatch(/target\.config_json->>'symbol'/);
    expect(bindings).toEqual([
      "running",
      1_700_000_000_000,
      "running",
      1_700_000_000_000,
      "running",
      1_700_000_000_000,
      "running",
      "running",
      "user_1",
      "crun_1",
      4,
      "running",
      false,
      "running",
    ]);
  });

  it("routes a stop through the atomic private order-settlement fence", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const first = vi.fn().mockResolvedValue(null);
    const database = {
      prepare: vi.fn((statement: string) => {
        sql = statement;
        return { bind: vi.fn((...values: unknown[]) => {
          bindings = values;
          return { first };
        }) };
      }),
    };

    await createCloudRunRepository(database as never).transition({
      userId: "user_1",
      id: "crun_1",
      state: "stopped",
      expectedVersion: 4,
      allowLiveResume: false,
      now: 1_700_000_000_000,
    });

    expect(sql).toMatch(/from private\.stop_cloud_strategy_run\(\?,\?,\?,\?\)/);
    expect(sql).not.toMatch(/update cloud_strategy_runs/i);
    expect(bindings).toEqual(["user_1", "crun_1", 4, 1_700_000_000_000]);
    expect(first).toHaveBeenCalledOnce();
  });
});
