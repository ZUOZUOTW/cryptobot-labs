import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  unsafe: vi.fn(),
  json: vi.fn((value: unknown) => ({ json: value })),
}));

vi.mock("postgres", () => ({
  default: vi.fn(() => database),
}));

import { CloudRuntimeRepository } from "../src/cloud-repository";

describe("CloudRuntimeRepository account projection", () => {
  beforeEach(() => {
    database.unsafe.mockReset().mockResolvedValue(Object.assign([], { count: 1 }));
    database.json.mockClear();
  });

  it("passes balances and positions as native JSON parameters instead of JSON strings", async () => {
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");
    const balances = [{ asset: "USDT", total: "5000", available: "5000", frozen: "0", unrealizedPnl: "0" }];
    const positions = [{ asset: "USDT", symbol: "BTCUSDT", side: "long", size: "0.01" }];

    await repository.recordAccountProjection(
      {
        connectionId: "wc_1",
        userId: "usr_1",
        tradeCursorAt: 1,
        permissions: { read: true, futuresTrade: true },
        withdrawalAccessAbsent: true,
      },
      "owner-1",
      {
        uid: "123456",
        observedAt: 1_700_000_000_000,
        balances,
        positions,
        equity: "5000",
        availableEquity: "5000",
        unrealizedPnl: "0",
        trades: [],
        nextTradeCursorAt: 1_700_000_000_001,
      },
    );

    expect(database.json).toHaveBeenNthCalledWith(1, balances);
    expect(database.json).toHaveBeenNthCalledWith(2, positions);
    expect(database.unsafe.mock.calls[0]?.[1]?.[4]).toEqual({ json: balances });
    expect(database.unsafe.mock.calls[0]?.[1]?.[5]).toEqual({ json: positions });
  });
});

describe("CloudRuntimeRepository run failures", () => {
  beforeEach(() => {
    database.unsafe.mockReset().mockResolvedValue(Object.assign([], { count: 1 }));
  });

  it("can stop retrying immediately for a terminal execution prerequisite", async () => {
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");
    const run = {
      id: "run_1",
      userId: "usr_1",
      connectionId: "wc_1",
      mode: "futures-demo" as const,
      version: 1,
      config: {},
      risk: {},
      lastCandleAt: null,
      lastEvaluatedAt: null,
      consecutiveFailures: 0,
      positions: [],
    };

    await repository.fail(run, "owner-1", "demo_funds_required", 1_700_000_000_000, true);

    expect(database.unsafe.mock.calls[0]?.[1]).toEqual([
      "run_1", "owner-1", "demo_funds_required", 1_700_000_000_000, true,
    ]);
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("state=case when $5::boolean");
  });
});

describe("CloudRuntimeRepository risk accounting", () => {
  beforeEach(() => {
    database.unsafe.mockReset();
  });

  it("loads exact realized net PnL for the current UTC day", async () => {
    database.unsafe.mockResolvedValueOnce([{ net_pnl: "-12.340000000000000000" }]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.realizedPnl("usr_1", "wc_1", 1_700_000_000_000, 1_700_000_100_000))
      .resolves.toBe("-12.340000000000000000");
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("sum(net_pnl)");
    expect(database.unsafe.mock.calls[0]?.[1]).toEqual([
      "usr_1", "wc_1", 1_700_000_000_000, 1_700_000_100_000,
    ]);
  });

  it("persists and returns one start-of-day equity checkpoint per UTC day", async () => {
    database.unsafe.mockResolvedValueOnce([{ day_start_equity: "5000.25" }]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.dayStartEquity("run_1", "owner-1", "2026-07-25", "5000.25", 1_700_000_000_000))
      .resolves.toBe("5000.25");
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("risk_utc_day is distinct from $3");
  });

  it("requires acknowledged order evidence before a run can claim an exchange position", async () => {
    database.unsafe.mockResolvedValueOnce([{ acknowledged: false }]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.hasAcknowledgedOrder("run_1")).resolves.toBe(false);
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("status='acknowledged'");
  });
});
