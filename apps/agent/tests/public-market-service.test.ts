import type { HttpRequest, HttpResponse, HttpTransport } from "@cryptobot-labs/weex-client";
import { describe, expect, it } from "vitest";

import { ClockFreshnessGuard, MarketStreamState } from "../src/main/market-stream";
import { InstrumentRuleState, PublicMarketService } from "../src/main/public-market-service";

class Transport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: HttpResponse[]) {}
  async send(request: HttpRequest) { this.requests.push(request); const value = this.responses.shift(); if (!value) throw new Error("unexpected request"); return value; }
}
const ok = (body: unknown, headers: Record<string, string> = {}): HttpResponse => ({ status: 200, headers, body });
const NOW = 1_700_000_120_000;

describe("public market service", () => {
  it("records bounded price, candle, clock, and instrument evidence", async () => {
    const transport = new Transport([
      ok({ symbol: "BTCUSDT", price: "60000" }, { date: new Date(NOW).toUTCString() }),
      ok({ timezone: "UTC", serverTime: NOW, rateLimits: [], symbols: [{ symbol: "BTCUSDT", status: "TRADING",
        baseAsset: "BTC", baseAssetPrecision: 8, quoteAsset: "USDT", quoteAssetPrecision: 8,
        tickSize: "0.1", stepSize: "0.001", minTradeAmount: "0.001" }] }),
      ok([[NOW - 120_000, "59900", "60100", "59800", "60000", "10", NOW - 60_001, "600000", 10, "5", "300000"],
        [NOW - 60_000, "60000", "60100", "59900", "60050", "12", NOW - 1, "720600", 12, "6", "360300"]]),
    ]);
    const market = new MarketStreamState(), clock = new ClockFreshnessGuard(), instruments = new InstrumentRuleState();
    const service = new PublicMarketService({ market, clock, instruments, transport, now: () => NOW });
    const snapshot = await service.collect({ market: "spot", symbol: "BTCUSDT", timeframe: "1m" });
    expect(snapshot).toMatchObject({ rules: { tickSize: "0.1", stepSize: "0.001" }, collectedAt: NOW });
    expect(snapshot.candles).toHaveLength(2);
    expect(market.requireFresh("spot", "BTCUSDT", NOW, 60_000)).toMatchObject({ last: "60050", exchangeTimestamp: NOW - 1 });
    expect(clock.requireFresh(NOW)).toMatchObject({ driftMs: 0 });
    expect(instruments.requireFresh("spot", "BTCUSDT", NOW)).toMatchObject({ minimumQuantity: "0.001" });
    expect(transport.requests).toHaveLength(3);
  });

  it("fails closed when server time or completed candles cannot be proven", async () => {
    const state = () => ({ market: new MarketStreamState(), clock: new ClockFreshnessGuard(), instruments: new InstrumentRuleState() });
    const missingDate = state();
    await expect(new PublicMarketService({ ...missingDate, transport: new Transport([ok({ symbol: "BTCUSDT", price: "1" })]), now: () => NOW })
      .collect({ market: "spot", symbol: "BTCUSDT", timeframe: "1m" })).rejects.toThrow(/clock evidence/i);
  });
});
