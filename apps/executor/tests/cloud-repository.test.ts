import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  unsafe: vi.fn(),
  json: vi.fn((value: unknown) => ({ json: value })),
  begin: vi.fn(),
}));

vi.mock("postgres", () => ({
  default: vi.fn(() => database),
}));

import {
  CloudRuntimeRepository,
  ORDER_SUBMISSION_TIMEOUT_MS,
  ORDER_SUBMISSION_TRANSACTION_TIMEOUT_MS,
} from "../src/cloud-repository";
import {
  EXECUTOR_DATABASE_SCHEMA_SQL,
  POSTGRES_RUNTIME_IDENTITY_SQL,
} from "../../../lib/server/postgres-runtime-readiness.js";

const executorIdentity = {
  current_role: "cryptobot_executor",
  session_role: "cryptobot_executor",
  current_superuser: false,
  current_bypassrls: false,
  session_superuser: false,
  session_bypassrls: false,
};
const executorSchema = {
  runs_table_ready: true,
  orders_table_ready: true,
  account_snapshots_table_ready: true,
  realized_pnl_table_ready: true,
  order_evidence_column_ready: true,
  order_evidence_constraint_ready: true,
  order_evidence_validator_ready: true,
  order_evidence_validator_acl_ready: true,
  market_column_ready: true,
  symbol_column_ready: true,
  target_index_definition: "CREATE UNIQUE INDEX cloud_runs_nonterminal_target_uidx ON public.cloud_strategy_runs USING btree (user_id, connection_id, market, symbol) WHERE (state <> 'stopped'::text)",
  target_index_predicate: "(state <> 'stopped'::text)",
  target_trigger_ready: true,
  target_function_ready: true,
  target_function_acl_ready: true,
  stop_trigger_ready: true,
  stop_trigger_function_ready: true,
  stop_trigger_function_acl_ready: true,
  stop_function_ready: true,
  stop_function_acl_ready: true,
};

describe("CloudRuntimeRepository readiness", () => {
  beforeEach(() => {
    database.unsafe.mockReset();
  });

  it("checks executor identity before the complete live-trading schema fence", async () => {
    database.unsafe
      .mockResolvedValueOnce([executorIdentity])
      .mockResolvedValueOnce([executorSchema]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.assertReady()).resolves.toBeUndefined();
    expect(database.unsafe).toHaveBeenCalledTimes(2);
    expect(database.unsafe.mock.calls[0]?.[0]).toBe(POSTGRES_RUNTIME_IDENTITY_SQL);
    expect(database.unsafe.mock.calls[1]?.[0]).toBe(EXECUTOR_DATABASE_SCHEMA_SQL);
  });

  it("refuses readiness when the stop fence migration is not fully applied", async () => {
    database.unsafe
      .mockResolvedValueOnce([executorIdentity])
      .mockResolvedValueOnce([{ ...executorSchema, stop_function_ready: false }]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.assertReady()).rejects.toThrow("Cloud runtime database schema is not ready");
    expect(database.unsafe).toHaveBeenCalledTimes(2);
  });

  it("does not inspect schema through a mismatched executor login", async () => {
    database.unsafe.mockResolvedValueOnce([{
      ...executorIdentity,
      session_role: "postgres",
    }]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.assertReady()).rejects.toThrow("Postgres runtime identity is not ready");
    expect(database.unsafe).toHaveBeenCalledOnce();
  });
});

describe("CloudRuntimeRepository run scheduling", () => {
  beforeEach(() => {
    database.unsafe.mockReset().mockResolvedValue([]);
    database.begin.mockReset();
  });

  it("claims only runs with a newly closed candle or unresolved order evidence", async () => {
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.claimRuns("owner-1", 1_700_000_000_000, 96)).resolves.toEqual([]);

    const query = String(database.unsafe.mock.calls[0]?.[0]);
    expect(query).toContain("r.config_json->>'timeframe'");
    expect(query).toContain("join public.weex_connections c");
    expect(query).toContain("c.id=r.connection_id and c.user_id=r.user_id");
    expect(query).toContain("c.status='active'");
    expect(query).toContain("c.withdrawal_access_absent=true");
    expect(query).toContain("c.permissions_json @> '{\"read\":true}'::jsonb");
    expect(query).toContain("{\"futuresDemoTrade\":true}");
    expect(query).toContain("{\"futuresTrade\":true,\"liveVerified\":true}");
    expect(query).toContain("{\"spotTrade\":true,\"liveVerified\":true}");
    expect(query).toContain("schedule.interval_ms");
    expect(query).toContain("r.last_candle_at < (($2::bigint/schedule.interval_ms)*schedule.interval_ms)-1");
    expect(query).toContain("exists (select 1 from private.cloud_order_intents");
    expect(query).toContain("o.status in ('claimed','unknown')");
    expect(database.unsafe.mock.calls[0]?.[1]).toEqual([
      "owner-1", 1_700_000_000_000, "executor-a", 96,
    ]);
  });

  it("canonicalizes legacy WEEX aliases before config and risk reach the executor", async () => {
    database.unsafe.mockResolvedValueOnce([{
      id: "run_1",
      user_id: "usr_1",
      connection_id: "wc_1",
      mode: "live",
      version: 1,
      configuration_hash: "a".repeat(64),
      config_json: { market: "futures", symbol: "CMT_BTC_USDT" },
      risk_json: { allowedSymbols: ["BTC_USDT", "CMT_BTCUSDT"] },
      last_candle_at: null,
      last_evaluated_at: null,
      consecutive_failures: 0,
      positions_json: [],
    }]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.claimRuns("owner-1", 1_700_000_000_000, 96)).resolves.toEqual([
      expect.objectContaining({
        config: { market: "futures", symbol: "BTCUSDT" },
        risk: { allowedSymbols: ["BTCUSDT"] },
      }),
    ]);
  });
});

describe("CloudRuntimeRepository credential authorization", () => {
  beforeEach(() => {
    database.unsafe.mockReset();
    database.begin.mockReset();
  });

  it("loads an encrypted credential only through an active, read-enabled, withdrawal-safe target", async () => {
    database.unsafe.mockResolvedValueOnce([{
      kms_key_id: "kms-key",
      encrypted_data_key: Uint8Array.of(1),
      initialization_vector: Uint8Array.of(2),
      credential_ciphertext: Uint8Array.of(3),
      encryption_context_json: { connectionId: "wc_1" },
      credential_version: 3,
      connection_version: 5,
    }]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.credential("wc_1", "usr_1", {
      market: "futures",
      mode: "futures-demo",
    })).resolves.toMatchObject({
      context: { connectionId: "wc_1" },
      credentialVersion: 3,
      connectionVersion: 5,
    });

    const query = String(database.unsafe.mock.calls[0]?.[0]);
    expect(query).toContain("join public.weex_connections c");
    expect(query).toContain("c.status='active'");
    expect(query).toContain("c.withdrawal_access_absent=true");
    expect(query).toContain("{\"read\":true}");
    expect(query).toContain("{\"futuresDemoTrade\":true}");
    expect(query).toContain("{\"spotTrade\":true,\"liveVerified\":true}");
    expect(database.unsafe.mock.calls[0]?.[1]).toEqual(["wc_1", "usr_1", "futures-demo", "futures"]);
  });

  it("fails closed when no currently authorized connection owns the encrypted credential", async () => {
    database.unsafe.mockResolvedValueOnce([]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.credential("wc_1", "usr_1", {
      market: "spot",
      mode: "live",
    })).rejects.toThrow("Cloud credential is unavailable");
  });
});

describe("CloudRuntimeRepository atomic order authorization", () => {
  const run = {
    id: "run_1",
    userId: "usr_1",
    connectionId: "wc_1",
    mode: "futures-demo" as const,
    version: 1,
    configurationHash: "a".repeat(64),
    config: { market: "futures", symbol: "BTCUSDT" },
    risk: { allowedSymbols: ["BTCUSDT"] },
    lastCandleAt: null,
    lastEvaluatedAt: null,
    consecutiveFailures: 0,
    positions: [],
  };

  beforeEach(() => {
    database.unsafe.mockReset();
    database.begin.mockReset();
  });

  it("holds connection, run, and order locks while authorizing and submitting", async () => {
    const transaction = {
      unsafe: vi.fn()
        .mockResolvedValueOnce(Object.assign([], { count: 0 }))
        .mockResolvedValueOnce([{
          status: "active",
          permissions_json: { read: true, futuresDemoTrade: true },
          withdrawal_access_absent: true,
          credential_version: 3,
          connection_version: 5,
        }])
        .mockResolvedValueOnce([{
          mode: "futures-demo",
          market: "futures",
          state: "running",
          lease_owner: "owner-1",
          order_status: "claimed",
        }])
        .mockResolvedValueOnce(Object.assign([], { count: 1 }))
        .mockResolvedValueOnce(Object.assign([], { count: 1 })),
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");
    const submit = vi.fn(async (signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      expect(transaction.unsafe).toHaveBeenCalledTimes(4);
      return { status: "acknowledged" as const, exchangeOrderId: "exchange-1" };
    });

    await expect(repository.submitAuthorizedOrder({
      run,
      owner: "owner-1",
      candleCloseAt: 1_700_000_000_000,
      now: 1_700_000_000_001,
      credentialVersion: 3,
      connectionVersion: 5,
    }, submit)).resolves.toEqual({
      authorized: true,
      outcome: { status: "acknowledged", exchangeOrderId: "exchange-1" },
    });

    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("set local lock_timeout='5s'");
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain(
      `statement_timeout='${ORDER_SUBMISSION_TRANSACTION_TIMEOUT_MS}ms'`,
    );
    expect(ORDER_SUBMISSION_TIMEOUT_MS).toBeLessThan(ORDER_SUBMISSION_TRANSACTION_TIMEOUT_MS);
    expect(String(transaction.unsafe.mock.calls[1]?.[0])).toContain("join private.weex_credential_blobs b");
    expect(String(transaction.unsafe.mock.calls[1]?.[0])).toContain("for update of c,b");
    expect(String(transaction.unsafe.mock.calls[2]?.[0])).toContain("for update of r,o");
    expect(String(transaction.unsafe.mock.calls[3]?.[0])).toContain("status='unknown'");
    expect(String(transaction.unsafe.mock.calls[4]?.[0])).toContain("set status=$3");
    expect(submit).toHaveBeenCalledOnce();
  });

  it.each([
    ["pending", { status: "pending", permissions_json: { read: true, futuresDemoTrade: true },
      withdrawal_access_absent: true }],
    ["error", { status: "error", permissions_json: { read: true, futuresDemoTrade: true },
      withdrawal_access_absent: true }],
    ["revoked", { status: "revoked", permissions_json: { read: true, futuresDemoTrade: true },
      withdrawal_access_absent: true }],
    ["missing mode permission", { status: "active", permissions_json: { read: true },
      withdrawal_access_absent: true }],
    ["unverified legacy permission", { status: "active",
      permissions_json: { read: true, futuresTrade: true, liveVerified: false },
      withdrawal_access_absent: true }],
    ["withdrawal permission", { status: "active", permissions_json: { read: true, futuresDemoTrade: true },
      withdrawal_access_absent: false }],
  ] as const)("atomically pauses the run when authorization is %s", async (_reason, connection) => {
    const transaction = {
      unsafe: vi.fn()
        .mockResolvedValueOnce(Object.assign([], { count: 0 }))
        .mockResolvedValueOnce([{
          ...connection,
          credential_version: 3,
          connection_version: 5,
        }])
        .mockResolvedValueOnce([{
          mode: "futures-demo",
          market: "futures",
          state: "running",
          lease_owner: "owner-1",
          order_status: "claimed",
        }])
        .mockResolvedValueOnce(Object.assign([], { count: 1 }))
        .mockResolvedValueOnce(Object.assign([], { count: 1 })),
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");
    const submit = vi.fn();

    await expect(repository.submitAuthorizedOrder({
      run,
      owner: "owner-1",
      candleCloseAt: 1_700_000_000_000,
      now: 1_700_000_000_001,
      credentialVersion: 3,
      connectionVersion: 5,
    }, submit)).resolves.toEqual({ authorized: false });

    expect(submit).not.toHaveBeenCalled();
    expect(String(transaction.unsafe.mock.calls[3]?.[0])).toContain("state='paused'");
    expect(String(transaction.unsafe.mock.calls[3]?.[0])).toContain("lease_owner=null");
    expect(transaction.unsafe.mock.calls[3]?.[1]).toContain("connection_authorization_required");
    expect(String(transaction.unsafe.mock.calls[4]?.[0])).toContain("status='rejected'");
  });

  it.each([
    ["credential", { credentialVersion: 2, connectionVersion: 5 }],
    ["connection", { credentialVersion: 3, connectionVersion: 4 }],
  ] as const)("defers a client whose cached %s version predates a completed rotation", async (_kind, version) => {
    const transaction = {
      unsafe: vi.fn()
        .mockResolvedValueOnce(Object.assign([], { count: 0 }))
        .mockResolvedValueOnce([{
          status: "active",
          permissions_json: { read: true, futuresDemoTrade: true },
          withdrawal_access_absent: true,
          credential_version: 3,
          connection_version: 5,
        }])
        .mockResolvedValueOnce([{
          mode: "futures-demo",
          market: "futures",
          state: "running",
          lease_owner: "owner-1",
          order_status: "claimed",
        }])
        .mockResolvedValueOnce(Object.assign([], { count: 1 }))
        .mockResolvedValueOnce(Object.assign([], { count: 1 })),
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");
    const submit = vi.fn();

    await expect(repository.submitAuthorizedOrder({
      run,
      owner: "owner-1",
      candleCloseAt: 1_700_000_000_000,
      now: 1_700_000_000_001,
      ...version,
    }, submit)).resolves.toEqual({ authorized: false });

    expect(submit).not.toHaveBeenCalled();
    expect(transaction.unsafe).toHaveBeenCalledTimes(4);
    expect(String(transaction.unsafe.mock.calls[3]?.[0])).toContain("lease_owner=null");
    expect(transaction.unsafe.mock.calls[3]?.[1]).toEqual([
      run.id, run.userId, 1_700_000_000_001, "owner-1",
    ]);
  });

  it("refuses to cross the exchange boundary after an atomic stop wins the run lock", async () => {
    const transaction = {
      unsafe: vi.fn()
        .mockResolvedValueOnce(Object.assign([], { count: 0 }))
        .mockResolvedValueOnce([{
          status: "active",
          permissions_json: { read: true, futuresDemoTrade: true },
          withdrawal_access_absent: true,
          credential_version: 3,
          connection_version: 5,
        }])
        .mockResolvedValueOnce([{
          mode: "futures-demo",
          market: "futures",
          state: "stopped",
          lease_owner: null,
          order_status: "claimed",
        }]),
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");
    const submit = vi.fn();

    await expect(repository.submitAuthorizedOrder({
      run,
      owner: "owner-1",
      candleCloseAt: 1_700_000_000_000,
      now: 1_700_000_000_001,
      credentialVersion: 3,
      connectionVersion: 5,
    }, submit)).resolves.toEqual({ authorized: false });

    expect(String(transaction.unsafe.mock.calls[2]?.[0])).toContain("for update of r,o");
    expect(submit).not.toHaveBeenCalled();
    expect(transaction.unsafe).toHaveBeenCalledTimes(3);
  });

  it("commits durable unknown evidence before surfacing an ambiguous submission failure", async () => {
    const transaction = {
      unsafe: vi.fn()
        .mockResolvedValueOnce(Object.assign([], { count: 0 }))
        .mockResolvedValueOnce([{
          status: "active",
          permissions_json: { read: true, futuresTrade: true, liveVerified: true },
          withdrawal_access_absent: true,
          credential_version: 3,
          connection_version: 5,
        }])
        .mockResolvedValueOnce([{
          mode: "live",
          market: "futures",
          state: "running",
          lease_owner: "owner-1",
          order_status: "claimed",
        }])
        .mockResolvedValueOnce(Object.assign([], { count: 1 })),
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");
    const failure = new Error("network unavailable");

    await expect(repository.submitAuthorizedOrder({
      run: { ...run, mode: "live" },
      owner: "owner-1",
      candleCloseAt: 1_700_000_000_000,
      now: 1_700_000_000_001,
      credentialVersion: 3,
      connectionVersion: 5,
    }, async () => { throw failure; })).rejects.toBe(failure);

    expect(String(transaction.unsafe.mock.calls[3]?.[0])).toContain("submission_in_progress");
    expect(transaction.unsafe).toHaveBeenCalledTimes(4);
  });
});

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

describe("CloudRuntimeRepository order evidence persistence", () => {
  beforeEach(() => {
    database.unsafe.mockReset().mockResolvedValue(Object.assign([], { count: 1 }));
    database.json.mockClear();
  });

  it("stores a strictly normalized, client-id-bound exchange snapshot without raw provider payloads", async () => {
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");
    await repository.recordOrder({
      runId: "run_1",
      candleCloseAt: 1_700_000_000_000,
      status: "acknowledged",
      exchangeOrderId: "exchange-1",
      errorCode: "exchange_order_filled",
      now: 1_700_000_000_100,
      exchangeEvidence: {
        clientOrderId: "b-WEEX111162-safe-client-id",
        exchangeOrderId: "exchange-1",
        symbol: "BTCUSDT",
        side: "buy",
        quantity: "0.001",
        status: "FILLED",
        cumulativeFilledQuantity: "0.001",
        averageFillPrice: "64001",
        fees: "0.03",
        fills: [{ exchangeFillId: "fill-1", price: "64001", quantity: "0.001", fee: "0.03",
          feeCurrency: "USDT", realizedPnl: "1.25", filledAt: 1_700_000_000_090 }],
      },
    });

    const sql = String(database.unsafe.mock.calls[0]?.[0]);
    const bindings = database.unsafe.mock.calls[0]?.[1] as unknown[];
    expect(sql).toContain("exchange_evidence_json=coalesce($7::jsonb,exchange_evidence_json)");
    expect(sql).toContain("and ($9::text is null or client_order_id=$9)");
    expect(bindings[4]).toBe("exchange-1");
    expect(bindings[6]).toEqual({ json: expect.objectContaining({
      schemaVersion: 1,
      provider: "weex",
      observedAt: 1_700_000_000_100,
      clientOrderId: "b-WEEX111162-safe-client-id",
      fills: [expect.objectContaining({ realizedPnl: "1.25" })],
    }) });
    expect(bindings[8]).toBe("b-WEEX111162-safe-client-id");
  });

  it("rejects mismatched or malformed exchange evidence before a database write", async () => {
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");
    const evidence = {
      clientOrderId: "safe-client-id", exchangeOrderId: "exchange-1", symbol: "BTCUSDT",
      side: "buy" as const, quantity: "0.001", status: "FILLED" as const,
      cumulativeFilledQuantity: "0.001",
    };

    await expect(repository.recordOrder({ runId: "run_1", candleCloseAt: 1, status: "acknowledged",
      exchangeOrderId: "exchange-other", exchangeEvidence: evidence, now: 2 }))
      .rejects.toThrow("Cloud order exchange evidence identity is invalid");
    await expect(repository.recordOrder({ runId: "run_1", candleCloseAt: 1, status: "acknowledged",
      exchangeEvidence: { ...evidence, quantity: "NaN" }, now: 2 }))
      .rejects.toThrow("Cloud order exchange evidence is invalid");
    await expect(repository.recordOrder({ runId: "run_1", candleCloseAt: 1, status: "acknowledged",
      exchangeEvidence: { ...evidence, cumulativeFilledQuantity: "999" }, now: 2 }))
      .rejects.toThrow("Cloud order exchange evidence is invalid");
    await expect(repository.recordOrder({ runId: "run_1", candleCloseAt: 1, status: "acknowledged",
      exchangeEvidence: { ...evidence, status: "PARTIALLY_FILLED", cumulativeFilledQuantity: "0.001" }, now: 2 }))
      .rejects.toThrow("Cloud order exchange evidence is invalid");
    expect(database.unsafe).not.toHaveBeenCalled();
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
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("exchange_evidence_json->>'status'='FILLED'");
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("candle_close_at>$2");
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("order by candle_close_at asc");
    expect(database.unsafe.mock.calls[0]?.[1]).toEqual(["run_1", 1_699_999_900_000]);
  });

  it("reconciles legacy terminal status codes that have no authoritative exchange snapshot", async () => {
    database.unsafe.mockResolvedValueOnce([{
      status: "acknowledged",
      exchange_order_id: "exchange-legacy",
      client_order_id: "cb_legacy_terminal",
      candle_close_at: 1_699_999_940_000,
      created_at: 1_699_999_940_001,
      signal_json: { action: "buy", reason: "legacy" },
      intent_json: { symbol: "BTCUSDT", side: "buy", quantity: "0.001" },
      fresh: false,
    }]);
    const repository = new CloudRuntimeRepository("postgres://executor.invalid/database", "executor-a");

    await expect(repository.blockingOrder("run_1", 1_699_999_940_000)).resolves.toMatchObject({
      status: "acknowledged",
      exchangeOrderId: "exchange-legacy",
      clientOrderId: "cb_legacy_terminal",
    });
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("not coalesce((");
    expect(database.unsafe.mock.calls[0]?.[0]).toContain("exchange_evidence_json");
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
