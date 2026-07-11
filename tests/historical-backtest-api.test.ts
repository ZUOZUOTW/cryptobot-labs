import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../db";
import { createBacktestRepository, createStrategyVersionRepository } from "../db/repositories";
import { cloneStrategyBlock } from "../data/strategies";
import { safeCanonicalJsonStringify } from "../lib/control-plane/schemas";
import {
  createHistoricalBacktestHandlers,
  createHistoricalBacktestService,
  type HistoricalBacktestService,
} from "../lib/server/backtests";
import type { BotConfig } from "../lib/types";
import type { Candle, HistoricalDataset } from "../packages/trading-core/src";
import type { HistoricalFundingDataset } from "../packages/weex-client/src";

class SqliteStatement implements ControlPlaneStatement {
  constructor(private readonly statement: StatementSync, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]): ControlPlaneStatement { return new SqliteStatement(this.statement, values); }
  async first<T>(): Promise<T | null> {
    return (this.statement.get(...this.values as Parameters<StatementSync["get"]>) as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: this.statement.all(...this.values as Parameters<StatementSync["all"]>) as T[], success: true };
  }
  async run(): Promise<ControlPlaneRunResult> {
    const result = this.statement.run(...this.values as Parameters<StatementSync["run"]>);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SqliteDatabase implements ControlPlaneDatabase {
  readonly raw = new DatabaseSync(":memory:");
  constructor() {
    this.raw.exec("PRAGMA foreign_keys = ON");
    const migration = readdirSync(resolve("drizzle")).find((file) => file.endsWith(".sql"));
    if (!migration) throw new Error("migration missing");
    for (const sql of readFileSync(resolve("drizzle", migration), "utf8").split("--> statement-breakpoint")) {
      if (sql.trim()) this.raw.exec(sql);
    }
  }
  prepare(sql: string): ControlPlaneStatement { return new SqliteStatement(this.raw.prepare(sql)); }
  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const output: ControlPlaneRunResult[] = [];
      for (const statement of statements) output.push(await statement.run());
      this.raw.exec("COMMIT");
      return output;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
}

const config = (overrides: Partial<BotConfig> = {}): BotConfig => ({
  id: "historical-api", name: "Historical API", exchange: "WEEX", market: "futures", symbol: "BTCUSDT",
  timeframe: "1h", logicMode: "all", leverage: 2,
  blocks: [cloneStrategyBlock("rsi"), cloneStrategyBlock("stop-loss")], ...overrides,
});

const digest = async (value: unknown): Promise<string> => {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(safeCanonicalJsonStringify(normalized)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const request = (overrides: Record<string, unknown> = {}) => ({
  strategyVersionId: "version_a", market: "futures" as const, symbol: "BTCUSDT", interval: "1h",
  startTime: 0, endTime: 7_200_000, initialCapital: "1000", feeRate: "0.001", slippageRate: "0.0005",
  leverage: "2", fundingMode: "none" as const, gapPolicy: "fail" as const, ...overrides,
});

const candles = (): Candle[] => [100, 90, 80].map((price, index) => ({
  openTime: index * 3_600_000, closeTime: (index + 1) * 3_600_000 - 1,
  open: String(price), high: String(price + 1), low: String(price - 1), close: String(price), volume: "10", complete: true,
}));

const dataset = (overrides: Partial<HistoricalDataset> = {}): HistoricalDataset => ({
  request: { market: "futures", symbol: "BTCUSDT", interval: "1h", startTime: 0, endTime: 7_200_000 },
  candles: candles(), intervalMs: 3_600_000, complete: true,
  validation: { duplicates: [], ordered: true, gaps: [], incompleteCount: 0 },
  provenance: { provider: "WEEX", sourceKind: "public-api", endpoint: "/capi/v3/market/historyKlines",
    collectedAt: 8_000_000, singleResponse: true, paginated: false, truncated: false,
    requestedStartTime: 0, requestedEndTime: 7_200_000, returnedStartTime: 0, returnedEndTime: 10_800_000 },
  ...overrides,
});

const funding = (complete = true): HistoricalFundingDataset => ({
  request: { market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 7_200_000, strict: true },
  funding: [{ timestamp: 3_600_000, rate: "0.0001", markPrice: "90" }], complete,
  coverage: { requestedStartTime: 0, requestedEndTime: 7_200_000, fundingRangeCovered: complete,
    requestedEvents: 1, matchedEvents: complete ? 1 : 0, missingMarkTimestamps: complete ? [] : [3_600_000] },
  provenance: { provider: "WEEX", sourceKind: "public-api", fundingEndpoint: "/capi/v2/market/getHistoryFundRate",
    markEndpoint: "/capi/v3/market/historyKlines", priceType: "MARK", collectedAt: 8_000_000,
    fundingLimit: 100, markMaxAgeMs: 14_400_000, markPages: 1, markCandles: 3, truncated: false },
});

describe("historical backtest API", () => {
  let database: SqliteDatabase;
  let service: HistoricalBacktestService;
  let collectCandles: ReturnType<typeof vi.fn>;
  let collectFunding: ReturnType<typeof vi.fn>;
  let ids: number;

  beforeEach(async () => {
    database = new SqliteDatabase();
    const value = config();
    const hash = await digest(value);
    database.raw.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run("usr_a", "a@example.com", "A", 1, 1);
    database.raw.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run("usr_b", "b@example.com", "B", 1, 1);
    database.raw.prepare("INSERT INTO strategies VALUES (?,?,?,?,?,?,?)")
      .run("strategy_a", "usr_a", "A", "futures", "BTCUSDT", 1, 1);
    database.raw.prepare("INSERT INTO strategy_versions VALUES (?,?,?,?,?,?,?,?,?)")
      .run("version_a", "usr_a", "strategy_a", 1, hash, null, JSON.stringify(value), null, 1);
    collectCandles = vi.fn(async () => dataset());
    collectFunding = vi.fn(async () => funding());
    ids = 0;
    service = createHistoricalBacktestService({
      backtests: createBacktestRepository(database), strategies: createStrategyVersionRepository(database),
      marketData: { collectHistoricalCandles: collectCandles, collectHistoricalFunding: collectFunding },
      now: () => 10_800_000, newId: (prefix) => `${prefix}_${++ids}`,
    });
  });

  it("runs synchronously, persists truthful provenance, and never refetches an idempotent retry", async () => {
    const first = await service.create("usr_a", "request-1", request());
    expect(first).toMatchObject({ idempotent: false, job: { status: "succeeded" } });
    expect(collectCandles).toHaveBeenCalledTimes(1);
    expect(collectFunding).not.toHaveBeenCalled();
    const replay = await service.create("usr_a", "request-1", request());
    expect(replay).toMatchObject({ idempotent: true, job: { id: (first.job as { id: string }).id, status: "succeeded" } });
    expect(collectCandles).toHaveBeenCalledTimes(1);
    const stored = database.raw.prepare(`SELECT d.source, d.gaps_json AS gaps, d.checksum,
      r.funding_json AS funding, r.provenance_json AS provenance, r.script_hash AS scriptHash
      FROM backtest_datasets d JOIN backtest_results r ON r.backtest_job_id=d.backtest_job_id`).get() as Record<string, unknown>;
    expect(stored.source).toBe("WEEX /capi/v3/market/historyKlines");
    expect(stored.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(String(stored.funding))).toEqual({ mode: "none", events: [] });
    expect(JSON.parse(String(stored.provenance))).toMatchObject({ provider: "WEEX", fundingMode: "none" });
    expect(stored.scriptHash).toBeNull();
  });

  it("rejects ownership leaks and conflicting idempotency reuse", async () => {
    await service.create("usr_a", "same-key", request());
    await expect(service.create("usr_a", "same-key", request({ initialCapital: "2000" })))
      .rejects.toMatchObject({ status: 409, code: "conflict" });
    expect(await service.get("usr_b", "job_1")).toBeNull();
    expect((await service.list("usr_b", { limit: 10 })).items).toEqual([]);
  });

  it("persists a bounded public failure when the WEEX public fetch fails", async () => {
    collectCandles.mockRejectedValueOnce(new Error("secret upstream details API_KEY=do-not-store"));
    await expect(service.create("usr_a", "fetch-fails", request()))
      .rejects.toMatchObject({ status: 502, code: "data_fetch_failed" });
    const row = database.raw.prepare("SELECT status,error_code,error_message FROM backtest_jobs").get() as Record<string, unknown>;
    expect(row).toEqual({ status: "failed", error_code: "data_fetch_failed",
      error_message: "WEEX public historical data could not be collected." });
    expect(JSON.stringify(row)).not.toContain("API_KEY");
  });

  it("requires strict complete futures funding and never substitutes zero", async () => {
    collectFunding.mockResolvedValueOnce(funding(false));
    await expect(service.create("usr_a", "funding-incomplete", request({ fundingMode: "historical" })))
      .rejects.toMatchObject({ status: 422, code: "historical_funding_incomplete" });
    expect(collectFunding).toHaveBeenCalledWith(expect.objectContaining({ market: "futures", strict: true }));
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM backtest_results").get()).toEqual({ count: 0 });
  });

  it("honors fail/disclose gaps and persists disclosed gaps", async () => {
    const gapped = dataset({ complete: false,
      validation: { duplicates: [], ordered: true, gaps: [{ from: 3_600_000, to: 7_200_000 }], incompleteCount: 0 } });
    collectCandles.mockResolvedValue(gapped);
    await expect(service.create("usr_a", "gap-fail", request())).rejects.toMatchObject({ code: "historical_dataset_incomplete" });
    const disclosed = await service.create("usr_a", "gap-disclose", request({ gapPolicy: "disclose" }));
    expect(disclosed.job).toMatchObject({ status: "succeeded" });
    const stored = database.raw.prepare("SELECT gaps_json FROM backtest_datasets").get() as { gaps_json: string };
    expect(JSON.parse(stored.gaps_json)).toEqual([{ from: 3_600_000, to: 7_200_000 }]);
  });

  it("rejects custom source before any fetch because QuickJS is unavailable", async () => {
    const custom = config({ source: "return { action: 'buy' };" });
    const hash = await digest(custom);
    database.raw.prepare("UPDATE strategy_versions SET config_hash=?,config_json=?,source_hash=?,source_code=? WHERE id='version_a'")
      .run(hash, JSON.stringify(custom), "a".repeat(64), custom.source!);
    await expect(service.create("usr_a", "custom", request()))
      .rejects.toMatchObject({ status: 422, code: "custom_strategy_runtime_unavailable" });
    expect(collectCandles).not.toHaveBeenCalled();
  });

  it("enforces authenticated same-origin POST and exact JSON at the handler boundary", async () => {
    const identity = { getIdentity: vi.fn(async () => ({ email: "a@example.com", displayName: "A" })) };
    const handlers = createHistoricalBacktestHandlers({
      auth: { identityProvider: identity,
        userRepository: { upsertIdentity: vi.fn(async () => ({ id: "usr_a", normalizedEmail: "a@example.com",
          displayName: "A", createdAt: 1, updatedAt: 1 })) }, deriveUserId: async () => "usr_a", now: () => 1 },
      originPolicy: { publicOrigin: "https://labs.example" }, service,
    });
    const response = await handlers.post(new Request("https://labs.example/api/backtests", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example",
        "sec-fetch-site": "cross-site", "idempotency-key": "handler" }, body: JSON.stringify(request()),
    }));
    expect(response.status).toBe(403);
    expect(collectCandles).not.toHaveBeenCalled();
  });
});
