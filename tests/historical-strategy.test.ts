import { describe, expect, it } from "vitest";

import { cloneStrategyBlock } from "../data/strategies";
import { createVisualHistoricalEvaluator } from "../lib/historical-strategy";
import type { BotConfig } from "../lib/types";
import type { Candle, HistoricalDataset, StrategyInput } from "../packages/trading-core/src";
import { runHistoricalBacktest } from "../packages/trading-core/src";

const config = (): BotConfig => ({
  id: "visual-test",
  name: "Visual Test",
  exchange: "WEEX",
  market: "spot",
  symbol: "BTCUSDT",
  timeframe: "1h",
  logicMode: "all",
  leverage: 1,
  blocks: [cloneStrategyBlock("rsi"), cloneStrategyBlock("stop-loss")],
});

const withBlocks = (ids: string[], market: BotConfig["market"] = "spot"): BotConfig => ({
  ...config(),
  market,
  leverage: market === "spot" ? 1 : 2,
  blocks: [...ids, ...(ids.includes("stop-loss") ? [] : ["stop-loss"])].map(cloneStrategyBlock),
});

const setParameter = (value: BotConfig, blockId: string, key: string, parameterValue: number): BotConfig => ({
  ...value,
  blocks: value.blocks.map((block) => block.id !== blockId ? block : {
    ...block,
    parameters: block.parameters.map((item) => item.key === key ? { ...item, value: parameterValue } : item),
  }),
});

const candles = (values: number[], volumes: number[] = values.map(() => 100), start = 0): Candle[] => values.map((close, index) => ({
  openTime: start + index * 3_600_000,
  closeTime: start + (index + 1) * 3_600_000 - 1,
  open: String(close),
  high: String(close + 1),
  low: String(Math.max(0.01, close - 1)),
  close: String(close),
  volume: String(volumes[index] ?? 100),
  complete: true,
}));

const input = (items: Candle[], market: "spot" | "futures" = "spot", portfolio?: StrategyInput["portfolio"]): StrategyInput => ({
  candles: items,
  market,
  symbol: "BTCUSDT",
  timeframe: "1h",
  leverage: market === "spot" ? "1" : "2",
  now: items.at(-1)!.closeTime,
  ...(portfolio ? { portfolio } : {}),
});

describe("visual historical strategy evaluator", () => {
  it("builds from a canonical visual BotConfig without executing source code", () => {
    expect(createVisualHistoricalEvaluator(config())).toBeDefined();
  });

  it("rejects custom JavaScript until the QuickJS sandbox is available", () => {
    expect(() => createVisualHistoricalEvaluator({ ...config(), source: "globalThis.pwned = true" }))
      .toThrow(/QuickJS|custom JavaScript/i);
  });

  it("strictly rejects extra fields and owns a deeply frozen canonical clone", () => {
    const candidate = config();
    const evaluator = createVisualHistoricalEvaluator(candidate);
    candidate.blocks[0]!.parameters[0]!.value = 99;
    expect(evaluator.config.blocks[0]!.parameters[0]!.value).toBe(14);
    expect(Object.isFrozen(evaluator.config.blocks[0]!.parameters)).toBe(true);
    expect(() => createVisualHistoricalEvaluator({ ...config(), unexpected: true } as BotConfig)).toThrow(/strict canonical/i);
  });

  it("requires dataset market, symbol, and timeframe to match the config", async () => {
    const evaluator = createVisualHistoricalEvaluator(config());
    await expect(evaluator.evaluate({ ...input(candles([100, 90, 80, 85])), timeframe: "4h" })).rejects.toThrow(/match/i);
    await expect(evaluator.evaluate({ ...input(candles([100, 90, 80, 85])), leverage: "2" })).rejects.toThrow(/match/i);
  });

  it("rejects off-step, fractional period, and non-finite parameters", () => {
    expect(() => createVisualHistoricalEvaluator(setParameter(withBlocks(["grid", "fixed-position"]), "fixed-position", "positionSize", 10.5))).toThrow(/步進/);
    expect(() => createVisualHistoricalEvaluator(setParameter(withBlocks(["rsi"]), "rsi", "period", 2.5))).toThrow(/步進|整數/);
    expect(() => createVisualHistoricalEvaluator(setParameter(withBlocks(["rsi"]), "rsi", "oversold", Number.NaN))).toThrow(/invalid|格式/i);
  });

  it.each([
    ["rsi", [100, 90, 80, 85]],
    ["sma-cross", [10, 10, 10, 10, 10, 10, 10, 10, 10, 1, 20]],
    ["macd", [10, 9, 8, 7, 6, 5, 20]],
    ["bollinger-breakout", [10, 10, 10, 10, 10, 12]],
    ["grid", [100, 98]],
  ])("turns the %s visual entry block into a deterministic buy signal", async (id, values) => {
    let candidate = withBlocks([id]);
    if (id === "rsi") candidate = setParameter(setParameter(candidate, id, "period", 2), id, "oversold", 30);
    if (id === "sma-cross") candidate = setParameter(setParameter(candidate, id, "shortPeriod", 2), id, "longPeriod", 10);
    if (id === "macd") candidate = setParameter(setParameter(setParameter(candidate, id, "fastPeriod", 2), id, "slowPeriod", 5), id, "signalPeriod", 2);
    if (id === "bollinger-breakout") candidate = setParameter(setParameter(candidate, id, "period", 5), id, "deviation", 1);
    if (id === "grid") candidate = setParameter(setParameter(candidate, id, "gridCount", 2), id, "range", 2);
    const evaluator = createVisualHistoricalEvaluator(candidate);
    const first = await evaluator.evaluate(input(candles(values)));
    const second = await evaluator.evaluate(input(candles(values)));
    expect(first).toEqual(second);
    expect(first.action).toBe("buy");
  });

  it("uses intervalDays for DCA cadence and drawdownBoost for its allocation", async () => {
    const items = candles([100, 90, 80], undefined, 0).map((candle, index) => ({
      ...candle,
      openTime: index * 86_400_000,
      closeTime: (index + 1) * 86_400_000 - 1,
    }));
    const daily = setParameter(withBlocks(["dca", "fixed-position"]), "dca", "intervalDays", 1);
    const monthly = setParameter(withBlocks(["dca", "fixed-position"]), "dca", "intervalDays", 30);
    const boosted = setParameter(daily, "dca", "drawdownBoost", 200);
    const dailySignal = await createVisualHistoricalEvaluator(daily).evaluate(input(items));
    const monthlySignal = await createVisualHistoricalEvaluator(monthly).evaluate(input(items));
    const boostedSignal = await createVisualHistoricalEvaluator(boosted).evaluate(input(items));
    expect(dailySignal.action).toBe("buy");
    expect(monthlySignal.action).toBe("hold");
    expect(boostedSignal.allocationRate).toBeGreaterThan(dailySignal.allocationRate!);
  });

  it("applies volume confirmation and distinct all/any entry composition", async () => {
    const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 1, 20];
    const lowVolume = candles(values, values.map(() => 100));
    const highVolume = candles(values, values.map((_, index) => index === values.length - 1 ? 1000 : 100));
    let all = withBlocks(["sma-cross", "rsi", "volume-confirmation"]);
    all = setParameter(setParameter(all, "sma-cross", "shortPeriod", 2), "sma-cross", "longPeriod", 10);
    all = setParameter(all, "volume-confirmation", "period", 2);
    const any = { ...all, logicMode: "any" as const };
    expect((await createVisualHistoricalEvaluator(all).evaluate(input(highVolume))).action).toBe("hold");
    expect((await createVisualHistoricalEvaluator(any).evaluate(input(lowVolume))).action).toBe("hold");
    expect((await createVisualHistoricalEvaluator(any).evaluate(input(highVolume))).action).toBe("buy");
  });

  it("uses fixed and ATR position parameters to calculate bounded allocation", async () => {
    const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 1, 20];
    let fixed = withBlocks(["sma-cross", "fixed-position"]);
    fixed = setParameter(setParameter(setParameter(fixed, "sma-cross", "shortPeriod", 2), "sma-cross", "longPeriod", 10), "fixed-position", "positionSize", 25);
    let atr = withBlocks(["sma-cross", "atr-sizing"]);
    atr = setParameter(setParameter(setParameter(setParameter(atr, "sma-cross", "shortPeriod", 2), "sma-cross", "longPeriod", 10), "atr-sizing", "atrPeriod", 2), "atr-sizing", "riskPerTrade", 1);
    expect((await createVisualHistoricalEvaluator(fixed).evaluate(input(candles(values)))).allocationRate).toBe(0.25);
    const atrRate = (await createVisualHistoricalEvaluator(atr).evaluate(input(candles(values)))).allocationRate!;
    expect(atrRate).toBeGreaterThan(0);
    expect(atrRate).toBeLessThanOrEqual(1);
  });

  it("preserves fixed-position allocation for every canonical percentage", async () => {
    for (let percentage = 1; percentage <= 100; percentage += 1) {
      let candidate = withBlocks(["grid", "fixed-position"]);
      candidate = setParameter(setParameter(setParameter(candidate, "grid", "gridCount", 2), "grid", "range", 2), "fixed-position", "positionSize", percentage);
      const signal = await createVisualHistoricalEvaluator(candidate).evaluate(input(candles([100, 98])));
      expect(signal.allocationRate).toBeCloseTo(Math.min(percentage / 100, 0.5), 12);
    }
  });

  it("makes visual parameters affect the real historical engine result", async () => {
    const items = candles([100, 98, 105]);
    items[2] = { ...items[2]!, open: "100", high: "106", low: "99" };
    const dataset: HistoricalDataset = {
      request: { market: "spot", symbol: "BTCUSDT", interval: "1h" },
      candles: items,
      intervalMs: 3_600_000,
      complete: true,
      validation: { duplicates: [], ordered: true, gaps: [], incompleteCount: 0 },
      provenance: {
        provider: "WEEX",
        sourceKind: "public-api",
        endpoint: "/candles",
        collectedAt: 20_000_000,
        singleResponse: true,
        paginated: false,
        truncated: false,
      },
    };
    const run = async (percentage: number) => {
      let candidate = withBlocks(["grid", "fixed-position"]);
      candidate = setParameter(setParameter(setParameter(candidate, "grid", "gridCount", 2), "grid", "range", 2), "fixed-position", "positionSize", percentage);
      return runHistoricalBacktest({
        dataset,
        evaluator: createVisualHistoricalEvaluator(candidate),
        initialCapital: "1000",
        feeRate: "0",
        slippageRate: "0",
        leverage: "1",
        funding: [],
        gapPolicy: "fail",
        engineVersion: "visual-test",
        configHash: `config-${percentage}`,
        strategyHash: "visual-evaluator-v1",
      });
    };
    const ten = await run(10);
    const fifty = await run(50);
    expect(Number(fifty.trades[0]!.quantity)).toBeCloseTo(Number(ten.trades[0]!.quantity) * 5, 12);
    expect(fifty.metrics.totalReturn).not.toBe(ten.metrics.totalReturn);
  });

  it.each([
    ["take-profit", "takeProfit", 5, "110", "110", "90"],
    ["stop-loss", "stopLoss", 5, "90", "110", "90"],
    ["trailing-stop", "trailingDistance", 5, "104", "110", "90"],
  ])("closes a long position through %s", async (id, key, threshold, close, peak, trough) => {
    let candidate = withBlocks(["dca", id]);
    candidate = setParameter(candidate, id, key, threshold);
    const items = candles([100, Number(close)]);
    const result = await createVisualHistoricalEvaluator(candidate).evaluate(input(items, "spot", {
      equity: "1000",
      dayStartEquity: "1000",
      utcDay: "1970-01-01",
      position: { side: "long", entryPrice: "100", peakPrice: peak, troughPrice: trough, quantity: "1", usedMargin: "100" },
    }));
    expect(result).toMatchObject({ action: "close", reason: id });
  });

  it("closes or suppresses entries after maximum daily loss", async () => {
    let candidate = withBlocks(["dca", "maximum-daily-loss"]);
    candidate = setParameter(candidate, "maximum-daily-loss", "maximumDailyLoss", 5);
    const evaluator = createVisualHistoricalEvaluator(candidate);
    const portfolio = { equity: "940", dayStartEquity: "1000", utcDay: "1970-01-01" } as const;
    expect(await evaluator.evaluate(input(candles([100, 100]), "spot", portfolio))).toMatchObject({ action: "hold", reason: /suppress/ });
    expect(await evaluator.evaluate(input(candles([100, 100]), "spot", {
      ...portfolio,
      position: { side: "long", entryPrice: "100", peakPrice: "100", troughPrice: "100", quantity: "1", usedMargin: "100" },
    }))).toMatchObject({ action: "close", reason: /maximum-daily-loss/ });
  });

  it("uses linear short returns at the exact take-profit and stop-loss boundaries", async () => {
    const snapshot = (close: number) => input(candles([100, close]), "futures", {
      equity: "1000", dayStartEquity: "1000", utcDay: "1970-01-01",
      position: { side: "short", entryPrice: "100", peakPrice: "105", troughPrice: "95", quantity: "1", usedMargin: "50" },
    });
    let takeProfit = withBlocks(["dca", "take-profit"], "futures");
    takeProfit = setParameter(takeProfit, "take-profit", "takeProfit", 5);
    let stopLoss = withBlocks(["dca", "stop-loss"], "futures");
    stopLoss = setParameter(stopLoss, "stop-loss", "stopLoss", 5);
    expect(await createVisualHistoricalEvaluator(takeProfit).evaluate(snapshot(95))).toMatchObject({ action: "close", reason: "take-profit" });
    expect(await createVisualHistoricalEvaluator(stopLoss).evaluate(snapshot(105))).toMatchObject({ action: "close", reason: "stop-loss" });
    await expect(createVisualHistoricalEvaluator(stopLoss).evaluate({
      ...snapshot(105),
      portfolio: { ...snapshot(105).portfolio!, position: { ...snapshot(105).portfolio!.position!, entryPrice: "0" } },
    })).rejects.toThrow(/positive/);
  });

  it("runs repeated DCA tranches and grid add/reduce layers through the engine", async () => {
    const run = async (candidate: BotConfig, items: Candle[], intervalMs: number) => runHistoricalBacktest({
      dataset: {
        request: { market: candidate.market, symbol: candidate.symbol, interval: candidate.timeframe },
        candles: items, intervalMs, complete: true,
        validation: { duplicates: [], ordered: true, gaps: [], incompleteCount: 0 },
        provenance: { provider: "WEEX", sourceKind: "public-api", endpoint: "/candles", collectedAt: 1, singleResponse: true, paginated: false, truncated: false },
      },
      evaluator: createVisualHistoricalEvaluator(candidate), initialCapital: "1000", feeRate: "0", slippageRate: "0",
      leverage: String(candidate.leverage), funding: [], gapPolicy: "fail", engineVersion: "visual", configHash: "config", strategyHash: "strategy",
    });

    const day = 86_400_000;
    const dcaCandles = candles([100, 100, 100, 100, 100]).map((candle, index) => ({ ...candle, openTime: index * day, closeTime: (index + 1) * day - 1 }));
    let dca = { ...withBlocks(["dca", "fixed-position"]), timeframe: "1d" };
    dca = setParameter(setParameter(setParameter(dca, "dca", "intervalDays", 1), "fixed-position", "positionSize", 20), "stop-loss", "stopLoss", 20);
    const dcaResult = await run(dca, dcaCandles, day);
    expect(dcaResult.signalEvents.map((event) => event.effect)).toContain("added");

    let grid = withBlocks(["grid", "fixed-position"]);
    grid = setParameter(setParameter(setParameter(setParameter(grid, "grid", "gridCount", 2), "grid", "range", 2), "fixed-position", "positionSize", 50), "stop-loss", "stopLoss", 20);
    const gridResult = await run(grid, candles([100, 98, 96, 98, 100, 100]), 3_600_000);
    expect(gridResult.signalEvents.map((event) => event.effect)).toContain("added");
    expect(gridResult.signalEvents.map((event) => event.effect)).toContain("reduced");
    expect(gridResult.trades.some((trade) => trade.exitReason === "partial-reduction")).toBe(true);
  });

  it("permits bearish futures entries but never emits a spot short", async () => {
    let futures = withBlocks(["grid"], "futures");
    futures = setParameter(setParameter(futures, "grid", "gridCount", 2), "grid", "range", 2);
    const spot = { ...futures, market: "spot" as const, leverage: 1 };
    expect((await createVisualHistoricalEvaluator(futures).evaluate(input(candles([100, 102]), "futures"))).action).toBe("sell");
    expect((await createVisualHistoricalEvaluator(spot).evaluate(input(candles([100, 102]), "spot"))).action).toBe("hold");
  });
});
