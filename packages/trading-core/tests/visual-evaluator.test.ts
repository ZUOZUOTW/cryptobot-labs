import { describe, expect, it } from "vitest";

import {
  cloneVisualStrategyBlock,
  createVisualStrategyEvaluator,
  type Candle,
  type VisualBotConfig,
} from "../src";

const config = (blocks = ["grid", "fixed-position", "stop-loss"]): VisualBotConfig => ({
  id: "visual-test",
  name: "Visual test",
  exchange: "WEEX",
  market: "spot",
  symbol: "BTCUSDT",
  timeframe: "1h",
  logicMode: "all",
  leverage: 1,
  blocks: blocks.map(cloneVisualStrategyBlock),
});

const candles = (closes: readonly number[]): Candle[] => closes.map((close, index) => ({
  openTime: index * 3_600_000,
  closeTime: (index + 1) * 3_600_000 - 1,
  open: String(close),
  high: String(close + 1),
  low: String(close - 1),
  close: String(close),
  volume: "100",
  complete: true,
}));

const input = (items: readonly Candle[]) => ({
  candles: items,
  market: "spot" as const,
  symbol: "BTCUSDT",
  timeframe: "1h",
  leverage: "1",
  now: items.at(-1)!.closeTime,
});

describe("visual strategy evaluator", () => {
  it("emits deterministic signals from the portable block catalog", async () => {
    const evaluator = createVisualStrategyEvaluator(config());
    const first = await evaluator.evaluate(input(candles([100, 98])));
    const second = await evaluator.evaluate(input(candles([100, 98])));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      action: "buy",
      reason: "entry:all:grid",
      allocationRate: 0.1,
    });
    expect(evaluator.maximumLookback).toBe(1024);
  });

  it("strictly rejects non-canonical, custom-source, and invalid parameter configs", () => {
    expect(() => createVisualStrategyEvaluator({ ...config(), unexpected: true } as VisualBotConfig)).toThrow(/strict canonical/i);
    expect(() => createVisualStrategyEvaluator({ ...config(), source: "export default () => ({ action: 'hold' })" })).toThrow(/QuickJS/);

    const invalid = config();
    invalid.blocks[0]!.parameters.find((item) => item.key === "gridCount")!.value = 10.5;
    expect(() => createVisualStrategyEvaluator(invalid)).toThrow(/parameter step/i);
  });

  it("freezes a canonical snapshot and applies daily-loss risk before entries", async () => {
    const candidate = config(["grid", "maximum-daily-loss"]);
    const evaluator = createVisualStrategyEvaluator(candidate);
    candidate.name = "mutated";
    candidate.blocks[0]!.parameters[0]!.value = 50;

    expect(evaluator.config.name).toBe("Visual test");
    expect(Object.isFrozen(evaluator.config.blocks[0]!.parameters)).toBe(true);
    await expect(evaluator.evaluate({
      ...input(candles([100, 98])),
      portfolio: {
        equity: "94",
        dayStartEquity: "100",
        utcDay: "2026-07-12",
      },
    })).resolves.toMatchObject({ action: "hold", reason: "maximum-daily-loss:suppress" });
  });

  it("rejects datasets that do not match the configured execution target", async () => {
    await expect(createVisualStrategyEvaluator(config()).evaluate({
      ...input(candles([100, 98])),
      symbol: "ETHUSDT",
    })).rejects.toThrow(/does not match/i);
  });

  it("enforces long-only, short-only, and bidirectional futures entries", async () => {
    const futuresInput = (values: readonly number[]) => ({
      ...input(candles(values)),
      market: "futures" as const,
      leverage: "2",
    });
    const futures = {
      ...config(),
      market: "futures" as const,
      leverage: 2,
    };

    await expect(createVisualStrategyEvaluator({ ...futures, tradeDirection: "long" })
      .evaluate(futuresInput([100, 102])))
      .resolves.toMatchObject({ action: "hold", reason: "trade-direction:long:entry-suppressed" });
    await expect(createVisualStrategyEvaluator({ ...futures, tradeDirection: "short" })
      .evaluate(futuresInput([100, 98])))
      .resolves.toMatchObject({ action: "hold", reason: "trade-direction:short:entry-suppressed" });
    await expect(createVisualStrategyEvaluator({ ...futures, tradeDirection: "short" })
      .evaluate(futuresInput([100, 102])))
      .resolves.toMatchObject({ action: "sell" });
    await expect(createVisualStrategyEvaluator({ ...futures, tradeDirection: "both" })
      .evaluate(futuresInput([100, 98])))
      .resolves.toMatchObject({ action: "buy" });
  });

  it("fails closed on oversized, unordered, incomplete, and incoherent portfolio input", async () => {
    const evaluator = createVisualStrategyEvaluator(config());
    const valid = candles([100, 98]);
    await expect(evaluator.evaluate(input(Array.from({ length: 1025 }, (_, index) => ({
      ...valid[0]!, openTime: index * 3_600_000, closeTime: (index + 1) * 3_600_000 - 1,
    }))))).rejects.toThrow(/lookback/i);
    await expect(evaluator.evaluate(input([
      valid[0]!,
      { ...valid[1]!, openTime: valid[0]!.openTime },
    ]))).rejects.toThrow(/candles/i);
    await expect(evaluator.evaluate(input([{ ...valid[0]!, complete: false }]))).rejects.toThrow(/candles/i);
    await expect(evaluator.evaluate({
      ...input(valid),
      portfolio: {
        equity: "100",
        dayStartEquity: "100",
        utcDay: "2026-07-12",
        position: {
          side: "long",
          entryPrice: "100",
          peakPrice: "90",
          troughPrice: "80",
          quantity: "1",
          usedMargin: "10",
          layerCount: 1,
        },
      },
    })).rejects.toThrow(/position/i);
  });
});
