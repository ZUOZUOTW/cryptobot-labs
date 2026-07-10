import { describe, expect, it } from "vitest";
import { STRATEGY_BLOCKS, STRATEGY_PRESETS } from "../data/strategies";
import { validateConfig, validateJavaScript } from "../lib/strategy-validation";
import type { BotConfig, StrategyBlock } from "../lib/types";

const entryBlock: StrategyBlock = {
  id: "rsi",
  name: "RSI 反轉",
  group: "entry",
  description: "RSI 進入超賣區時進場。",
  parameters: [{ key: "period", label: "RSI 週期", value: 14, min: 2, max: 100, step: 1 }],
};

const riskBlock: StrategyBlock = {
  id: "stop-loss",
  name: "固定停損",
  group: "risk",
  description: "跌幅達門檻時停損。",
  parameters: [{ key: "stopLoss", label: "停損", value: 3, min: 0.5, max: 20, step: 0.5, suffix: "%" }],
};

const validConfig: BotConfig = {
  id: "validation-fixture",
  name: "驗證測試",
  exchange: "WEEX",
  market: "futures",
  symbol: "BTCUSDT",
  timeframe: "1h",
  logicMode: "all",
  leverage: 3,
  blocks: [entryBlock, riskBlock],
};

describe("strategy catalog", () => {
  it("provides all required blocks with concrete parameter metadata", () => {
    expect(STRATEGY_BLOCKS.map((block) => block.id)).toEqual([
      "rsi",
      "macd",
      "sma-cross",
      "bollinger-breakout",
      "grid",
      "dca",
      "volume-confirmation",
      "take-profit",
      "stop-loss",
      "trailing-stop",
      "fixed-position",
      "atr-sizing",
      "maximum-daily-loss",
    ]);

    for (const block of STRATEGY_BLOCKS) {
      expect(block.parameters.length).toBeGreaterThan(0);
      for (const parameter of block.parameters) {
        expect(parameter.min).toBeLessThan(parameter.max);
        expect(parameter.value).toBeGreaterThanOrEqual(parameter.min);
        expect(parameter.value).toBeLessThanOrEqual(parameter.max);
        expect(parameter.step).toBeGreaterThan(0);
      }
    }
  });

  it("provides five named, valid WEEX presets", () => {
    expect(STRATEGY_PRESETS.map((preset) => preset.name)).toEqual([
      "穩健趨勢",
      "震盪低買高賣",
      "突破追蹤",
      "定投與回撤加碼",
      "低槓桿風控",
    ]);
    expect(STRATEGY_PRESETS.every((preset) => validateConfig(preset).valid)).toBe(true);
  });
});

describe("validateConfig", () => {
  it("accepts a valid WEEX config", () => {
    expect(validateConfig(validConfig).valid).toBe(true);
  });

  it.each([
    null,
    [],
    { ...validConfig, name: "" },
    { ...validConfig, blocks: [{ ...entryBlock, parameters: null }] },
  ])("rejects malformed runtime config shapes without throwing", (config) => {
    expect(validateConfig(config).errors).toContain("策略設定格式不正確");
  });

  it("rejects non-WEEX configs", () => {
    expect(validateConfig({ ...validConfig, exchange: "BINANCE" as "WEEX" }).errors).toContain("只支援 WEEX 交易所");
  });

  it("requires an entry signal and an exit or risk rule", () => {
    expect(validateConfig({ ...validConfig, blocks: [] }).errors).toContain("至少需要一個進場訊號");
    expect(validateConfig({ ...validConfig, blocks: [entryBlock] }).valid).toBe(false);
  });

  it("enforces spot and futures leverage limits", () => {
    expect(validateConfig({ ...validConfig, market: "spot", leverage: 2 }).valid).toBe(false);
    expect(validateConfig({ ...validConfig, leverage: 0 }).valid).toBe(false);
    expect(validateConfig({ ...validConfig, leverage: 21 }).valid).toBe(false);
    expect(validateConfig({ ...validConfig, leverage: 1 }).valid).toBe(true);
    expect(validateConfig({ ...validConfig, leverage: 20 }).valid).toBe(true);
  });

  it("rejects parameter values outside their declared range", () => {
    const invalidEntry = {
      ...entryBlock,
      parameters: [{ ...entryBlock.parameters[0], value: 101 }],
    };
    expect(validateConfig({ ...validConfig, blocks: [invalidEntry, riskBlock] }).valid).toBe(false);

    const belowMinimumEntry = {
      ...entryBlock,
      parameters: [{ ...entryBlock.parameters[0], value: 1 }],
    };
    const nonFiniteEntry = {
      ...entryBlock,
      parameters: [{ ...entryBlock.parameters[0], value: Number.NaN }],
    };
    expect(validateConfig({ ...validConfig, blocks: [belowMinimumEntry, riskBlock] }).valid).toBe(false);
    expect(validateConfig({ ...validConfig, blocks: [nonFiniteEntry, riskBlock] }).valid).toBe(false);
  });

  it("validates optional JavaScript source without executing it", () => {
    const marker = "__cryptobotStrategyValidationExecuted";
    delete (globalThis as Record<string, unknown>)[marker];
    const source = `globalThis.${marker} = true; const exchange = 'WEEX';`;

    expect(validateConfig({ ...validConfig, source }).valid).toBe(true);
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });
});

describe("validateJavaScript", () => {
  it("rejects forbidden exchange identifiers case-insensitively", () => {
    expect(validateJavaScript("fetch('https://api.binance.com')").valid).toBe(false);
    expect(validateJavaScript("const exchange = 'BYBIT';").valid).toBe(false);
  });

  it("accepts WEEX source with balanced brackets", () => {
    expect(validateJavaScript("const exchange = 'WEEX';").valid).toBe(true);
  });

  it("reports unbalanced bracket pairs", () => {
    expect(validateJavaScript("if (signal) { enter();").errors).toEqual(expect.arrayContaining([
      "括號不完整：{}",
    ]));
  });
});
