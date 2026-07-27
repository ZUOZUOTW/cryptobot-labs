// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ControlPlaneDatabase,
  ControlPlaneRunResult,
  ControlPlaneStatement,
} from "../db";
import { createStrategyPublicationRepository } from "../db/repositories";
import { STRATEGY_PRESETS } from "../data/strategies";
import {
  parsePublicationInput,
  parseWeexReferralUrl,
  parseWeexReferralUpdateInput,
  publicationSlug,
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

describe("strategy publications", () => {
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
