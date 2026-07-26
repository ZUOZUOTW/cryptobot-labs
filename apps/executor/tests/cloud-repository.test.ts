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
      configurationHash: "a".repeat(64),
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

describe("CloudRuntimeRepository run completion", () => {
  beforeEach(() => {
    database.unsafe.mockReset().mockResolvedValue(Object.assign([], { count: 1 }));
    database.json.mockClear();
  });

  it("never regresses the run candle or double-counts an older recovery", async () => {
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");
    const run = {
      id: "run_1",
      userId: "usr_1",
      connectionId: "wc_1",
      mode: "live" as const,
      version: 1,
      configurationHash: "a".repeat(64),
      config: {},
      risk: {},
      lastCandleAt: 1_700_000_000_000,
      lastEvaluatedAt: 1_700_000_000_001,
      consecutiveFailures: 0,
      positions: [],
    };
    const recoveredSignal = { action: "buy", reason: "recovered" };

    await repository.complete(run, "owner-1", 1_699_999_940_000, recoveredSignal, 1_700_000_010_000);

    expect(database.unsafe.mock.calls[0]?.[0]).toContain(
      "last_candle_at=greatest(coalesce(last_candle_at,$3),$3)",
    );
    expect(database.unsafe.mock.calls[0]?.[0]).toContain(
      "evaluation_count=evaluation_count+case when last_candle_at is null or $3>last_candle_at",
    );
    expect(database.unsafe.mock.calls[0]?.[1]).toEqual([
      "run_1", "owner-1", 1_699_999_940_000, 1_700_000_010_000, { json: recoveredSignal },
    ]);
  });
});

describe("CloudRuntimeRepository order claims", () => {
  beforeEach(() => {
    database.unsafe.mockReset();
    database.json.mockClear();
  });

  it("persists the approved intent and reports a newly inserted claim", async () => {
    const signal = { id: "signal-1", action: "buy", reason: "entry", createdAt: 1_700_000_000_000 };
    const intent = { symbol: "BTCUSDT", side: "buy", quantity: "0.001", price: "60000",
      expectedSlippageBps: "30", reduceOnly: false };
    database.unsafe.mockResolvedValueOnce([{
      status: "claimed",
      exchange_order_id: null,
      client_order_id: "cb_fresh",
      candle_close_at: 1_699_999_999_999,
      created_at: 1_700_000_000_000,
      signal_json: signal,
      intent_json: intent,
      fresh: true,
    }]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.claimOrder({
      runId: "run_1",
      candleCloseAt: 1_699_999_999_999,
      clientOrderId: "cb_fresh",
      signal,
      intent,
      now: 1_700_000_000_000,
    })).resolves.toEqual({
      status: "claimed",
      exchangeOrderId: null,
      clientOrderId: "cb_fresh",
      candleCloseAt: 1_699_999_999_999,
      createdAt: 1_700_000_000_000,
      signal,
      intent,
      fresh: true,
    });

    expect(database.unsafe.mock.calls[0]?.[0]).toContain("signal_json,intent_json");
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("true as fresh");
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("not exists(select 1 from inserted)");
    expect(database.json).toHaveBeenNthCalledWith(1, signal);
    expect(database.json).toHaveBeenNthCalledWith(2, intent);
  });

  it("returns the stored client order id when a candle was claimed by an earlier attempt", async () => {
    database.unsafe.mockResolvedValueOnce([{
      status: "unknown",
      exchange_order_id: null,
      client_order_id: "cb_original",
      candle_close_at: 1_699_999_999_999,
      created_at: 1_700_000_000_000,
      signal_json: { action: "buy" },
      intent_json: { side: "buy" },
      fresh: false,
    }]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    const claim = await repository.claimOrder({
      runId: "run_1",
      candleCloseAt: 1_699_999_999_999,
      clientOrderId: "cb_retry_candidate",
      signal: { action: "buy" },
      intent: { side: "buy" },
      now: 1_700_000_010_000,
    });

    expect(claim.clientOrderId).toBe("cb_original");
    expect(claim.fresh).toBe(false);
    expect(database.unsafe.mock.calls[0]?.[0]).not.toContain("and client_order_id=$3");
  });

  it("returns the oldest unresolved or not-yet-completed order before a newer candle", async () => {
    database.unsafe.mockResolvedValueOnce([{
      status: "claimed",
      exchange_order_id: null,
      client_order_id: "cb_legacy",
      candle_close_at: 1_699_999_940_000,
      created_at: 1_699_999_940_001,
      signal_json: { action: "buy", reason: "legacy" },
      intent_json: null,
      fresh: false,
    }]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.blockingOrder("run_1", 1_699_999_900_000)).resolves.toEqual({
      status: "claimed",
      exchangeOrderId: null,
      clientOrderId: "cb_legacy",
      candleCloseAt: 1_699_999_940_000,
      createdAt: 1_699_999_940_001,
      signal: { action: "buy", reason: "legacy" },
      intent: null,
      fresh: false,
    });

    expect(database.unsafe.mock.calls[0]?.[0]).toContain("status in ('claimed','unknown')");
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("status='acknowledged'");
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("'exchange_order_filled'");
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("candle_close_at>$2");
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("order by candle_close_at asc");
    expect(database.unsafe.mock.calls[0]?.[1]).toEqual(["run_1", 1_699_999_900_000]);
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
