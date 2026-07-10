import { describe, expect, it } from "vitest";
import { STRATEGY_BLOCKS, STRATEGY_PRESETS } from "../data/strategies";
import { validateConfig, validateJavaScript } from "../lib/strategy-validation";
import type { BotConfig, StrategyBlock } from "../lib/types";

const cloneBlock = (id: string): StrategyBlock => {
  const source = STRATEGY_BLOCKS.find((block) => block.id === id)!;
  return { ...source, parameters: source.parameters.map((parameter) => ({ ...parameter })) };
};
const entryBlock = cloneBlock("rsi");
const riskBlock = cloneBlock("stop-loss");

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

  it("rejects unknown, duplicate, and self-described strategy metadata", () => {
    const canonicalEntry = STRATEGY_BLOCKS.find((block) => block.id === "rsi")!;
    const canonicalRisk = STRATEGY_BLOCKS.find((block) => block.id === "stop-loss")!;
    const config = { ...validConfig, blocks: [canonicalEntry, canonicalRisk] };

    expect(validateConfig({ ...config, blocks: [...config.blocks, canonicalEntry] }).errors)
      .toContain("策略模組不得重複：rsi");
    expect(validateConfig({ ...config, blocks: [{ ...canonicalEntry, id: "unknown" }, canonicalRisk] }).errors)
      .toContain("未知策略模組：unknown");
    expect(validateConfig({ ...config, blocks: [{ ...canonicalEntry, group: "confirm" }, canonicalRisk] }).errors)
      .toContain("策略模組群組不正確：rsi");
    expect(validateConfig({
      ...config,
      blocks: [{
        ...canonicalEntry,
        parameters: canonicalEntry.parameters.map((parameter) => (
          parameter.key === "oversold" ? { ...parameter, max: 999, value: 80 } : parameter
        )),
      }, canonicalRisk],
    }).errors).toContain("策略參數定義不正確：rsi.oversold");
  });

  it.each([
    ["name", { ...entryBlock, name: "偽造名稱" }, "策略模組名稱不正確：rsi"],
    ["description", { ...entryBlock, description: "偽造說明" }, "策略模組說明不正確：rsi"],
    ["label", { ...entryBlock, parameters: entryBlock.parameters.map((item, index) => index === 0 ? { ...item, label: "偽造標籤" } : item) }, "策略參數標籤不正確：rsi.period"],
    ["suffix", { ...entryBlock, parameters: entryBlock.parameters.map((item, index) => index === 0 ? { ...item, suffix: "BTC" } : item) }, "策略參數單位不正確：rsi.period"],
  ])("rejects tampered canonical %s metadata", (_field, tampered, error) => {
    expect(validateConfig({ ...validConfig, blocks: [tampered, riskBlock] }).errors).toContain(error);
  });

  it.each([
    ["market", "spot", "JavaScript 的市場（spot）與策略設定（futures）不一致"],
    ["symbol", "ETHUSDT", "JavaScript 的交易對（ETHUSDT）與策略設定（BTCUSDT）不一致"],
    ["timeframe", "4h", "JavaScript 的時間週期（4h）與策略設定（1h）不一致"],
  ])("rejects a recognized JavaScript %s that differs from bot-config", (field, sourceValue, error) => {
    const source = `export const strategy = { exchange: 'WEEX', ${field}: '${sourceValue}' };`;
    expect(validateConfig({ ...validConfig, source }).errors).toContain(error);
  });

  it.each([
    [
      "mismatched strategy object before matching display object",
      "const strategy = { exchange: 'WEEX', symbol: 'ETHUSDT' }; const display = { symbol: 'BTCUSDT' };",
    ],
    [
      "matching display object before mismatched strategy object",
      "const display = { symbol: 'BTCUSDT' }; const strategy = { exchange: 'WEEX', symbol: 'ETHUSDT' };",
    ],
  ])("rejects every recognized source value when %s", (_case, source) => {
    expect(validateConfig({ ...validConfig, source }).errors)
      .toContain("JavaScript 的交易對（ETHUSDT）與策略設定（BTCUSDT）不一致");
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

  it("folds a template whose interpolation is statically known", () => {
    const validation = validateJavaScript("const host = 'api.weex.com'; const endpoint = `https://${host}/v1`; ");

    expect(validation.valid).toBe(true);
  });

  it.each([
    ["wss://api.kucoin.com/ws", "api.kucoin.com"],
    ["ws://api.bitget.com/ws", "api.bitget.com"],
    ["https://[::1]/api", new URL("https://[::1]/api").hostname],
  ])("rejects supported network URL %s when its host is outside WEEX", (url, hostname) => {
    const source = `const exchange = 'WEEX'; const endpoint = '${url}';`;

    expect(validateJavaScript(source).errors).toContain(`偵測到非 WEEX 網域：${hostname}`);
  });

  it("rejects URL credentials even when the parsed hostname is allowed", () => {
    const source = "const exchange = 'WEEX'; const endpoint = 'https://api.kucoin.com@weex.com/private';";

    expect(validateJavaScript(source).errors).toContain("網路網址不得包含使用者資訊");
  });

  it("rejects unsupported network schemes", () => {
    const source = "const exchange = 'WEEX'; const endpoint = 'ftp://weex.com/strategy';";

    expect(validateJavaScript(source).errors).toContain("不支援的網路協定：ftp");
  });

  it.each(["https://", "https://[::1"])('rejects malformed network URL candidate %s', (url) => {
    const source = `const exchange = 'WEEX'; const endpoint = '${url}';`;

    expect(validateJavaScript(source).errors).toContain(`偵測到無效網路網址：${url}`);
  });

  it("accepts an approved WEEX websocket host", () => {
    expect(validateJavaScript("const endpoint = 'wss://ws.weex.com/stream';").valid).toBe(true);
  });

  it("checks every scheme candidate inside one decoded string", () => {
    const source = "const exchange = 'WEEX'; const endpoint = 'https://weex.com/?next=https://api.kucoin.com';";

    expect(validateJavaScript(source).errors).toContain("偵測到非 WEEX 網域：api.kucoin.com");
  });

  it.each([
    "const note = 'Binance is unsupported'; const exchange = 'WEEX';",
    "const okxClient = {}; const exchange = 'WEEX';",
    String.raw`const note = '\x42ybit'; const exchange = 'WEEX';`,
  ])("rejects known non-WEEX names in decoded strings and identifiers", (source) => {
    expect(validateJavaScript(source).errors.some((error) => error.includes("非 WEEX"))).toBe(true);
  });

  it("folds static concatenations and templates before applying URL policy", () => {
    expect(validateJavaScript("const exchange='WEEX'; fetch('https://' + 'api.binance.com/v1');").valid).toBe(false);
    expect(validateJavaScript("const exchange='WE' + 'EX'; fetch('https://' + 'api.weex.com/v1');").valid).toBe(true);
    expect(validateJavaScript("const exchange='WEEX'; const host='api.weex.com'; fetch(`https://${host}/v1`);").valid).toBe(true);
  });

  it.each([
    "const exchange='WEEX'; fetch(endpoint);",
    "const exchange='WEEX'; new WebSocket(getSocketUrl());",
    "const exchange='WEEX'; new WebTransport(endpoint);",
    "const exchange='WEEX'; fetch(`https://${window.host}/v1`);",
  ])("conservatively rejects unresolved network destinations", (source) => {
    expect(validateJavaScript(source).errors).toContain("網路目的地必須是可靜態確認的 WEEX 網址");
  });

  it.each([
    "let endpoint='https://api.weex.com/v1'; fetch(endpoint);",
    "var endpoint='https://api.weex.com/v1'; fetch(endpoint);",
    "const endpoint='https://api.weex.com/v1'; endpoint='https://evil.example'; fetch(endpoint);",
    "const endpoint='https://api.weex.com/v1'; const alias=endpoint; alias += '/orders'; fetch(alias);",
    "const endpoint='https://api.weex.com/v1'; const alias=endpoint; endpoint='https://evil.example'; fetch(alias);",
  ])("does not trust mutable or reassigned network bindings", (source) => {
    expect(validateJavaScript(`const exchange='WEEX'; ${source}`).errors)
      .toContain("網路目的地必須是可靜態確認的 WEEX 網址");
  });

  it("allows only approved schemes for resolved network APIs", () => {
    expect(validateJavaScript("const exchange='WEEX'; fetch('wss://ws.weex.com/feed');").valid).toBe(false);
    expect(validateJavaScript("const exchange='WEEX'; new WebSocket('wss://ws.weex.com/feed');").valid).toBe(true);
    expect(validateJavaScript("const exchange='WEEX'; new EventSource('https://api.weex.com/events');").valid).toBe(true);
    expect(validateJavaScript("const exchange='WEEX'; new WebTransport('https://api.weex.com/transport');").valid).toBe(true);
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
