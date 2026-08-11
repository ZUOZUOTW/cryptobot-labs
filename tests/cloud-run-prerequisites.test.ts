import { describe, expect, it, vi } from "vitest";

import {
  createCloudRunRepository,
  isRecentLiveConfirmation,
  type CloudRiskInput,
} from "../lib/server/cloud-runs";

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

  it("requires futures permissions and complete matching historical evidence", async () => {
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
    await createCloudRunRepository(database as never).create({
      id: "crun_1", userId: "user_1", strategyVersionId: "sv_1",
      name: "突破獵手", configurationHash: "a".repeat(64), mode: "live", risk, now: 100,
    });

    expect(sql).toMatch(/permissions_json\s+@>\s+'\\?{"read":true}/);
    expect(sql).toMatch(/spotTrade/);
    expect(sql).toMatch(/futuresTrade/);
    expect(sql).toMatch(/'live','running'/);
    expect(sql).toMatch(/exists\s*\(\s*select 1 from backtest_jobs/i);
    expect(sql).toMatch(/j\.status='succeeded'/);
    expect(sql).toMatch(/d\.complete=1/);
    expect(sql).toMatch(/r\.configuration_hash=s\.config_hash/);
    expect(sql).toMatch(/\?::text::jsonb/);
    expect(sql).not.toMatch(/\?::jsonb/);
    expect(sql).toMatch(/configuration_hash,market,symbol,version/);
    expect(sql).toMatch(/active\.market=t\.market and active\.symbol=t\.symbol/);
    expect(sql).toMatch(/active\.state<>'stopped'/);
    expect(sql).toMatch(/on conflict do nothing/i);
    expect(sql).not.toMatch(/insert\s+or\s+ignore/i);
    expect(JSON.parse(String(bindings[2]))).toEqual(risk);
    expect(first).toHaveBeenCalledOnce();
  });

  it("selects the persisted market and symbol target for every dashboard run", async () => {
    let sql = "";
    const all = vi.fn().mockResolvedValue({ results: [] });
    const database = {
      prepare: vi.fn((statement: string) => {
        sql = statement;
        return { bind: vi.fn(() => ({ all })) };
      }),
    };

    await createCloudRunRepository(database as never).list("user_1");

    expect(sql).toMatch(/select[\s\S]*state,market,symbol,version[\s\S]*from cloud_strategy_runs/i);
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
    expect(sql).toMatch(/active\.market=requested_strategy\.market/);
    expect(sql).toMatch(/active\.symbol=requested_strategy\.symbol/);
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
      now: 1_700_000_000_000,
    });

    expect(sql).toMatch(/consecutive_failures=case when \?='running' then 0/);
    expect(sql).toMatch(/lease_owner=null,lease_expires_at=null/);
    expect(sql).toMatch(/\?<>'running' or not exists/);
    expect(sql).toMatch(/active\.connection_id=target\.connection_id/);
    expect(sql).toMatch(/active\.market=target\.market and active\.symbol=target\.symbol/);
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
    ]);
  });
});
