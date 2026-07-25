import { describe, expect, it } from "vitest";

import {
  DEFAULT_FUNDING_MARK_MAX_AGE_MS,
  MAX_FUNDING_MARK_PAGES,
  MAX_FUNDING_HISTORY_RANGE_MS,
  WeexPublicClient,
} from "../src/market-data";
import type { HttpRequest, HttpResponse, HttpTransport } from "../src/transport";

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
const mark = (openTime: number, close: string, closeTime = openTime + 14_399_999) =>
  [openTime, close, close, close, close, "1", closeTime, "1", 1, "1", "1"];
const rate = (fundingTime: number, fundingRate = "0.0001", symbol = "cmt_btcusdt") =>
  ({ symbol, fundingTime, fundingRate });

describe("WEEX historical funding collection", () => {
  it("uses only official V2 funding and V3 MARK query fields with normalized futures symbols", async () => {
    const transport = new RecordingTransport([
      ok([rate(28_800_000)]),
      ok([mark(14_400_000, "42000", 28_799_999)]),
    ]);
    const result = await new WeexPublicClient(transport, () => 40_000_000).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 20_000_000, endTime: 30_000_000,
    });

    expect(transport.requests.map(({ url }) => url)).toEqual([
      "https://api-contract.weex.com/capi/v2/market/getHistoryFundRate?symbol=cmt_btcusdt&limit=100",
      "https://api-contract.weex.com/capi/v3/market/historyKlines?symbol=BTCUSDT&interval=4h&startTime=5600000&endTime=30000000&limit=100&priceType=MARK",
    ]);
    expect(result.funding).toEqual([{ timestamp: 28_800_000, rate: "0.0001", markPrice: "42000" }]);
    expect(result.provenance).toMatchObject({
      provider: "WEEX", fundingEndpoint: "/capi/v2/market/getHistoryFundRate",
      markEndpoint: "/capi/v3/market/historyKlines", priceType: "MARK",
      markMaxAgeMs: DEFAULT_FUNDING_MARK_MAX_AGE_MS,
    });
  });

  it("paginates MARK history backwards when WEEX returns the latest full page", async () => {
    const interval = 4 * 60 * 60 * 1_000;
    const earlyFundingTime = 11 * interval;
    const lateFundingTime = 151 * interval;
    const transport = new RecordingTransport([
      ok([
        rate(lateFundingTime, "0.0001", "cmt_aaveusdt"),
        rate(earlyFundingTime, "0.0001", "cmt_aaveusdt"),
      ]),
      ok(Array.from({ length: 100 }, (_, index) => mark((100 + index) * interval, "200"))),
      ok(Array.from({ length: 99 }, (_, index) => mark((1 + index) * interval, "100"))),
    ]);

    const result = await new WeexPublicClient(transport, () => 200 * interval).collectHistoricalFunding({
      market: "futures",
      symbol: "AAVEUSDT",
      startTime: 10 * interval,
      endTime: 200 * interval,
      maxMarkAgeMs: 10 * interval,
      strict: true,
    });

    expect(transport.requests.map(({ url }) => url)).toEqual([
      "https://api-contract.weex.com/capi/v2/market/getHistoryFundRate?symbol=cmt_aaveusdt&limit=100",
      `https://api-contract.weex.com/capi/v3/market/historyKlines?symbol=AAVEUSDT&interval=4h&startTime=0&endTime=${200 * interval}&limit=100&priceType=MARK`,
      `https://api-contract.weex.com/capi/v3/market/historyKlines?symbol=AAVEUSDT&interval=4h&startTime=0&endTime=${100 * interval - 1}&limit=100&priceType=MARK`,
    ]);
    expect(result.complete).toBe(true);
    expect(result.funding).toEqual([
      { timestamp: earlyFundingTime, rate: "0.0001", markPrice: "100" },
      { timestamp: lateFundingTime, rate: "0.0001", markPrice: "200" },
    ]);
    expect(result.provenance.markPages).toBe(2);
  });

  it("sorts and deduplicates identical funding rows but rejects conflicting duplicates", async () => {
    const good = new RecordingTransport([
      ok([rate(20, "0.2"), rate(10, "0.1"), rate(20, "0.2")]),
      ok([mark(0, "10", 9), mark(10, "20", 19)]),
    ]);
    const result = await new WeexPublicClient(good, () => 100).collectHistoricalFunding({
      market: "futures", symbol: "cmt_btcusdt", startTime: 10, endTime: 21, maxMarkAgeMs: 20,
    });
    expect(result.funding.map(({ timestamp }) => timestamp)).toEqual([10, 20]);

    const conflict = new RecordingTransport([ok([rate(10, "0.1"), rate(10, "0.2")])]);
    await expect(new WeexPublicClient(conflict, () => 100).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 20,
    })).rejects.toMatchObject({ category: "schema" });
  });

  it("normalizes bounded scientific-notation funding rates from the official API", async () => {
    const transport = new RecordingTransport([
      ok([rate(10, "5.5E-7"), rate(20, "-1.25e-6")]),
      ok([mark(0, "10", 9), mark(10, "20", 19)]),
    ]);
    const result = await new WeexPublicClient(transport, () => 100).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 21, maxMarkAgeMs: 20,
    });
    expect(result.funding).toEqual([
      { timestamp: 10, rate: "0.00000055", markPrice: "10" },
      { timestamp: 20, rate: "-0.00000125", markPrice: "20" },
    ]);
  });

  it.each([
    [{ symbol: "cmt_btcusdt", fundingRate: 0.1, fundingTime: 10 }],
    [{ symbol: "cmt_btcusdt", fundingRate: "NaN", fundingTime: 10 }],
    [{ symbol: "cmt_btcusdt", fundingRate: "1e999", fundingTime: 10 }],
    [{ symbol: "cmt_btcusdt", fundingRate: "0.1", fundingTime: "ten" }],
    [{ symbol: "cmt_btcusdt", fundingRate: "0.1", fundingTime: 10, extra: true }],
    [{ fundingRate: "0.1", fundingTime: 10 }],
  ])("rejects invalid funding rows %#", async (body) => {
    const transport = new RecordingTransport([ok(body)]);
    await expect(new WeexPublicClient(transport).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 20,
    })).rejects.toMatchObject({ category: "schema" });
  });

  it("rejects a returned V2 symbol that does not match the requested contract", async () => {
    const transport = new RecordingTransport([ok([rate(10, "0.1", "cmt_ethusdt")])]);
    await expect(new WeexPublicClient(transport, () => 20).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 20,
    })).rejects.toMatchObject({ category: "schema" });
    expect(transport.requests).toHaveLength(1);
  });

  it("never uses a future MARK close and marks a missing prior mark incomplete", async () => {
    const transport = new RecordingTransport([
      ok([rate(100)]),
      ok([mark(50, "20", 101)]),
    ]);
    const result = await new WeexPublicClient(transport, () => 200).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 90, endTime: 110, maxMarkAgeMs: 100,
    });
    expect(result.funding).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.coverage).toMatchObject({ requestedEvents: 1, matchedEvents: 0, missingMarkTimestamps: [100] });
  });

  it("does not zero-fill stale marks and strict mode fails incomplete coverage", async () => {
    const looseTransport = new RecordingTransport([ok([rate(100)]), ok([mark(0, "10", 1)])]);
    const loose = await new WeexPublicClient(looseTransport, () => 200).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 90, endTime: 110, maxMarkAgeMs: 10,
    });
    expect(loose.funding).toEqual([]);
    expect(loose.complete).toBe(false);

    const strictTransport = new RecordingTransport([ok([rate(100)]), ok([mark(0, "10", 1)])]);
    await expect(new WeexPublicClient(strictTransport, () => 200).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 90, endTime: 110, maxMarkAgeMs: 10, strict: true,
    })).rejects.toMatchObject({ category: "validation" });
  });

  it("marks a range older than the latest-100 V2 window incomplete and strict mode rejects it", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => rate(1_000 + index * 10));
    const loose = await new WeexPublicClient(new RecordingTransport([ok(rows)]), () => 3_000)
      .collectHistoricalFunding({ market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 500 });
    expect(loose.complete).toBe(false);
    expect(loose.coverage).toMatchObject({ fundingRangeCovered: false, requestedEvents: 0 });

    await expect(new WeexPublicClient(new RecordingTransport([ok(rows)]), () => 3_000)
      .collectHistoricalFunding({ market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 500, strict: true }))
      .rejects.toMatchObject({ category: "validation" });
  });

  it("rejects spot, unsafe ranges, invalid symbols, and invalid mark ages before transport", async () => {
    for (const request of [
      { market: "spot" as const, symbol: "BTCUSDT", startTime: 0, endTime: 1 },
      { market: "futures" as const, symbol: "BTC/USDT", startTime: 0, endTime: 1 },
      { market: "futures" as const, symbol: "BTCUSDT", startTime: 2, endTime: 1 },
      { market: "futures" as const, symbol: "BTCUSDT", startTime: 0, endTime: MAX_FUNDING_HISTORY_RANGE_MS + 1 },
      { market: "futures" as const, symbol: "BTCUSDT", startTime: 0, endTime: 1, maxMarkAgeMs: 0 },
    ]) {
      const transport = new RecordingTransport([]);
      await expect(new WeexPublicClient(transport).collectHistoricalFunding(request)).rejects.toMatchObject({ category: "validation" });
      expect(transport.requests).toHaveLength(0);
    }
    expect(DEFAULT_FUNDING_MARK_MAX_AGE_MS).toBeGreaterThan(0);
  });

  it("takes one safe clock snapshot and rejects future ranges before transport", async () => {
    let calls = 0;
    const transport = new RecordingTransport([ok([])]);
    const result = await new WeexPublicClient(transport, () => {
      calls += 1;
      return 200;
    }).collectHistoricalFunding({ market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 200 });
    expect(calls).toBe(1);
    expect(result.provenance.collectedAt).toBe(200);

    const future = new RecordingTransport([]);
    await expect(new WeexPublicClient(future, () => 200).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 201,
    })).rejects.toMatchObject({ category: "validation" });
    expect(future.requests).toHaveLength(0);

    const invalidClock = new RecordingTransport([]);
    await expect(new WeexPublicClient(invalidClock, () => Number.NaN).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 1,
    })).rejects.toMatchObject({ category: "validation" });
    expect(invalidClock.requests).toHaveLength(0);
  });

  it("rejects a funding payload beyond the documented latest-100 bound", async () => {
    const transport = new RecordingTransport([
      ok(Array.from({ length: 101 }, (_, index) => rate(index))),
    ]);
    await expect(new WeexPublicClient(transport, () => 1_000).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 100,
    })).rejects.toMatchObject({ category: "schema" });
    expect(transport.requests).toHaveLength(1);
  });

  it("caps arrays and numeric strings before parsing funding and MARK payloads", async () => {
    const oversizedFunding = new RecordingTransport([
      ok(Array.from({ length: 101 }, (_, index) => ({ bad: index }))),
    ]);
    await expect(new WeexPublicClient(oversizedFunding, () => 1_000).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 100,
    })).rejects.toMatchObject({ category: "schema" });

    const hugeRate = new RecordingTransport([ok([rate(10, `0.${"1".repeat(256)}`)])]);
    await expect(new WeexPublicClient(hugeRate, () => 100).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 20,
    })).rejects.toMatchObject({ category: "schema" });

    const oversizedMarks = new RecordingTransport([
      ok([rate(10)]),
      ok(Array.from({ length: 101 }, () => ({ bad: true }))),
    ]);
    await expect(new WeexPublicClient(oversizedMarks, () => 100).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 20,
    })).rejects.toMatchObject({ category: "schema" });

    const hugePrice = new RecordingTransport([
      ok([rate(10)]),
      ok([mark(0, `1${"0".repeat(256)}`, 9)]),
    ]);
    await expect(new WeexPublicClient(hugePrice, () => 100).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0, endTime: 20,
    })).rejects.toMatchObject({ category: "schema" });
  });

  it("rejects conflicting duplicate MARK candles rather than choosing one", async () => {
    const transport = new RecordingTransport([
      ok([rate(100)]),
      ok([mark(0, "10", 99), mark(0, "11", 99)]),
    ]);
    await expect(new WeexPublicClient(transport, () => 200).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 90, endTime: 110, maxMarkAgeMs: 100,
    })).rejects.toMatchObject({ category: "schema" });
  });

  it("bounds MARK pagination even if every page is full", async () => {
    const rates = [rate(100)];
    const interval = 4 * 60 * 60 * 1_000;
    const responses = [ok(rates), ...Array.from({ length: MAX_FUNDING_MARK_PAGES }, (_, page) =>
      ok(Array.from({ length: 100 }, (_, rowIndex) => {
        const openTime = ((MAX_FUNDING_MARK_PAGES - page - 1) * 100 + rowIndex) * interval;
        return mark(openTime, "1", openTime + interval - 1);
      })))];
    const transport = new RecordingTransport(responses);
    const result = await new WeexPublicClient(transport, () => MAX_FUNDING_HISTORY_RANGE_MS).collectHistoricalFunding({
      market: "futures", symbol: "BTCUSDT", startTime: 0,
      endTime: MAX_FUNDING_MARK_PAGES * 100 * interval, maxMarkAgeMs: 1,
    });
    expect(transport.requests).toHaveLength(1 + MAX_FUNDING_MARK_PAGES);
    expect(result.complete).toBe(false);
    expect(result.provenance).toMatchObject({ truncated: true, terminationReason: "mark-candle-limit" });
  });
});
