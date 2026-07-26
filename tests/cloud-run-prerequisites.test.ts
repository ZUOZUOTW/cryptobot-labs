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
    expect(sql).toMatch(/on conflict \(id\) do nothing/i);
    expect(JSON.parse(String(bindings[2]))).toEqual(risk);
    expect(first).toHaveBeenCalledOnce();
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
    ]);
  });
});
