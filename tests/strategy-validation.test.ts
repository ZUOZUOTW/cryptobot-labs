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

  it.each([
    {
      blockId: "sma-cross",
      values: { shortPeriod: 60, longPeriod: 20 },
      error: "SMA 均線交叉（sma-cross）的短期均線（shortPeriod）必須小於長期均線（longPeriod）",
    },
    {
      blockId: "macd",
      values: { fastPeriod: 26, slowPeriod: 12 },
      error: "MACD 動能（macd）的快線週期（fastPeriod）必須小於慢線週期（slowPeriod）",
    },
  ])("rejects contradictory $blockId periods with actionable identifiers", ({ blockId, values, error }) => {
    const catalogBlock = STRATEGY_BLOCKS.find((block) => block.id === blockId)!;
    const contradictoryBlock = {
      ...catalogBlock,
      parameters: catalogBlock.parameters.map((parameter) => ({
        ...parameter,
        value: values[parameter.key as keyof typeof values] ?? parameter.value,
      })),
    };

    expect(validateConfig({ ...validConfig, blocks: [contradictoryBlock, riskBlock] }).errors).toContain(error);
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

  it("requires source to explicitly identify WEEX", () => {
    expect(validateJavaScript("const strategy = { symbol: 'BTCUSDT' };").errors)
      .toContain("策略程式碼必須明確指定 WEEX 交易所");
    expect(validateJavaScript("const note = 'WEEX';").errors)
      .toContain("策略程式碼必須明確指定 WEEX 交易所");
  });

  it.each([
    "https://api.kucoin.com/v1/orders",
    "https://weex.com.evil.example/collect",
    "http://bitget.com/api",
  ])("rejects every non-WEEX HTTP host: %s", (url) => {
    expect(validateJavaScript(`const exchange = 'WEEX'; fetch('${url}');`).errors)
      .toContain(`偵測到非 WEEX 網域：${new URL(url).hostname}`);
  });

  it.each([
    "const exchange = 'KuCoin';",
    "const config = { exchange: 'BITGET' };",
    "exchange = BYBIT;",
  ])("rejects non-WEEX exchange assignments without relying on a short denylist", (source) => {
    expect(validateJavaScript(source).errors.some((error) => error.includes("偵測到非 WEEX 交易所識別字")))
      .toBe(true);
  });

  it("accepts weex.com and its subdomains", () => {
    expect(validateJavaScript("fetch('https://api.weex.com/v1/markets');").valid).toBe(true);
    expect(validateJavaScript("const endpoint = 'https://weex.com/api';").valid).toBe(true);
  });

  it("ignores URLs in comments for both approval and rejection", () => {
    expect(validateJavaScript("// https://api.weex.com/v1\nconst note = 'comment only';").errors)
      .toContain("策略程式碼必須明確指定 WEEX 交易所");
    expect(validateJavaScript("// https://api.kucoin.com/v1\nconst exchange = 'WEEX';").valid)
      .toBe(true);
  });

  it("decodes escaped URL literals before applying the host allowlist", () => {
    const source = String.raw`const exchange = 'WEEX'; const endpoint = 'https:\/\/api.kucoin.com/v1';`;

    expect(validateJavaScript(source).errors).toContain("偵測到非 WEEX 網域：api.kucoin.com");
  });

  it("checks static template URL values and rejects lookalike hosts", () => {
    expect(validateJavaScript("const endpoint = `https://api.weex.com/v1`; ").valid).toBe(true);
    expect(validateJavaScript("const exchange = 'WEEX'; const endpoint = `https://weex.com.evil.example/v1`; ").errors)
      .toContain("偵測到非 WEEX 網域：weex.com.evil.example");
  });

  it("does not use a dynamic template URL to qualify WEEX", () => {
    const validation = validateJavaScript("const host = 'api.weex.com'; const endpoint = `https://${host}/v1`; ");

    expect(validation.errors).toEqual(["策略程式碼必須明確指定 WEEX 交易所"]);
  });

  it.each([
    ["const exchange = 'WEEX';\nconst = ;", 2],
    ["const exchange = 'WEEX';\nif (signal) { enter();", 2],
  ])("reports real JavaScript syntax errors with their line number", (source, line) => {
    expect(validateJavaScript(source).errors).toEqual([
      expect.stringContaining(`第 ${line} 行`),
    ]);
  });
});
