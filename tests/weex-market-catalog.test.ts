import { describe, expect, it } from "vitest";
import {
  FALLBACK_WEEX_MARKET_CATALOG,
  WEEX_HELP_ARTICLE_SYMBOLS,
  canonicalizeWeexSymbol,
  isWeexApiTradingSymbol,
  isWeexMarketCatalog,
  parseWeexMarketCatalog,
} from "../lib/weex-market-catalog";

describe("WEEX market catalog", () => {
  it("keeps every help-center spot and futures symbol available as an offline fallback", () => {
    expect(FALLBACK_WEEX_MARKET_CATALOG.spot.map(({ symbol }) => symbol)).toEqual(WEEX_HELP_ARTICLE_SYMBOLS.spot);
    expect(FALLBACK_WEEX_MARKET_CATALOG.futures.map(({ symbol }) => symbol)).toEqual(WEEX_HELP_ARTICLE_SYMBOLS.futures);
    expect(new Set(WEEX_HELP_ARTICLE_SYMBOLS.spot).size).toBe(WEEX_HELP_ARTICLE_SYMBOLS.spot.length);
    expect(new Set(WEEX_HELP_ARTICLE_SYMBOLS.futures).size).toBe(WEEX_HELP_ARTICLE_SYMBOLS.futures.length);
  });

  it("normalizes official API symbols and preserves each contract maximum leverage", () => {
    const catalog = parseWeexMarketCatalog(
      ["BTCUSDT", "SOLUSDT", "NOTAPIUSDT"],
      { symbols: [
        { symbol: "cmt_btcusdt", displaySymbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", maxLeverage: 408 },
        { symbol: "cmt_solusdt", displaySymbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", maxLeverage: 125 },
        { symbol: "cmt_notapiusdt", displaySymbol: "NOTAPIUSDT", baseAsset: "NOTAPI", quoteAsset: "USDT", maxLeverage: 50 },
      ] },
      new Date("2026-07-13T00:00:00.000Z"),
    );

    expect(catalog.futures).toEqual([
      { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", maxLeverage: 408 },
      { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", maxLeverage: 125 },
    ]);
    expect(catalog.spot).toEqual([
      { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", maxLeverage: 1 },
      { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", maxLeverage: 1 },
    ]);
    expect(isWeexMarketCatalog(catalog)).toBe(true);
  });

  it("rejects products that have public market data but are absent from the API trading announcement", () => {
    expect(isWeexApiTradingSymbol("spot", "BTC/USDT")).toBe(true);
    expect(isWeexApiTradingSymbol("futures", "cmt_btcusdt")).toBe(true);
    expect(isWeexApiTradingSymbol("spot", "NOTAPIUSDT")).toBe(false);
    expect(isWeexApiTradingSymbol("futures", "NOTAPIUSDT")).toBe(false);
  });

  it("uses one canonical identity for every WEEX symbol spelling accepted by the catalog", () => {
    expect(["BTCUSDT", "BTC_USDT", "BTC/USDT", "CMT_BTCUSDT", "cmt_btc_usdt"]
      .map(canonicalizeWeexSymbol)).toEqual(Array(5).fill("BTCUSDT"));
  });
});
