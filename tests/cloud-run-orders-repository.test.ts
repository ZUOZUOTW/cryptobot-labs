// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneStatement } from "../db";
import { createCloudRunRepository } from "../lib/server/cloud-runs";

const row = {
  runId: "crun_owner_1",
  candleCloseAt: 1_700_000_000_000,
  createdAt: 1_700_000_000_001,
  updatedAt: 1_700_000_000_100,
  lifecycleStatus: "acknowledged",
  evidenceLevel: "authoritative",
  errorCode: "exchange_order_filled",
  clientOrderId: "b-WEEX111162-safe-client-id",
  exchangeOrderId: "exchange-1",
  symbol: "BTCUSDT",
  side: "buy",
  quantity: "0.001",
  requestedPrice: "64000",
  providerStatus: "FILLED",
  cumulativeFilledQuantity: "0.001",
  averageFillPrice: "64001",
  fees: "0.03",
  fillsJson: [{ exchangeFillId: "fill-1", price: "64001", quantity: "0.001",
    fee: "0.03", feeCurrency: "USDT", realizedPnl: "1.25", filledAt: 1_700_000_000_090 }],
  evidenceObservedAt: 1_700_000_000_100,
};

describe("cloud run order evidence repository", () => {
  it("uses only the owner-scoped execute-only gateway and normalizes its secret-free projection", async () => {
    let preparedSql = "";
    let bindings: unknown[] = [];
    const statement: ControlPlaneStatement = {
      bind(...values: unknown[]) { bindings = values; return this; },
      async first<T>() { return null as T | null; },
      async all<T>() { return { results: [row] as unknown as T[], success: true }; },
      async run() { return { success: true, meta: {} }; },
    };
    const database: ControlPlaneDatabase = {
      dialect: "postgres",
      prepare(sql) { preparedSql = sql; return statement; },
      batch: vi.fn(async () => []),
    };

    const orders = await createCloudRunRepository(database).orders("user_1", "crun_owner_1", 20);

    expect(orders).toEqual([expect.objectContaining({
      runId: "crun_owner_1",
      providerStatus: "FILLED",
      cumulativeFilledQuantity: "0.001",
      fees: "0.03",
      fills: [expect.objectContaining({ realizedPnl: "1.25" })],
    })]);
    expect(preparedSql).toContain("from private.list_cloud_run_order_evidence(?,?,?)");
    expect(preparedSql).not.toContain("from private.cloud_order_intents");
    expect(bindings).toEqual(["user_1", "crun_owner_1", 20]);
  });

  it("does not invent provider evidence for an unknown order", async () => {
    const database: ControlPlaneDatabase = {
      dialect: "postgres",
      prepare: () => ({
        bind() { return this; },
        async first<T>() { return null as T | null; },
        async all<T>() { return { results: [{ ...row, lifecycleStatus: "unknown",
          evidenceLevel: "uncertain", providerStatus: null, exchangeOrderId: null,
          cumulativeFilledQuantity: null, averageFillPrice: null, fees: null,
          fillsJson: [], evidenceObservedAt: null }] as T[], success: true }; },
        async run() { return { success: true, meta: {} }; },
      }),
      async batch() { return []; },
    };

    await expect(createCloudRunRepository(database).orders("user_1", "crun_owner_1"))
      .resolves.toEqual([expect.objectContaining({
        lifecycleStatus: "unknown", evidenceLevel: "uncertain", providerStatus: null,
        cumulativeFilledQuantity: null, fills: [],
      })]);
  });

  it("fails closed on a contradictory provider projection", async () => {
    const database: ControlPlaneDatabase = {
      dialect: "postgres",
      prepare: () => ({
        bind() { return this; },
        async first<T>() { return null as T | null; },
        async all<T>() { return { results: [{ ...row, evidenceLevel: "uncertain" }] as T[], success: true }; },
        async run() { return { success: true, meta: {} }; },
      }),
      async batch() { return []; },
    };

    await expect(createCloudRunRepository(database).orders("user_1", "crun_owner_1"))
      .rejects.toThrow("Cloud order evidence projection is invalid");
  });

  it.each([
    ["fill above quantity", { cumulativeFilledQuantity: "999" }],
    ["filled below quantity", { cumulativeFilledQuantity: "0.0009" }],
    ["partial at full quantity", { providerStatus: "PARTIALLY_FILLED", cumulativeFilledQuantity: "0.001" }],
    ["new with a fill", { providerStatus: "NEW", cumulativeFilledQuantity: "0.0001" }],
    ["rejected with a fill", { providerStatus: "REJECTED", cumulativeFilledQuantity: "0.0001" }],
  ])("fails closed on authoritative %s", async (_label, override) => {
    const database: ControlPlaneDatabase = {
      dialect: "postgres",
      prepare: () => ({
        bind() { return this; },
        async first<T>() { return null as T | null; },
        async all<T>() { return { results: [{ ...row, ...override }] as T[], success: true }; },
        async run() { return { success: true, meta: {} }; },
      }),
      async batch() { return []; },
    };

    await expect(createCloudRunRepository(database).orders("user_1", "crun_owner_1"))
      .rejects.toThrow("Cloud order evidence projection is invalid");
  });

  it("returns no private evidence on a SQLite/D1 fixture", async () => {
    const prepare = vi.fn();
    const database = { dialect: "sqlite" as const, prepare, batch: vi.fn() } as unknown as ControlPlaneDatabase;

    await expect(createCloudRunRepository(database).orders("user_1", "crun_owner_1")).resolves.toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
  });
});
