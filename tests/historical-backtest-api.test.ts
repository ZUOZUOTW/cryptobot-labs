// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { POST as publicHistoricalBacktestPost } from "../app/api/weex/historical-backtest/route";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../db";
import { createBacktestRepository, createStrategyVersionRepository } from "../db/repositories";
import { cloneStrategyBlock } from "../data/strategies";
import { safeCanonicalJsonStringify } from "../lib/control-plane/schemas";
import type { BacktestJobCreateDto } from "../lib/control-plane/types";
import {
  createHistoricalBacktestHandlers,
  createHistoricalBacktestService,
  type HistoricalBacktestService,
} from "../lib/server/backtests";
import type { BotConfig } from "../lib/types";
import {
  SandboxExecutionError,
  type Candle,
  type HistoricalDataset,
  type SandboxEvaluation,
} from "../packages/trading-core/src";
import {
  DEFAULT_FUNDING_MARK_MAX_AGE_MS, FUNDING_HISTORY_LIMIT, MAX_FUNDING_MARK_PAGES,
  WeexPublicClient, type HistoricalFundingDataset, type HttpTransport,
} from "../packages/weex-client/src";

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
const digestText=async(value:string):Promise<string>=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))]
  .map((byte)=>byte.toString(16).padStart(2,"0")).join("");

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

const installSourceStrategy = async (
  database: SqliteDatabase,
  source: string,
  overrides: Partial<BotConfig> = {},
): Promise<{ config: BotConfig; scriptHash: string }> => {
  const custom = config({ blocks: [], source, ...overrides });
  const scriptHash = await digestText(source);
  database.raw.prepare("UPDATE strategy_versions SET config_hash=?,config_json=?,source_hash=?,source_code=? WHERE id='version_a'")
    .run(await digest(custom), JSON.stringify(custom), scriptHash, source);
  return { config: custom, scriptHash };
};

describe("historical backtest API", () => {
  let database: SqliteDatabase;
  let service: HistoricalBacktestService;
  let collectCandles: Mock<(request: BacktestJobCreateDto, signal?: AbortSignal) => Promise<HistoricalDataset>>;
  let collectFunding: Mock<(request: { market: "futures"; symbol: string; startTime: number; endTime: number;
    strict: true }, signal?: AbortSignal) => Promise<HistoricalFundingDataset>>;
  let ids: number;
  let clock: number;

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
    clock = 10_800_000;
    service = createHistoricalBacktestService({
      backtests: createBacktestRepository(database), strategies: createStrategyVersionRepository(database),
      marketData: { collectHistoricalCandles: collectCandles, collectHistoricalFunding: collectFunding },
      now: () => clock, newId: (prefix) => `${prefix}_${++ids}`,
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
    const stored = database.raw.prepare(`SELECT d.source, d.gaps_json AS gaps, d.checksum, d.actual_end_at AS actualEnd,
      r.funding_json AS funding, r.provenance_json AS provenance, r.equity_curve_json AS equity, r.script_hash AS scriptHash
      FROM backtest_datasets d JOIN backtest_results r ON r.backtest_job_id=d.backtest_job_id`).get() as Record<string, unknown>;
    expect(stored.source).toBe("WEEX /capi/v3/market/historyKlines");
    expect(stored.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.actualEnd).toBe(7_199_999);
    expect(Math.max(...(JSON.parse(String(stored.equity)) as Array<{ timestamp: number }>).map(({ timestamp }) => timestamp)))
      .toBeLessThan(7_200_000);
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

  it("aborts between pagination pages, persists failed, and performs no later transport", async () => {
    const controller = new AbortController();
    const endTime = 101 * 3_600_000;
    clock = endTime;
    let calls = 0;
    const transport: HttpTransport = { async send() {
      calls += 1;
      if (calls > 1) throw new Error("transport called after abort");
      const body = Array.from({ length: 100 }, (_, index) => {
        const openTime = index * 3_600_000;
        return [openTime, "100", "101", "99", "100", "1", openTime + 3_600_000 - 1, "1", 1, "1", "1"];
      });
      controller.abort(new Error("workflow deadline"));
      return { status: 200, headers: {}, body };
    } };
    let abortId = 0;
    const aborting = createHistoricalBacktestService({ backtests: createBacktestRepository(database),
      strategies: createStrategyVersionRepository(database), marketData: new WeexPublicClient(transport, () => clock),
      now: () => clock, newId: (prefix) => `${prefix}_abort_${++abortId}` });
    await expect(aborting.create("usr_a", "abort-pagination", request({ endTime }), controller.signal))
      .rejects.toMatchObject({ code: "data_fetch_failed" });
    expect(calls).toBe(1);
    expect(database.raw.prepare("SELECT status,error_code FROM backtest_jobs").get())
      .toEqual({ status: "failed", error_code: "data_fetch_failed" });
  });

  it("requires strict complete futures funding and never substitutes zero", async () => {
    collectFunding.mockResolvedValueOnce(funding(false));
    await expect(service.create("usr_a", "funding-incomplete", request({ fundingMode: "historical" })))
      .rejects.toMatchObject({ status: 422, code: "historical_funding_incomplete" });
    expect(collectFunding).toHaveBeenCalledWith(expect.objectContaining({ market: "futures", strict: true }), undefined);
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM backtest_results").get()).toEqual({ count: 0 });
  });

  it("rejects forged candle and funding provenance rather than trusting transport metadata", async () => {
    collectCandles.mockResolvedValueOnce(dataset({ provenance: { ...dataset().provenance, provider: "Other" } }));
    await expect(service.create("usr_a", "bad-candle-provenance", request()))
      .rejects.toMatchObject({ code: "historical_dataset_incomplete" });
    collectCandles.mockResolvedValueOnce(dataset());
    collectFunding.mockResolvedValueOnce({ ...funding(),
      provenance: { ...funding().provenance, fundingEndpoint: "/private/funding" as never } });
    await expect(service.create("usr_a", "bad-funding-provenance", request({ fundingMode: "historical" })))
      .rejects.toMatchObject({ code: "historical_funding_incomplete" });
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM backtest_results").get()).toEqual({ count: 0 });
  });

  it("rejects unsafe economic inputs before creating a job or contacting WEEX", async () => {
    for (const [key, overrides] of [
      ["zero-capital", { initialCapital: "0" }],
      ["huge-capital", { initialCapital: "100000001" }],
      ["fee-cap", { feeRate: "0.051" }],
      ["slippage-cap", { slippageRate: "0.101" }],
      ["leverage-cap", { leverage: "501" }],
      ["long-decimal", { feeRate: `0.${"0".repeat(40)}1` }],
    ] as const) {
      await expect(service.create("usr_a", key, request(overrides)))
        .rejects.toMatchObject({ status: 422, code: "invalid_economic_parameters" });
    }
    expect(collectCandles).not.toHaveBeenCalled();
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM backtest_jobs").get()).toEqual({ count: 0 });
  });

  it("accepts a WEEX high-leverage product within the 500x engine boundary", async () => {
    const value = config({ leverage: 400 });
    database.raw.prepare("UPDATE strategy_versions SET config_hash=?,config_json=? WHERE id='version_a'")
      .run(await digest(value), JSON.stringify(value));
    await expect(service.create("usr_a", "four-hundred-x", request({ leverage: "400" })))
      .resolves.toMatchObject({ job: { status: "succeeded" } });
    expect(collectCandles).toHaveBeenCalledTimes(1);
  });

  it("caps synchronous POST work at 2000 expected candles before transport", async () => {
    const endTime = 2_001 * 3_600_000;
    clock = endTime;
    await expect(service.create("usr_a", "too-many-candles", request({ endTime })))
      .rejects.toMatchObject({ status: 422, code: "invalid_historical_range" });
    expect(collectCandles).not.toHaveBeenCalled();
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM backtest_jobs").get()).toEqual({ count: 0 });
  });

  it("supports a non-epoch weekly anchor while retaining exact exclusive boundaries", async () => {
    const interval = 604_800_000;
    const startTime = 123_456_789;
    const endTime = startTime + interval * 2;
    const value = config({ timeframe: "1w" });
    database.raw.prepare("UPDATE strategy_versions SET config_hash=?,config_json=? WHERE id='version_a'")
      .run(await digest(value), JSON.stringify(value));
    clock = endTime;
    collectCandles.mockResolvedValueOnce(dataset({
      request: { market: "futures", symbol: "BTCUSDT", interval: "1w", startTime, endTime },
      intervalMs: interval,
      candles: [100, 101].map((price, index) => ({
        openTime: startTime + index * interval, closeTime: startTime + (index + 1) * interval - 1,
        open: String(price), high: String(price + 1), low: String(price - 1), close: String(price),
        volume: "10", complete: true,
      })),
      provenance: { ...dataset().provenance, collectedAt: endTime, requestedStartTime: startTime,
        requestedEndTime: endTime, returnedStartTime: startTime, returnedEndTime: endTime },
    }));
    await expect(service.create("usr_a", "weekly-anchor", request({ interval: "1w", startTime, endTime })))
      .resolves.toMatchObject({ job: { status: "succeeded", actualStartAt: startTime, actualEndAt: endTime - 1 } });
  });

  it("rejects funding metadata outside exact collector constants", async () => {
    const manyEvents = Array.from({ length: FUNDING_HISTORY_LIMIT + 1 }, (_, index) => ({
      timestamp: index * 1_000, rate: "0.0001", markPrice: "100",
    }));
    const cases: HistoricalFundingDataset[] = [
      { ...funding(), funding: manyEvents,
        coverage: { ...funding().coverage, requestedEvents: manyEvents.length, matchedEvents: manyEvents.length },
        provenance: { ...funding().provenance, markPages: 2, markCandles: manyEvents.length } },
      { ...funding(), provenance: { ...funding().provenance, fundingLimit: 99 as 100 } },
      { ...funding(), provenance: { ...funding().provenance, markPages: MAX_FUNDING_MARK_PAGES + 1, markCandles: 3 } },
      { ...funding(), provenance: { ...funding().provenance, markPages: 1, markCandles: 101 } },
      { ...funding(), provenance: { ...funding().provenance, markMaxAgeMs: DEFAULT_FUNDING_MARK_MAX_AGE_MS + 1 } },
      { ...funding(), funding: [], coverage: { ...funding().coverage, requestedEvents: 0, matchedEvents: 0 },
        provenance: { ...funding().provenance, markPages: 1, markCandles: 1 } },
    ];
    for (const [index, forged] of cases.entries()) {
      collectFunding.mockResolvedValueOnce(forged);
      await expect(service.create("usr_a", `funding-constants-${index}`,
        request({ fundingMode: "historical" }))).rejects.toMatchObject({ code: "historical_funding_incomplete" });
    }
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM backtest_results").get()).toEqual({ count: 0 });
  });

  it("honors fail/disclose gaps and persists disclosed gaps", async () => {
    const gapped = dataset({
      request: { market: "futures", symbol: "BTCUSDT", interval: "1h", startTime: 0, endTime: 10_800_000 },
      candles: [candles()[0]!, candles()[2]!], complete: false,
      validation: { duplicates: [], ordered: true, gaps: [{ from: 3_600_000, to: 7_199_999 }], incompleteCount: 0 },
      provenance: { ...dataset().provenance, requestedEndTime: 10_800_000, returnedEndTime: 10_800_000 },
    });
    collectCandles.mockResolvedValue(gapped);
    await expect(service.create("usr_a", "gap-fail", request({ endTime: 10_800_000 })))
      .rejects.toMatchObject({ code: "historical_dataset_incomplete" });
    const disclosed = await service.create("usr_a", "gap-disclose", request({ endTime: 10_800_000, gapPolicy: "disclose" }));
    expect(disclosed.job).toMatchObject({ status: "succeeded" });
    const stored = database.raw.prepare("SELECT gaps_json FROM backtest_datasets").get() as { gaps_json: string };
    expect(JSON.parse(stored.gaps_json)).toEqual([{ from: 3_600_000, to: 7_199_999 }]);
  });

  it("runs custom source in QuickJS and persists its verified script hash", async () => {
    const source = `export const strategy={exchange:"WEEX",market:"futures",symbol:"BTCUSDT",timeframe:"1h"};\nexport default () => ({action:"hold",reason:"test-hold"});`;
    const custom = config({ blocks: [], source });
    const hash = await digest(custom);
    database.raw.prepare("UPDATE strategy_versions SET config_hash=?,config_json=?,source_hash=?,source_code=? WHERE id='version_a'")
      .run(hash, JSON.stringify(custom), await digestText(source), source);
    await expect(service.create("usr_a", "custom", request())).resolves.toMatchObject({job:{status:"succeeded"}});
    expect(collectCandles).toHaveBeenCalledTimes(1);
    const stored=database.raw.prepare("SELECT r.script_hash AS scriptHash FROM backtest_results r JOIN backtest_request_keys k ON k.backtest_job_id=r.backtest_job_id WHERE k.key='custom'").get();
    expect(stored).toEqual({scriptHash:await digestText(source)});
    database.raw.prepare("UPDATE strategy_versions SET source_hash=? WHERE id='version_a'").run("a".repeat(64));
    await expect(service.create("usr_a","custom-tampered",request())).rejects.toMatchObject({status:500,code:"strategy_integrity_failed"});
    expect(collectCandles).toHaveBeenCalledTimes(1);
  });

  it("applies long-only direction policy to source signals before historical matching", async () => {
    const source = `export const strategy={exchange:"WEEX",market:"futures",symbol:"BTCUSDT",timeframe:"1h"};\nexport default () => ({action:"sell",reason:"attempt-short"});`;
    const { scriptHash } = await installSourceStrategy(database, source, { tradeDirection: "long" });

    await expect(service.create("usr_a", "source-long-only", request()))
      .resolves.toMatchObject({ job: { status: "succeeded" } });
    const stored = database.raw.prepare("SELECT metrics_json AS metrics,script_hash AS scriptHash FROM backtest_results").get() as {
      metrics: string;
      scriptHash: string;
    };
    expect(JSON.parse(stored.metrics)).toMatchObject({ trades: 0 });
    expect(stored.scriptHash).toBe(scriptHash);
  });

  it.each(["deadline-exceeded", "resource-exhausted"] as const)(
    "fails source evidence on the first sandbox %s error",
    async (code) => {
      const source = `export const strategy={exchange:"WEEX",market:"futures",symbol:"BTCUSDT",timeframe:"1h"};\nexport default () => ({action:"hold",reason:"never"});`;
      await installSourceStrategy(database, source);
      const evaluate = vi.fn(async () => {
        throw new SandboxExecutionError(code, "sandbox budget exceeded");
      });
      const dispose = vi.fn(async () => undefined);
      let localIds = 0;
      const guarded = createHistoricalBacktestService({
        backtests: createBacktestRepository(database), strategies: createStrategyVersionRepository(database),
        marketData: { collectHistoricalCandles: collectCandles, collectHistoricalFunding: collectFunding },
        now: () => clock, newId: (prefix) => `${prefix}_fatal_${++localIds}`,
        createSandbox: async () => ({ evaluate, dispose }),
      });

      await expect(guarded.create("usr_a", `source-${code}`, request()))
        .rejects.toMatchObject({ status: 422, code: "backtest_execution_failed" });
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(database.raw.prepare("SELECT status,error_code FROM backtest_jobs").get())
        .toEqual({ status: "failed", error_code: "backtest_execution_failed" });
      expect(database.raw.prepare("SELECT COUNT(*) AS count FROM backtest_results").get()).toEqual({ count: 0 });
    },
  );

  it("caps cumulative sandbox execution across candles and never records success", async () => {
    const source = `export const strategy={exchange:"WEEX",market:"futures",symbol:"BTCUSDT",timeframe:"1h"};\nexport default () => ({action:"hold",reason:"slow"});`;
    const { scriptHash } = await installSourceStrategy(database, source);
    const evaluate = vi.fn(async ({ input }: SandboxEvaluation) => ({
      signal: { id: `slow-${input.now}`, action: "hold" as const, reason: "slow", createdAt: input.now },
      scriptHash,
      durationMs: 3_000,
    }));
    const dispose = vi.fn(async () => undefined);
    let localIds = 0;
    const guarded = createHistoricalBacktestService({
      backtests: createBacktestRepository(database), strategies: createStrategyVersionRepository(database),
      marketData: { collectHistoricalCandles: collectCandles, collectHistoricalFunding: collectFunding },
      now: () => clock, newId: (prefix) => `${prefix}_cumulative_${++localIds}`,
      createSandbox: async () => ({ evaluate, dispose }),
    });

    await expect(guarded.create("usr_a", "source-cumulative-budget", request()))
      .rejects.toMatchObject({ status: 422, code: "backtest_execution_failed" });
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM backtest_results").get()).toEqual({ count: 0 });
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

  it("returns an explicit public list summary without tenant or raw persistence fields", async () => {
    await service.create("usr_a", "list-item", request());
    const handlers = createHistoricalBacktestHandlers({
      auth: { identityProvider: { getIdentity: async () => ({ email: "a@example.com", displayName: "A" }) },
        userRepository: { upsertIdentity: async () => ({ id: "usr_a", normalizedEmail: "a@example.com",
          displayName: "A", createdAt: 1, updatedAt: 1 }) }, deriveUserId: async () => "usr_a", now: () => 1 },
      originPolicy: { publicOrigin: "https://labs.example" }, service,
    });
    const response = await handlers.list(new Request("https://labs.example/api/backtests?limit=10"));
    const body = await response.json() as { items: Array<Record<string, unknown>>; nextCursor: string | null };
    expect(response.status).toBe(200);
    expect(body.items[0]).toMatchObject({ id: "job_1", status: "succeeded",
      request: { strategyVersionId: "version_a" } });
    expect(body.items[0]).not.toHaveProperty("userId");
    expect(body.items[0]).not.toHaveProperty("requestJson");
    expect(body.nextCursor).toBeNull();
  });

  it("cleans the workflow deadline timer after a synchronous POST completes", async () => {
    vi.useFakeTimers();
    try {
      const handlers = createHistoricalBacktestHandlers({
        auth: { identityProvider: { getIdentity: async () => ({ email: "a@example.com", displayName: "A" }) },
          userRepository: { upsertIdentity: async () => ({ id: "usr_a", normalizedEmail: "a@example.com",
            displayName: "A", createdAt: 1, updatedAt: 1 }) }, deriveUserId: async () => "usr_a", now: () => 1 },
        originPolicy: { publicOrigin: "https://labs.example" },
        service: { create: async () => ({ idempotent: true, job: { id: "job_x", userId: "usr_a",
          strategyVersionId: "version_a", status: "queued", evidenceLevel: "historical", requestJson: "{}",
          errorCode: null, errorMessage: null, createdAt: 1, startedAt: null, completedAt: null } }),
          get: async () => null, list: async () => ({ items: [], nextCursor: null }) },
      });
      const response = await handlers.post(new Request("https://labs.example/api/backtests", {
        method: "POST", headers: { host: "labs.example", origin: "https://labs.example",
          "content-type": "application/json", "idempotency-key": "timer" }, body: JSON.stringify(request()),
      }));
      expect(response.status).toBe(200);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("rejects source code at the unauthenticated quick-backtest boundary", async () => {
    const source = `export const strategy={exchange:"WEEX",market:"futures",symbol:"BTCUSDT",timeframe:"1h"};\nexport default () => ({action:"hold",reason:"test"});`;
    const response = await publicHistoricalBacktestPost(new Request("https://labs.example/api/weex/historical-backtest", {
      method: "POST",
      headers: { host: "labs.example", origin: "https://labs.example", "content-type": "application/json" },
      body: JSON.stringify({
        config: config({ blocks: [], source }),
        assumptions: { feeRate: "0.001", slippageRate: "0.0005", fundingMode: "none", gapPolicy: "fail" },
      }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "source_backtest_requires_auth" } });
  });
});
