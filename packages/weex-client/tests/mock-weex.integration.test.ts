import type { InstrumentRules } from "@cryptobot-labs/trading-core";
import { describe, expect, it } from "vitest";

import { WeexCredentials, WeexPrivateClient } from "../src/private-client";
import type { HttpRequest, HttpResponse, HttpTransport } from "../src/transport";

class MockWeexTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: readonly HttpResponse[]) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const response = this.responses[this.requests.length - 1];
    if (!response) throw new Error("Unexpected mock WEEX request");
    return response;
  }
}

const ok = (body: unknown): HttpResponse => ({ status: 200, headers: {}, body });
const futuresRules: InstrumentRules = {
  market: "futures", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
  tickSize: "0.1", stepSize: "0.001", minimumQuantity: "0.001", maximumLeverage: "100",
};

describe("mock WEEX futures demo integration", () => {
  it("verifies, places, and reconciles exclusively through documented /capi/v3/sim routes", async () => {
    const transport = new MockWeexTransport([
      ok([{ asset: "USDT", balance: "1000", availableBalance: "1000", frozen: "0", unrealizePnl: "0" }]),
      ok({ orderId: "demo-42", clientOrderId: "demo-client-1" }),
      ok([{
        orderId: "demo-42", clientOrderId: "demo-client-1", symbol: "BTCUSDT", side: "BUY",
        origQty: "0.001", executedQty: "0.001", avgPrice: "30000.1", fee: "0.01", status: "FILLED",
      }]),
    ]);
    const clock = { now: () => 1_700_000_000_000, assertPrivateRequestWindow: () => undefined };
    const client = new WeexPrivateClient({
      transport,
      clock,
      credentials: new WeexCredentials("mock-key", "mock-secret", "mock-passphrase"),
      rulesProvider: async () => ({ rules: futuresRules, verifiedAt: clock.now() }),
      now: clock.now,
    });
    const target = { market: "futures" as const, mode: "futures-demo" as const };

    await expect(client.verifyAccount(target)).resolves.toMatchObject({
      market: "futures", mode: "futures-demo", readPermission: true,
    });
    await expect(client.submitOrder({
      target,
      clientOrderId: "demo-client-1",
      intent: {
        symbol: "BTCUSDT", side: "buy", quantity: "0.001", price: "30000.1",
        expectedSlippageBps: "2", reduceOnly: false,
      },
    })).resolves.toEqual({ status: "acknowledged", exchangeOrderId: "demo-42" });
    await expect(client.findOrderByClientOrderId({
      target, symbol: "BTCUSDT", clientOrderId: "demo-client-1",
    })).resolves.toMatchObject({ status: "FILLED", cumulativeFilledQuantity: "0.001" });

    expect(transport.requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "GET https://api-contract.weex.com/capi/v3/sim/balance",
      "POST https://api-contract.weex.com/capi/v3/sim/order",
      "GET https://api-contract.weex.com/capi/v3/sim/order/history?limit=100&page=0&symbol=BTCUSDT",
    ]);
    expect(transport.requests.every(({ headers }) =>
      headers["ACCESS-KEY"] === "mock-key" && Boolean(headers["ACCESS-SIGN"]))).toBe(true);
    expect(transport.requests.some(({ url }) => url.includes("/capi/v3/order") && !url.includes("/sim/"))).toBe(false);
  });
});
