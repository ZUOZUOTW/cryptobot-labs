// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../db";
import { cloneStrategyBlock } from "../data/strategies";
import {
  createProductionTradingHandlers,
  productionTradingFailure,
  tradingEnvironmentForRequest,
} from "../lib/server/backtest-runtime";
import type { BotConfig } from "../lib/types";

class Statement implements ControlPlaneStatement {
  constructor(private readonly statement: StatementSync, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]): ControlPlaneStatement { return new Statement(this.statement, values); }
  async first<T>(): Promise<T | null> {
    return (this.statement.get(...this.values as Parameters<StatementSync["get"]>) as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: this.statement.all(...this.values as Parameters<StatementSync["all"]>) as T[], success: true };
  }
  async run(): Promise<ControlPlaneRunResult> {
    return { success: true, meta: { changes: Number(this.statement.run(
      ...this.values as Parameters<StatementSync["run"]>).changes) } };
  }
}

class Database implements ControlPlaneDatabase {
  readonly raw = new DatabaseSync(":memory:");
  constructor() {
    this.raw.exec("PRAGMA foreign_keys=ON");
    const file = readdirSync(resolve("drizzle")).find((name) => name.endsWith(".sql"))!;
    for (const sql of readFileSync(resolve("drizzle", file), "utf8").split("--> statement-breakpoint")) {
      if (sql.trim()) this.raw.exec(sql);
    }
  }
  prepare(sql: string): ControlPlaneStatement { return new Statement(this.raw.prepare(sql)); }
  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results: ControlPlaneRunResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) { this.raw.exec("ROLLBACK"); throw error; }
  }
}

const config = (overrides: Partial<BotConfig> = {}): BotConfig => ({
  id: "saved", name: "Saved visual strategy", exchange: "WEEX", market: "futures", symbol: "BTCUSDT",
  timeframe: "1h", logicMode: "all", leverage: 2,
  blocks: [cloneStrategyBlock("rsi"), cloneStrategyBlock("stop-loss")], ...overrides,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("backtest runtime and strategy save wiring", () => {
  it("uses Netlify's canonical site URL or the request origin when PUBLIC_ORIGIN is absent", () => {
    expect(tradingEnvironmentForRequest({ URL: "https://labs.example" }, new Request("https://preview.example/api/strategies")))
      .toMatchObject({ PUBLIC_ORIGIN: "https://labs.example" });
    expect(tradingEnvironmentForRequest({}, new Request("https://preview.example/api/strategies")))
      .toMatchObject({ PUBLIC_ORIGIN: "https://preview.example" });
  });

  it("wires the real detail GET route through fail-closed environment initialization", async () => {
    vi.stubEnv("PUBLIC_ORIGIN", "");
    vi.stubEnv("SUPABASE_DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL", "");
    const route = await import("../app/api/backtests/[id]/route");
    const response = await route.GET(new Request("https://labs.example/api/backtests/job_1"), {
      params: Promise.resolve({ id: "job_1" }),
    });
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed and returns only a generic no-store initialization error", async () => {
    expect(() => createProductionTradingHandlers({})).toThrow(/PUBLIC_ORIGIN/);
    expect(() => createProductionTradingHandlers({
      PUBLIC_ORIGIN: "https://labs.example",
      SUPABASE_DATABASE_URL: "",
      DATABASE_URL: "",
    })).toThrow(/D1|DATABASE_URL/);
    const response = productionTradingFailure(new Error("DB password secret"));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("secret");
  });

  it("atomically saves and exactly reuses an owned immutable visual strategy without network access", async () => {
    const database = new Database();
    let id = 0;
    const fetchImpl = vi.fn(async () => { throw new Error("network must not be used by strategy save"); });
    const handlers = createProductionTradingHandlers({ DB: database, PUBLIC_ORIGIN: "https://labs.example" }, {
      fetchImpl: fetchImpl as typeof fetch, now: () => 1_000, newId: (prefix) => `${prefix}_${++id}`,
      identityProvider: { getIdentity: async () => ({ email: "a@example.com", displayName: "A" }) },
      deriveUserId: async () => "usr_a",
    });
    const makeRequest = (body: unknown, key = "save-1") => new Request("https://labs.example/api/strategies", {
      method: "POST", headers: { host: "labs.example", origin: "https://labs.example",
        "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body),
    });
    const first = await handlers.strategy(makeRequest({ config: config() }));
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { strategyVersion: { id: string; strategyId: string; configHash: string }; idempotent: boolean };
    expect(firstBody).toMatchObject({ idempotent: false,
      strategyVersion: { id: "version_2", strategyId: "strategy_1", configHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    const reordered = config();
    reordered.blocks.reverse();
    reordered.blocks.forEach((block) => block.parameters.reverse());
    const replay = await handlers.strategy(makeRequest({ config: reordered }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ...firstBody, idempotent: true });
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM strategies").get()).toEqual({ count: 1 });
    expect(database.raw.prepare("SELECT source_hash AS sourceHash,source_code AS sourceCode FROM strategy_versions").get())
      .toEqual({ sourceHash: null, sourceCode: null });
    expect(fetchImpl).not.toHaveBeenCalled();

    const conflict = await handlers.strategy(makeRequest({ config: config({ name: "Different" }) }));
    expect(conflict.status).toBe(409);
    const blockedName = await handlers.strategy(makeRequest({
      config: config({ name: "f.u.c.k guaranteed profit" }),
    }, "save-blocked-name"));
    expect(blockedName.status).toBe(422);
    expect(await blockedName.json()).toMatchObject({ error: { code: "invalid_strategy_name" } });
    for (const [index, name] of ["SAFE\u202Egpj.exe", "CryptoBot\u200BLabs 官方", "Ａtlas Trend"].entries()) {
      const blockedUnicode = await handlers.strategy(makeRequest({ config: config({ name }) }, `save-blocked-unicode-${index}`));
      expect(blockedUnicode.status).toBe(422);
      expect(await blockedUnicode.json()).toMatchObject({ error: { code: "invalid_strategy_name" } });
    }
    const custom = await handlers.strategy(makeRequest({ config: config({ source: "return {action:'buy'}" }) }, "save-custom"));
    expect(custom.status).toBe(422);
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM strategy_versions").get()).toEqual({ count: 1 });

    const source=`export const strategy={exchange:"WEEX",market:"futures",symbol:"BTCUSDT",timeframe:"1h"};\nexport default () => ({action:"hold",reason:"test"});`;
    const savedCustom=await handlers.strategy(makeRequest({config:config({source})},"save-custom-valid"));
    expect(savedCustom.status).toBe(201);
    const row=database.raw.prepare("SELECT source_hash AS sourceHash,source_code AS sourceCode FROM strategy_versions WHERE source_code IS NOT NULL").get() as {sourceHash:string;sourceCode:string};
    expect(row).toEqual({sourceHash:expect.stringMatching(/^[a-f0-9]{64}$/),sourceCode:source});
  });
});
