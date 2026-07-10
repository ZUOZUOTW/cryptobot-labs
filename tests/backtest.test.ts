import { describe, expect, it } from "vitest";
import { STRATEGY_PRESETS } from "../data/strategies";
import { runBacktest } from "../lib/backtest";

const validConfig = STRATEGY_PRESETS.find((preset) => preset.name === "突破追蹤")!;

describe("runBacktest", () => {
  it("returns identical curves and metrics for identical configs", () => {
    expect(runBacktest(validConfig)).toEqual(runBacktest(validConfig));
  });

  it("is independent of object key insertion order", () => {
    const reordered = {
      blocks: validConfig.blocks,
      leverage: validConfig.leverage,
      logicMode: validConfig.logicMode,
      timeframe: validConfig.timeframe,
      symbol: validConfig.symbol,
      market: validConfig.market,
      exchange: validConfig.exchange,
      name: validConfig.name,
      id: validConfig.id,
    };

    expect(runBacktest(reordered)).toEqual(runBacktest(validConfig));
  });

  it("changes the result when leverage changes", () => {
    expect(runBacktest(validConfig).metrics.totalReturn)
      .not.toBe(runBacktest({ ...validConfig, leverage: 5 }).metrics.totalReturn);
  });

  it("always returns 36 points and bounded metrics", () => {
    const report = runBacktest(validConfig);

    expect(report.equityCurve).toHaveLength(36);
    expect(report.metrics.maxDrawdown).toBeLessThanOrEqual(0);
    expect(report.metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(report.metrics.winRate).toBeLessThanOrEqual(100);
    expect(report.metrics.stability).toBeGreaterThanOrEqual(0);
    expect(report.metrics.stability).toBeLessThanOrEqual(100);
    expect(report.metrics.profitFactor).toBeGreaterThanOrEqual(0);
    expect(report.metrics.trades).toBeGreaterThan(0);
    expect(report.metrics.runningDays).toBe(1095);
    expect(report.disclaimer).toBe("模擬回測資料，不代表未來績效");
  });

  it("derives a fixed timestamp and seed from the config", () => {
    const report = runBacktest(validConfig);

    expect(report.seed).toMatch(/^[0-9a-f]{8}$/);
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
    expect(report.generatedAt).toBe(runBacktest(validConfig).generatedAt);
  });
});
