import { describe, expect, it } from "vitest";
import { STRATEGY_PRESETS } from "../data/strategies";
import { runBacktest } from "../lib/backtest";

const validConfig = STRATEGY_PRESETS.find((preset) => preset.name === "突破追蹤")!;

describe("runBacktest", () => {
  it("rejects a runtime non-WEEX exchange at the public boundary", () => {
    expect(() => runBacktest({ ...validConfig, exchange: "BINANCE" as "WEEX" }))
      .toThrowError("策略設定無效：只支援 WEEX 交易所");
  });

  it("rejects forbidden JavaScript source at the public boundary", () => {
    expect(() => runBacktest({ ...validConfig, source: "fetch('https://api.bybit.com')" }))
      .toThrowError("策略設定無效：偵測到非 WEEX 交易所識別字：bybit");
  });

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

  it("returns the exact metrics derived from the deterministic fixture", () => {
    expect(runBacktest(validConfig).metrics).toEqual({
      totalReturn: 42.15,
      annualizedReturn: 12.44,
      maxDrawdown: -1.92,
      winRate: 77.78,
      profitFactor: 9.13,
      sharpe: 2.78,
      trades: 224,
      runningDays: 1095,
      stability: 27.22,
    });
  });

  it("counts a first-period loss from the initial equity of 100", () => {
    const steadyPreset = STRATEGY_PRESETS.find((preset) => preset.name === "穩健趨勢")!;
    const firstPeriodLossConfig = {
      ...steadyPreset,
      id: "steady-trend-1",
      market: "futures" as const,
      leverage: 1,
    };
    const report = runBacktest(firstPeriodLossConfig);

    expect(report.equityCurve[0].value).toBe(99.17);
    expect(report.metrics.maxDrawdown).toBe(-3.08);
  });

  it("derives a fixed timestamp and seed from the config", () => {
    const report = runBacktest(validConfig);

    expect(report.seed).toMatch(/^[0-9a-f]{8}$/);
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
    expect(report.generatedAt).toBe(runBacktest(validConfig).generatedAt);
  });
});
