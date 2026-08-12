// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  ControlPlaneDatabase,
  ControlPlaneRunResult,
  ControlPlaneStatement,
} from "../db";
import { createStrategyPublicationRepository } from "../db/repositories";
import { STRATEGY_PRESETS } from "../data/strategies";
import {
  decodePublicationCursor,
  encodePublicationCursor,
  parsePublicationListRequest,
  parsePublicationInput,
  parseWeexReferralUrl,
  parseWeexReferralUpdateInput,
  publicationSlug,
  publicStrategyPublicationCacheTag,
  publicStrategyFreshnessHeaders,
  servePublicStrategyPublicationList,
  toPublicStrategyPublication,
} from "../lib/server/strategy-publications";

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
    for (const file of readdirSync(resolve("drizzle")).filter((name) => name.endsWith(".sql")).sort()) {
      const migration = readFileSync(resolve("drizzle", file), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) this.raw.exec(statement);
      }
    }
  }
  prepare(sql: string): ControlPlaneStatement { return new SqliteStatement(this.raw.prepare(sql)); }
  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> {
    const results: ControlPlaneRunResult[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

const config = {
  ...STRATEGY_PRESETS[0],
  id: "test-strategy",
  name: "測試公開策略",
};

const metrics = {
  totalReturn: "0.12",
  annualizedReturn: "0.32",
  maxDrawdown: "0.08",
  winRate: "0.55",
  profitFactor: "1.4",
  sharpe: "1.1",
  trades: 12,
};

const seedVerifiedBacktest = (database: SqliteDatabase) => {
  database.raw.exec(`
    INSERT INTO users (id,normalized_email,display_name,created_at,updated_at)
      VALUES ('usr_a','a@example.test','發布者 A',1,1),('usr_b','b@example.test','發布者 B',1,1);
    INSERT INTO strategies (id,user_id,name,market,symbol,created_at,updated_at)
      VALUES ('strategy_a','usr_a','測試公開策略','spot','BTCUSDT',1,1);
    INSERT INTO strategy_versions (id,user_id,strategy_id,version,config_hash,source_hash,config_json,source_code,created_at)
      VALUES ('version_a','usr_a','strategy_a',1,'${"a".repeat(64)}',NULL,'${JSON.stringify(config).replaceAll("'", "''")}',NULL,2);
    INSERT INTO backtest_jobs (id,user_id,strategy_version_id,status,evidence_level,request_json,created_at,started_at,completed_at)
      VALUES ('job_a','usr_a','version_a','succeeded','historical','{}',3,3,4);
    INSERT INTO backtest_datasets
      (id,user_id,backtest_job_id,market,symbol,interval,source,requested_start_at,requested_end_at,
        actual_start_at,actual_end_at,complete,gaps_json,checksum,created_at)
      VALUES ('dataset_a','usr_a','job_a','spot','BTCUSDT','1h','WEEX public market data',1000,3000,
        1000,3000,1,'[]','${"b".repeat(64)}',4);
    INSERT INTO backtest_results
      (id,user_id,backtest_job_id,dataset_id,evidence_level,initial_capital,fee_rate,slippage_rate,
        leverage,funding_json,metrics_json,provenance_json,equity_curve_json,engine_version,
        configuration_hash,strategy_hash,script_hash,created_at)
      VALUES ('result_a','usr_a','job_a','dataset_a','historical','10000','0.001','0.0005','1',
        '[]','${JSON.stringify(metrics).replaceAll("'", "''")}','{}',
        '[{"timestamp":1000,"equity":"10000"},{"timestamp":2000,"equity":"11200"}]',
        'test','${"a".repeat(64)}','${"a".repeat(64)}',NULL,4);
  `);
};

const seedVerifiedBacktestVersion = (database: SqliteDatabase, suffix: string, version: number) => {
  const configurationHash = suffix.repeat(64);
  database.raw.prepare(`INSERT INTO strategy_versions
    (id,user_id,strategy_id,version,config_hash,source_hash,config_json,source_code,created_at)
    VALUES (?, 'usr_a', 'strategy_a', ?, ?, NULL, ?, NULL, ?)`)
    .run(`version_${suffix}`, version, configurationHash, JSON.stringify(config), version + 2);
  database.raw.prepare(`INSERT INTO backtest_jobs
    (id,user_id,strategy_version_id,status,evidence_level,request_json,created_at,started_at,completed_at)
    VALUES (?, 'usr_a', ?, 'succeeded', 'historical', '{}', ?, ?, ?)`)
    .run(`job_${suffix}`, `version_${suffix}`, version + 3, version + 3, version + 4);
  database.raw.prepare(`INSERT INTO backtest_datasets
    (id,user_id,backtest_job_id,market,symbol,interval,source,requested_start_at,requested_end_at,
      actual_start_at,actual_end_at,complete,gaps_json,checksum,created_at)
    VALUES (?, 'usr_a', ?, 'spot', 'BTCUSDT', '1h', 'WEEX public market data', 1000, 3000,
      1000, 3000, 1, '[]', ?, ?)`)
    .run(`dataset_${suffix}`, `job_${suffix}`, suffix.toUpperCase().repeat(64), version + 4);
  database.raw.prepare(`INSERT INTO backtest_results
    (id,user_id,backtest_job_id,dataset_id,evidence_level,initial_capital,fee_rate,slippage_rate,
      leverage,funding_json,metrics_json,provenance_json,equity_curve_json,engine_version,
      configuration_hash,strategy_hash,script_hash,created_at)
    VALUES (?, 'usr_a', ?, ?, 'historical', '10000', '0.001', '0.0005', '1', '[]', ?, '{}',
      '[{"timestamp":1000,"equity":"10000"},{"timestamp":2000,"equity":"11200"}]',
      'test', ?, ?, NULL, ?)`)
    .run(`result_${suffix}`, `job_${suffix}`, `dataset_${suffix}`, JSON.stringify(metrics), configurationHash,
      configurationHash, version + 4);
};

describe("strategy publications", () => {
  it("keeps public publication reads out of browser and Netlify durable caches", () => {
    expect(publicStrategyFreshnessHeaders).toEqual({
      "cache-control": "no-store, max-age=0",
      "netlify-cdn-cache-control": "no-store",
    });
    expect(publicStrategyPublicationCacheTag("strategy-publicationa"))
      .toBe("public-strategy-publication:v3:strategy-publicationa");
    expect(() => publicStrategyPublicationCacheTag("unsafe/slug")).toThrow(/slug/);
  });

  it("publishes only an owned immutable version with complete historical evidence", async () => {
    const database = new SqliteDatabase();
    seedVerifiedBacktest(database);
    const repository = createStrategyPublicationRepository(database);
    const saved = await repository.publish({
      id: "publication_a",
      userId: "usr_a",
      strategyVersionId: "version_a",
      backtestJobId: "job_a",
      slug: "strategy-publicationa",
      description: "這是經完整公開歷史行情驗證的測試策略，適合檢查發布流程。",
      publisherName: "發布者 A",
      now: 5,
    });
    expect(saved).not.toBeNull();
    const record = await repository.getBySlug("strategy-publicationa");
    expect(record).toMatchObject({ name: "測試公開策略", publisherName: "發布者 A", actualStartAt: 1000 });
    expect(toPublicStrategyPublication(record!)).toMatchObject({
      name: "測試公開策略",
      symbol: "BTCUSDT",
      tradeDirection: "long",
      hasPrivateSource: false,
      weexReferralUrl: null,
      metrics: { totalReturn: "0.12", trades: 12 },
    });
    await expect(repository.updateReferralUrl({
      userId: "usr_b",
      slug: "strategy-publicationa",
      weexReferralUrl: "https://www.weex.com/register?inviteCode=OTHER",
      now: 6,
    })).resolves.toBe(false);
    await expect(repository.updateReferralUrl({
      userId: "usr_a",
      slug: "strategy-publicationa",
      weexReferralUrl: "https://www.weex.com/register?inviteCode=SAFE",
      now: 7,
    })).resolves.toBe(true);
    expect((await repository.getBySlug("strategy-publicationa"))?.weexReferralUrl)
      .toBe("https://www.weex.com/register?inviteCode=SAFE");
    await expect(repository.listByUser("usr_a")).resolves.toHaveLength(1);
    await expect(repository.listByUser("usr_b")).resolves.toHaveLength(0);

    await expect(repository.publish({
      id: "publication_b",
      userId: "usr_b",
      strategyVersionId: "version_a",
      backtestJobId: "job_a",
      slug: "strategy-publicationb",
      description: "另一位會員不能發布不屬於自己的固定策略版本與歷史證據。",
      publisherName: "發布者 B",
      now: 8,
    })).resolves.toBeNull();
  });

  it("keeps publication input separate from the optional HTTPS WEEX sharing metadata", () => {
    expect(parseWeexReferralUrl("https://www.weex.com/register?inviteCode=SAFE"))
      .toBe("https://www.weex.com/register?inviteCode=SAFE");
    expect(() => parseWeexReferralUrl("https://weex.com.evil.example/register")).toThrow();
    expect(() => parseWeexReferralUrl("http://www.weex.com/register")).toThrow();
    expect(parseWeexReferralUpdateInput({
      weexReferralUrl: "https://www.weex.com/register?inviteCode=SAFE",
    })).toEqual({ weexReferralUrl: "https://www.weex.com/register?inviteCode=SAFE" });
    expect(parsePublicationInput({
      strategyVersionId: "version_a",
      backtestJobId: "job_a",
      description: "這是一段足夠完整、可供公開策略頁顯示的策略介紹文字。",
    })).toMatchObject({ strategyVersionId: "version_a", backtestJobId: "job_a" });
    expect(() => parsePublicationInput({
      strategyVersionId: "version_a",
      backtestJobId: "job_a",
      description: "太短",
    })).toThrow();
    expect(() => parsePublicationInput({
      strategyVersionId: "version_a",
      backtestJobId: "job_a",
      description: "這是一段足夠完整、可供公開策略頁顯示的策略介紹文字。",
      weexReferralUrl: "https://www.weex.com/register?inviteCode=SAFE",
    })).toThrow();
    expect(publicationSlug("publication_12345678-1234-1234-1234-123456789abc"))
      .toMatch(/^strategy-[a-z0-9]{20}$/);
  });

  it("paginates publications by the stable published-at and id tuple without overlap", async () => {
    const database = new SqliteDatabase();
    seedVerifiedBacktest(database);
    seedVerifiedBacktestVersion(database, "b", 2);
    seedVerifiedBacktestVersion(database, "c", 3);
    seedVerifiedBacktestVersion(database, "d", 4);
    const repository = createStrategyPublicationRepository(database);
    for (const publication of [
      { id: "publication_a", version: "version_a", job: "job_a", slug: "strategy-publicationa", now: 20 },
      { id: "publication_z", version: "version_b", job: "job_b", slug: "strategy-publicationz", now: 20 },
      { id: "publication_c", version: "version_c", job: "job_c", slug: "strategy-publicationc", now: 10 },
      { id: "publication_d", version: "version_d", job: "job_d", slug: "strategy-publicationd", now: 5 },
    ]) {
      await repository.publish({
        id: publication.id,
        userId: "usr_a",
        strategyVersionId: publication.version,
        backtestJobId: publication.job,
        slug: publication.slug,
        description: "這是用來驗證大量會員策略穩定游標分頁、不重複也不遺漏的公開策略。",
        publisherName: "發布者 A",
        now: publication.now,
      });
    }

    const first = await repository.listPage({ limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(["publication_z", "publication_a"]);
    expect(first.nextCursor).toEqual({ publishedAt: 20, id: "publication_a" });
    const second = await repository.listPage({ limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.id)).toEqual(["publication_c", "publication_d"]);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(4);
    await expect(repository.listPage({ limit: 101 })).rejects.toThrow(/limit/);
    await expect(repository.listPage({ limit: 2, cursor: { publishedAt: -1, id: "publication_a" } }))
      .rejects.toThrow(/cursor/);
  });

  it("strictly parses opaque public-list cursors and bounds every requested page", () => {
    const cursor = encodePublicationCursor({ publishedAt: 1_700_000_000_000, id: "publication_a" });
    expect(decodePublicationCursor(cursor)).toEqual({ publishedAt: 1_700_000_000_000, id: "publication_a" });
    expect(parsePublicationListRequest(new Request(`https://labs.example/api/strategy-publications?limit=12&cursor=${cursor}`)))
      .toEqual({ limit: 12, cursor: { publishedAt: 1_700_000_000_000, id: "publication_a" } });
    expect(parsePublicationListRequest(new Request("https://labs.example/api/strategy-publications")))
      .toEqual({ limit: 12 });
    for (const query of [
      "limit=25",
      "limit=01",
      "limit=12&limit=12",
      "offset=12",
      "cursor=not-valid-cursor",
    ]) {
      expect(() => parsePublicationListRequest(new Request(`https://labs.example/api/strategy-publications?${query}`)))
        .toThrow();
    }
  });

  it("returns cursor API pages with a bounded chart payload while detail evidence remains complete", async () => {
    const database = new SqliteDatabase();
    seedVerifiedBacktest(database);
    const repository = createStrategyPublicationRepository(database);
    await repository.publish({
      id: "publication_a",
      userId: "usr_a",
      strategyVersionId: "version_a",
      backtestJobId: "job_a",
      slug: "strategy-publicationa",
      description: "這是用來驗證探索清單傳輸量與完整策略詳情證據彼此分離的公開策略。",
      publisherName: "發布者 A",
      now: 5,
    });
    const saved = await repository.getBySlug("strategy-publicationa");
    const completeCurve = Array.from({ length: 2_000 }, (_, index) => ({
      timestamp: 1_700_000_000_000 + index * 60_000,
      equity: String(10_000 + index),
    }));
    const record = { ...saved!, equityCurveJson: JSON.stringify(completeCurve) };
    let observedOptions: unknown;
    const result = await servePublicStrategyPublicationList(
      new Request("https://labs.example/api/strategy-publications?limit=1"),
      {
        async listPage(options) {
          observedOptions = options;
          return { items: [record], nextCursor: { publishedAt: record.publishedAt, id: record.id } };
        },
      },
    );
    expect(result.status).toBe(200);
    expect(observedOptions).toEqual({ limit: 1 });
    const body = await result.json() as {
      publications: Array<{ equityCurve: Array<{ timestamp: number; equity: string }> }>;
      nextCursor: string;
    };
    expect(body.publications[0]?.equityCurve).toHaveLength(120);
    expect(body.publications[0]?.equityCurve[0]).toEqual(completeCurve[0]);
    expect(body.publications[0]?.equityCurve.at(-1)).toEqual(completeCurve.at(-1));
    expect(decodePublicationCursor(body.nextCursor)).toEqual({ publishedAt: record.publishedAt, id: record.id });
    expect(toPublicStrategyPublication(record).equityCurve).toHaveLength(2_000);

    let called = false;
    const invalid = await servePublicStrategyPublicationList(
      new Request("https://labs.example/api/strategy-publications?limit=999"),
      { async listPage() { called = true; return { items: [], nextCursor: null }; } },
    );
    expect(invalid.status).toBe(400);
    expect(called).toBe(false);
  });

  it("scans past an invalid raw page so the next valid publication remains discoverable", async () => {
    const database = new SqliteDatabase();
    seedVerifiedBacktest(database);
    const repository = createStrategyPublicationRepository(database);
    await repository.publish({
      id: "publication_a",
      userId: "usr_a",
      strategyVersionId: "version_a",
      backtestJobId: "job_a",
      slug: "strategy-publicationa",
      description: "這是用來驗證損壞公開資料不會阻斷後續有效會員策略的公開策略。",
      publisherName: "發布者 A",
      now: 5,
    });
    const saved = await repository.getBySlug("strategy-publicationa");
    const invalid = {
      ...saved!,
      id: "publication_z",
      slug: "strategy-invalidrow",
      name: "與固定設定不一致的名稱",
      publishedAt: 5,
    };
    const valid = {
      ...saved!,
      id: "publication_y",
      slug: "strategy-validrow",
      publishedAt: 4,
    };
    const calls: unknown[] = [];
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await servePublicStrategyPublicationList(
        new Request("https://labs.example/api/strategy-publications?limit=1"),
        {
          async listPage(options) {
            calls.push(options);
            return calls.length === 1
              ? { items: [invalid], nextCursor: { publishedAt: invalid.publishedAt, id: invalid.id } }
              : { items: [valid], nextCursor: null };
          },
        },
      );
      expect(result.status).toBe(200);
      expect(calls).toEqual([
        { limit: 1 },
        { limit: 1, cursor: { publishedAt: 5, id: "publication_z" } },
      ]);
      const body = await result.json() as { publications: Array<{ slug: string }>; nextCursor: string | null };
      expect(body.publications.map((publication) => publication.slug)).toEqual(["strategy-validrow"]);
      expect(body.nextCursor).toBeNull();
    } finally {
      log.mockRestore();
    }
  });

  it("bounds invalid-row scanning and returns a strictly advanced continuation cursor", async () => {
    const database = new SqliteDatabase();
    seedVerifiedBacktest(database);
    const repository = createStrategyPublicationRepository(database);
    await repository.publish({
      id: "publication_a",
      userId: "usr_a",
      strategyVersionId: "version_a",
      backtestJobId: "job_a",
      slug: "strategy-publicationa",
      description: "這是用來驗證大量損壞公開資料仍有掃描上限與安全續頁游標的公開策略。",
      publisherName: "發布者 A",
      now: 10,
    });
    const saved = await repository.getBySlug("strategy-publicationa");
    let calls = 0;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await servePublicStrategyPublicationList(
        new Request("https://labs.example/api/strategy-publications?limit=1"),
        {
          async listPage(options) {
            calls += 1;
            const publishedAt = 11 - calls;
            const record = {
              ...saved!,
              id: `publication_${publishedAt}`,
              slug: `strategy-invalid${publishedAt}`,
              name: "與固定設定不一致的名稱",
              publishedAt,
            };
            expect(options).toEqual({
              limit: 1,
              ...(calls === 1 ? {} : {
                cursor: { publishedAt: publishedAt + 1, id: `publication_${publishedAt + 1}` },
              }),
            });
            return { items: [record], nextCursor: { publishedAt, id: record.id } };
          },
        },
      );
      expect(calls).toBe(5);
      const body = await result.json() as { publications: unknown[]; nextCursor: string };
      expect(body.publications).toEqual([]);
      expect(decodePublicationCursor(body.nextCursor)).toEqual({ publishedAt: 6, id: "publication_6" });
    } finally {
      log.mockRestore();
    }
  });

  it("fails closed when a repository repeats a raw page cursor", async () => {
    const database = new SqliteDatabase();
    seedVerifiedBacktest(database);
    const repository = createStrategyPublicationRepository(database);
    await repository.publish({
      id: "publication_a",
      userId: "usr_a",
      strategyVersionId: "version_a",
      backtestJobId: "job_a",
      slug: "strategy-publicationa",
      description: "這是用來驗證資料層若重複同一游標時，公開 API 會安全停止而非無限掃描。",
      publisherName: "發布者 A",
      now: 5,
    });
    const saved = await repository.getBySlug("strategy-publicationa");
    const invalid = {
      ...saved!,
      id: "publication_z",
      slug: "strategy-invalidrow",
      name: "與固定設定不一致的名稱",
      publishedAt: 5,
    };
    let calls = 0;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await servePublicStrategyPublicationList(
        new Request("https://labs.example/api/strategy-publications?limit=1"),
        {
          async listPage() {
            calls += 1;
            return { items: [invalid], nextCursor: { publishedAt: invalid.publishedAt, id: invalid.id } };
          },
        },
      );
      expect(result.status).toBe(503);
      expect(calls).toBe(2);
    } finally {
      log.mockRestore();
    }
  });

  it("refuses to expose a legacy saved version whose name now fails moderation", async () => {
    const database = new SqliteDatabase();
    seedVerifiedBacktest(database);
    const record = await createStrategyPublicationRepository(database).getBySlug("strategy-publicationa");
    expect(record).toBeNull();
    const repository = createStrategyPublicationRepository(database);
    await repository.publish({
      id: "publication_a",
      userId: "usr_a",
      strategyVersionId: "version_a",
      backtestJobId: "job_a",
      slug: "strategy-publicationa",
      description: "這是經完整公開歷史行情驗證的測試策略，適合檢查名稱審核。",
      publisherName: "發布者 A",
      now: 5,
    });
    const published = await repository.getBySlug("strategy-publicationa");
    const config = JSON.parse(published!.configJson) as Record<string, unknown>;
    expect(() => toPublicStrategyPublication({
      ...published!,
      name: "WEEX 官方策略",
      configJson: JSON.stringify({ ...config, name: "WEEX 官方策略" }),
    })).toThrow(/configuration is invalid/i);
  });
});
