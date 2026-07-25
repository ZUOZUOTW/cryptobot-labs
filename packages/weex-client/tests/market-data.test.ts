import { describe, expect, it } from "vitest";

import type { HttpRequest, HttpResponse, HttpTransport } from "../src/transport";
import { MAX_FUTURES_HISTORY_PAGES, WeexPublicClient, validateCandleDataset } from "../src/market-data";

class RecordingTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: HttpResponse[]) {}
  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  }
}

const ok = (body: unknown): HttpResponse => ({ status: 200, headers: {}, body });
const row = (openTime: number, open = "1", high = "2", low = "0.5", close = "1.5", volume = "10") =>
  [openTime, open, high, low, close, volume, openTime + 59_999, "15", 4, "5", "7.5"];

describe("WeexPublicClient", () => {
  it("uses documented spot candle query parameters including the requested limit", async () => {
    const transport = new RecordingTransport([ok([row(0)])]);
    const client = new WeexPublicClient(transport, () => 30_000);
    const candles = await client.fetchCandles({
      market: "spot", symbol: "BTCUSDT", interval: "1m", startTime: 0, endTime: 60_000, limit: 50,
    });
    expect(transport.requests[0]?.url).toBe("https://api-spot.weex.com/api/v3/market/klines?symbol=BTCUSDT&interval=1m&limit=50");
    expect(candles[0]).toMatchObject({ openTime: 0, closeTime: 59_999, open: "1", close: "1.5" });
  });

  it("uses documented futures history parameters and rejects invalid limits", async () => {
    const transport = new RecordingTransport([ok([row(60_000, "2", "3", "1", "2.5", "20")])]);
    const client = new WeexPublicClient(transport, () => 200_000);
    await client.fetchCandles({ market: "futures", symbol: "cmt_btcusdt", interval: "1m", startTime: 60_000, endTime: 120_000, limit: 100 });
    expect(transport.requests[0]?.url).toBe("https://api-contract.weex.com/capi/v3/market/historyKlines?symbol=cmt_btcusdt&interval=1m&startTime=60000&endTime=120000&limit=100");
    await expect(client.fetchCandles({ market: "futures", symbol: "x", interval: "1m", limit: 101 }))
      .rejects.toMatchObject({ category: "validation" });
  });

  it("paginates futures history backward, normalizes reversed pages, and excludes incomplete candles", async () => {
    const transport = new RecordingTransport([
      ok([row(180_000, "4", "5", "3", "4.5", "40"), row(120_000, "3", "4", "2", "3.5", "30"), row(60_000, "2", "3", "1", "2.5", "20")]),
      ok([row(0)]),
    ]);
    const dataset = await new WeexPublicClient(transport, () => 210_000).collectHistoricalCandles({
      market: "futures", symbol: "cmt_btcusdt", interval: "1m", startTime: 0, endTime: 240_000, limit: 3,
    });
    expect(dataset.candles.map((candle) => candle.openTime)).toEqual([0, 60_000, 120_000]);
    expect(dataset.validation).toMatchObject({ duplicates: [], gaps: [], incompleteCount: 1 });
    expect(dataset.provenance).toMatchObject({ provider: "WEEX", sourceKind: "public-api", endpoint: "/capi/v3/market/historyKlines", paginated: true });
    expect(dataset.complete).toBe(false);
    expect(transport.requests[1]?.url).toContain("endTime=59999");
  });

  it("truthfully marks spot single-response coverage incomplete when the range cannot be proven", async () => {
    const transport = new RecordingTransport([ok([row(60_000)])]);
    const dataset = await new WeexPublicClient(transport, () => 200_000).collectHistoricalCandles({
      market: "spot", symbol: "BTCUSDT", interval: "1m", startTime: 0, endTime: 120_000,
    });
    expect(transport.requests).toHaveLength(1);
    expect(dataset.complete).toBe(false);
    expect(dataset.provenance).toMatchObject({ singleResponse: true, paginated: false });
  });

  it("marks an aligned latest spot range complete only when every requested candle is returned", async () => {
    const transport = new RecordingTransport([ok([row(0), row(60_000)])]);
    const dataset = await new WeexPublicClient(transport, () => 200_000).collectHistoricalCandles({
      market: "spot", symbol: "BTCUSDT", interval: "1m", startTime: 0, endTime: 120_000,
    });
    expect(dataset.complete).toBe(true);
    expect(dataset.provenance).toMatchObject({ requestedStartTime: 0, requestedEndTime: 120_000,
      returnedStartTime: 0, returnedEndTime: 120_000, truncated: false });
  });

  it("rejects spot requests outside the documented latest 1000-candle window before transport", async () => {
    const transport = new RecordingTransport([]);
    await expect(new WeexPublicClient(transport).collectHistoricalCandles({
      market: "spot", symbol: "BTCUSDT", interval: "1m", startTime: 0, endTime: 60_000 * 1_001,
    })).rejects.toMatchObject({ category: "validation" });
    expect(transport.requests).toEqual([]);
  });

  it("stops full futures pages at the hard cap and reports truncation", async () => {
    const responses = Array.from({ length: MAX_FUTURES_HISTORY_PAGES }, (_, index) =>
      ok([row((MAX_FUTURES_HISTORY_PAGES + 9 - index) * 60_000)]));
    const transport = new RecordingTransport(responses);
    const dataset = await new WeexPublicClient(transport, () => 20_000_000).collectHistoricalCandles({
      market: "futures",
      symbol: "BTCUSDT",
      interval: "1m",
      startTime: 0,
      endTime: (MAX_FUTURES_HISTORY_PAGES + 10) * 60_000,
      limit: 1,
    });
    expect(transport.requests).toHaveLength(MAX_FUTURES_HISTORY_PAGES);
    expect(dataset.complete).toBe(false);
    expect(dataset.provenance).toMatchObject({ truncated: true, terminationReason: "page-limit" });
  });

  it("gets strict spot and futures instrument rules without coercing decimals", async () => {
    const transport = new RecordingTransport([
      ok({ timezone: "UTC", serverTime: 1, rateLimits: [], symbols: [{ symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", baseAssetPrecision: 8, quoteAsset: "USDT", quoteAssetPrecision: 8, tickSize: "0.01", stepSize: "0.0001", minTradeAmount: "0.0001" }] }),
      ok({ assets: [], rateLimits: [], symbols: [{ symbol: "cmt_btcusdt", displaySymbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", marginAsset: "USDT", pricePrecision: 1, quantityPrecision: 3, baseAssetPrecision: 3, quotePrecision: 8, contractVal: 0.000001, delivery: [], forwardContractFlag: true, minLeverage: 1, maxLeverage: 125, minOrderSize: 0.001 }] }),
    ]);
    const client = new WeexPublicClient(transport);
    await expect(client.getInstrumentRules("spot", "BTCUSDT")).resolves.toMatchObject({ tickSize: "0.01", stepSize: "0.0001" });
    await expect(client.getInstrumentRules("futures", "cmt_btcusdt")).resolves.toMatchObject({ maximumLeverage: "125" });
    expect(transport.requests.map(({ url }) => url)).toEqual([
      "https://api-spot.weex.com/api/v3/exchangeInfo",
      "https://api-contract.weex.com/capi/v3/market/exchangeInfo",
    ]);
  });

  it("rejects wrong-market instrument shapes", async () => {
    const spotShape = { timezone: "UTC", serverTime: 1, rateLimits: [], symbols: [{ symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", baseAssetPrecision: 8, quoteAsset: "USDT", quoteAssetPrecision: 8, tickSize: "0.01", stepSize: "0.0001", minTradeAmount: "0.0001" }] };
    const transport = new RecordingTransport([ok(spotShape)]);
    await expect(new WeexPublicClient(transport).getInstrumentRules("futures", "BTCUSDT"))
      .rejects.toMatchObject({ category: "schema" });
  });
});

describe("validateCandleDataset", () => {
  it("reports duplicates, ordering, gaps, and incomplete rows without interpolation", () => {
    const report = validateCandleDataset([
      { openTime: 60_000, closeTime: 119_999, open: "1", high: "1", low: "1", close: "1", volume: "1", complete: true },
      { openTime: 0, closeTime: 59_999, open: "1", high: "1", low: "1", close: "1", volume: "1", complete: true },
      { openTime: 60_000, closeTime: 119_999, open: "1", high: "1", low: "1", close: "1", volume: "1", complete: false },
      { openTime: 180_000, closeTime: 239_999, open: "1", high: "1", low: "1", close: "1", volume: "1", complete: true },
    ], 60_000);
    expect(report).toEqual({ duplicates: [60_000], ordered: false, gaps: [{ from: 120_000, to: 179_999 }], incompleteCount: 1 });
  });

  it("rejects malformed decimal and OHLC rows", async () => {
    const transport = new RecordingTransport([ok([row(0, "NaN")])]);
    await expect(new WeexPublicClient(transport).fetchCandles({ market: "spot", symbol: "BTCUSDT", interval: "1m" }))
      .rejects.toMatchObject({ category: "schema" });
  });

  it("rejects candle rows with extra undocumented entries", async () => {
    const transport = new RecordingTransport([ok([[...row(0), "extra"]])]);
    await expect(new WeexPublicClient(transport).fetchCandles({ market: "futures", symbol: "BTCUSDT", interval: "1m" }))
      .rejects.toMatchObject({ category: "schema" });
  });
});
