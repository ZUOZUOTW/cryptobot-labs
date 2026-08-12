import { describe, expect, it, vi } from "vitest";

import type { Candle, InstrumentRules } from "@cryptobot-labs/trading-core";
import { CloudMarketDataCache } from "../src/cloud-market-cache";
import { mapWithConcurrency } from "../src/concurrency";
import {
  AdaptiveWeexRateGovernor,
  ORDER_RATE_LIMIT_WAIT_TIMEOUT_MS,
  RateLimitedWeexTransport,
} from "../src/rate-limited-transport";
import { WeexApiError } from "@cryptobot-labs/weex-client";

const candle = (openTime: number, interval = 60_000): Candle => ({
  openTime,
  closeTime: openTime + interval - 1,
  open: "1",
  high: "1",
  low: "1",
  close: "1",
  volume: "1",
  complete: true,
});

describe("cloud market data fan-out cache", () => {
  it("shares one cold history request and only fetches an incremental window on the next candle", async () => {
    let now = 300 * 60_000;
    const collectHistoricalCandles = vi.fn(async (request: { startTime?: number; endTime?: number }) => ({
      candles: request.startTime === 0
        ? Array.from({ length: 300 }, (_, index) => candle(index * 60_000))
        : [candle(298 * 60_000), candle(299 * 60_000), candle(300 * 60_000)],
    }));
    const rules = {
      market: "futures",
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      tickSize: "0.1",
      stepSize: "0.001",
      minimumQuantity: "0.001",
      maximumLeverage: "100",
    } satisfies InstrumentRules;
    const client = {
      collectHistoricalCandles,
      getInstrumentRules: vi.fn(async () => rules),
    };
    const cache = new CloudMarketDataCache(client as never, () => now);
    const request = { market: "futures" as const, symbol: "BTCUSDT", timeframe: "1m" };

    const [first, shared] = await Promise.all([cache.history(request), cache.history(request)]);
    expect(first).toHaveLength(300);
    expect(shared).toBe(first);
    expect(collectHistoricalCandles).toHaveBeenCalledOnce();
    expect(collectHistoricalCandles.mock.calls[0]?.[0]).toMatchObject({ startTime: 0, endTime: now });

    now += 60_000;
    const next = await cache.history(request);
    expect(next).toHaveLength(300);
    expect(next.at(-1)?.closeTime).toBe(now - 1);
    expect(collectHistoricalCandles).toHaveBeenCalledTimes(2);
    expect(collectHistoricalCandles.mock.calls[1]?.[0]).toMatchObject({
      startTime: now - 3 * 60_000,
      endTime: now,
    });

    await Promise.all([
      cache.instrumentRules("futures", "BTCUSDT"),
      cache.instrumentRules("futures", "BTCUSDT"),
    ]);
    expect(client.getInstrumentRules).toHaveBeenCalledOnce();
  });

  it("fans one market request out to one hundred simultaneous strategies", async () => {
    const now = 300 * 60_000;
    const collectHistoricalCandles = vi.fn(async () => ({
      candles: Array.from({ length: 300 }, (_, index) => candle(index * 60_000)),
    }));
    const cache = new CloudMarketDataCache({
      collectHistoricalCandles,
      getInstrumentRules: vi.fn(),
    } as never, () => now);
    const request = { market: "futures" as const, symbol: "BTCUSDT", timeframe: "1m" };

    const histories = await Promise.all(
      Array.from({ length: 100 }, () => cache.history(request)),
    );

    expect(collectHistoricalCandles).toHaveBeenCalledOnce();
    expect(histories).toHaveLength(100);
    expect(histories.every((history) => history === histories[0])).toBe(true);
    expect(histories[0]).toHaveLength(300);
  });
});

describe("WEEX capacity governor", () => {
  it("keeps request weight below the configured ten-second budget", async () => {
    let now = 0;
    const waits: number[] = [];
    const governor = new AdaptiveWeexRateGovernor({
      now: () => now,
      scheduler: async (delayMs) => { waits.push(delayMs); now += delayMs; },
      maximumWeight10s: 2,
    });
    await governor.acquire(false);
    await governor.acquire(false);
    await governor.acquire(false);

    expect(waits).toEqual([10_000]);
    expect(governor.snapshot().requestCount10s).toBe(1);
  });

  it("opens a ten-second circuit after an exchange rate-limit response", async () => {
    let now = 1_000;
    const waits: number[] = [];
    const governor = new AdaptiveWeexRateGovernor({
      now: () => now,
      scheduler: async (delayMs) => { waits.push(delayMs); now += delayMs; },
    });
    governor.trip(new WeexApiError("limited", { category: "rate-limit", retryable: true, status: 429 }));
    await governor.acquire(false);

    expect(waits).toEqual([10_000]);
    expect(governor.snapshot().rateLimitEvents).toBe(1);
  });

  it("fails an order before dispatch when the governor wait cannot fit its deadline", async () => {
    let now = 1_000;
    const scheduler = vi.fn(async (delayMs: number) => { now += delayMs; });
    const governor = new AdaptiveWeexRateGovernor({ now: () => now, scheduler });
    governor.trip(new WeexApiError("limited", { category: "rate-limit", retryable: true, status: 429 }));
    const send = vi.fn();
    const transport = new RateLimitedWeexTransport({ send }, governor);

    await expect(transport.send({
      method: "POST",
      url: "https://api-contract.weex.com/capi/v3/order",
      headers: {},
      body: "{}",
    })).rejects.toMatchObject({ category: "rate-limit", retryable: true });

    expect(ORDER_RATE_LIMIT_WAIT_TIMEOUT_MS).toBeLessThan(10_000);
    expect(scheduler).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("bounded worker pool", () => {
  it("never exceeds its configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
    });
    expect(peak).toBe(3);
  });

  it("processes one hundred strategies without exceeding the production worker cap", async () => {
    let active = 0;
    let peak = 0;
    let completed = 0;
    await mapWithConcurrency(Array.from({ length: 100 }, (_, index) => index), 8, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      completed += 1;
      active -= 1;
    });

    expect(completed).toBe(100);
    expect(peak).toBe(8);
  });
});
