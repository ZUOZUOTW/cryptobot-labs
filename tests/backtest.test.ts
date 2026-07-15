import { describe, expect, it } from "vitest";
import { STRATEGY_PRESETS, cloneStrategyBlock } from "../data/strategies";
import { runBacktest } from "../lib/backtest";

const validConfig = STRATEGY_PRESETS.find((preset) => preset.name === "突破追蹤")!;

describe("runBacktest", () => {
  it("rejects a runtime non-WEEX exchange at the public boundary", () => {
    expect(() => runBacktest({ ...validConfig, exchange: "BINANCE" as "WEEX" }))
      .toThrowError("策略設定無效：目前可用的實盤連線為 WEEX API");
  });

  it("rejects forbidden JavaScript source at the public boundary", () => {
    expect(() => runBacktest({ ...validConfig, source: "fetch('https://api.bybit.com')" }))
      .toThrowError("策略設定無效：偵測到非 WEEX 網域：api.bybit.com");
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
      totalReturn: 8.34,
      annualizedReturn: 2.71,
      maxDrawdown: -9.2,
      winRate: 58.33,
      profitFactor: 1.4,
      sharpe: 0.46,
      trades: 237,
      runningDays: 1095,
      stability: 20.42,
    });
  });

  it("can produce losses for an aggressive leveraged configuration", () => {
    const fixedPosition = cloneStrategyBlock("fixed-position");
    fixedPosition.parameters[0]!.value = 100;
    const stopLoss = cloneStrategyBlock("stop-loss");
    stopLoss.parameters[0]!.value = 20;
    const takeProfit = cloneStrategyBlock("take-profit");
    takeProfit.parameters[0]!.value = 0.5;
    const aggressive = {
      ...validConfig,
      id: "aggressive-loss-fixture",
      leverage: 80,
      blocks: [
        ...validConfig.blocks.filter((block) => block.id !== "atr-sizing"),
        fixedPosition,
        stopLoss,
        takeProfit,
      ],
    };

    const report = runBacktest(aggressive);
    expect(report.metrics.totalReturn).toBeLessThan(0);
    expect(report.metrics.maxDrawdown).toBeLessThan(-20);
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

    expect(report.equityCurve[0].value).toBeLessThan(100);
    expect(report.metrics.maxDrawdown).toBeLessThan(0);
  });

  it("derives a fixed timestamp and seed from the config", () => {
    const report = runBacktest(validConfig);

    expect(report.seed).toMatch(/^[0-9a-f]{8}$/);
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
    expect(report.generatedAt).toBe(runBacktest(validConfig).generatedAt);
  });
});
