import { describe, expect, it } from "vitest";

import { ConnectionRegistry, LocalConnectionError } from "../src/main/connections";
import { ClockFreshnessGuard, MarketStreamState, MarketStreamError } from "../src/main/market-stream";
import { PaperExchange } from "../src/main/paper-exchange";

const intent = {
  symbol: "BTCUSDT",
  side: "buy" as const,
  quantity: "2",
  price: "100",
  expectedSlippageBps: "25",
  reduceOnly: false,
};
const spotPaper = { market: "spot" as const, mode: "paper" as const };
const futuresPaper = { market: "futures" as const, mode: "paper" as const };

describe("PaperExchange", () => {
  it("fills deterministically with adverse configurable slippage and fees", async () => {
    const exchange = new PaperExchange({ slippageBps: "25", feeBps: "10", now: () => 1_700_000_000_000 });

    await expect(exchange.submit({ target: spotPaper, clientOrderId: "paper-1", intent }))
      .resolves.toEqual({ status: "acknowledged", exchangeOrderId: "paper-paper-1" });
    await expect(exchange.findByClientOrderId({ target: spotPaper, symbol: "BTCUSDT", clientOrderId: "paper-1" }))
      .resolves.toEqual({
        clientOrderId: "paper-1", exchangeOrderId: "paper-paper-1", symbol: "BTCUSDT",
        side: "buy", quantity: "2", status: "FILLED", cumulativeFilledQuantity: "2",
        averageFillPrice: "100.25", fees: "0.2005", filledAt: 1_700_000_000_000,
      });

    await exchange.submit({
      target: futuresPaper, clientOrderId: "paper-2", intent: { ...intent, side: "sell" },
    });
    await expect(exchange.findByClientOrderId({ target: futuresPaper, symbol: "BTCUSDT", clientOrderId: "paper-2" }))
      .resolves.toMatchObject({ averageFillPrice: "99.75", fees: "0.1995" });
  });

  it("is idempotent for an identical client order id and rejects identity reuse", async () => {
    const exchange = new PaperExchange({ slippageBps: "0", feeBps: "0" });
    const request = { target: spotPaper, clientOrderId: "same", intent };
    const first = await exchange.submit(request);
    await expect(exchange.submit(structuredClone(request))).resolves.toEqual(first);
    await expect(exchange.submit({ ...request, intent: { ...intent, quantity: "3" } }))
      .resolves.toEqual({ status: "rejected", reason: "client-order-id-conflict" });
  });

  it("validates bounded plain decimals and never mutates the approved intent", async () => {
    const exchange = new PaperExchange({ slippageBps: "1", feeBps: "1" });
    const approved = structuredClone(intent);
    await exchange.submit({ target: spotPaper, clientOrderId: "immutable", intent: approved });
    expect(approved).toEqual(intent);
    await expect(exchange.submit({
      target: spotPaper, clientOrderId: "bad", intent: { ...intent, price: "1e2" },
    })).rejects.toThrow("price");
    await expect(exchange.submit({
      target: { market: "spot", mode: "live" }, clientOrderId: "live", intent,
    })).rejects.toThrow("request");
    expect(() => new PaperExchange({ slippageBps: "10000.1", feeBps: "0" })).toThrow("slippage");
  });
});

describe("local execution freshness helpers", () => {
  it("requires a fresh, target-matching verified connection without retaining secrets", () => {
    const registry = new ConnectionRegistry();
    registry.record({
      verifiedAt: 10_000, apiKeySuffix: "1234", canTrade: true,
      withdrawalPermission: "absent", permissions: { read: true, spot: true, futures: false },
    });
    expect(registry.requireFresh({ market: "spot", mode: "live" }, 11_000, 2_000).apiKeySuffix).toBe("1234");
    expect(() => registry.requireFresh({ market: "futures", mode: "live" }, 11_000, 2_000))
      .toThrowError(new LocalConnectionError("permission", "Verified connection lacks futures permission"));
    expect(() => registry.requireFresh({ market: "spot", mode: "live" }, 12_001, 2_000))
      .toThrowError(LocalConnectionError);
    expect(JSON.stringify(registry.snapshot())).not.toMatch(/secret|passphrase/i);
  });

  it("requires fresh monotonic market data and a fresh low-drift clock sample", () => {
    const market = new MarketStreamState();
    market.record({
      market: "spot", symbol: "BTCUSDT", bid: "99.9", ask: "100.1", last: "100",
      exchangeTimestamp: 10_000, receivedAt: 10_010,
    });
    expect(market.requireFresh("spot", "BTCUSDT", 10_510, 500).last).toBe("100");
    expect(() => market.requireFresh("spot", "BTCUSDT", 10_511, 500)).toThrowError(MarketStreamError);
    expect(() => market.record({
      market: "spot", symbol: "BTCUSDT", bid: "99", ask: "100", last: "99.5",
      exchangeTimestamp: 9_999, receivedAt: 10_020,
    })).toThrow("out of order");
    expect(() => market.record({
      market: "spot", symbol: "ETHUSDT", bid: "0", ask: "100", last: "99.5",
      exchangeTimestamp: 10_000, receivedAt: 10_010,
    })).toThrow("Invalid market quote");
    expect(() => market.record({
      market: "spot", symbol: "ETHUSDT", bid: "101", ask: "100", last: "100.5",
      exchangeTimestamp: 10_000, receivedAt: 10_010,
    })).toThrow("Invalid market quote");

    const clock = new ClockFreshnessGuard();
    clock.record({ synchronizedAt: 20_000, driftMs: 250 });
    expect(clock.requireFresh(25_000, 10_000, 1_000).driftMs).toBe(250);
    expect(() => clock.requireFresh(30_001, 10_000, 1_000)).toThrow("stale");
  });
});
