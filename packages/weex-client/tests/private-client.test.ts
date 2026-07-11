import type {
  ExchangeSubmitRequest,
  InstrumentRules,
} from "@cryptobot-labs/trading-core";
import { describe, expect, it, vi } from "vitest";

import { WeexApiError } from "../src/errors";
import {
  WeexCredentials,
  WeexPrivateClient,
  type InstrumentRulesProvider,
} from "../src/private-client";
import type { HttpRequest, HttpResponse, HttpTransport } from "../src/transport";

class ScriptedTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly steps: Array<HttpResponse | Error>) {}
  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const step = this.steps.shift();
    if (!step) throw new Error("unexpected request");
    if (step instanceof Error) throw step;
    return step;
  }
}

const ok = (body: unknown): HttpResponse => ({ status: 200, headers: {}, body });
const clock = {
  now: () => 1_700_000_000_000,
  assertPrivateRequestWindow: vi.fn(),
};
const credentials = new WeexCredentials("api-key", "secret", "passphrase");
const rules: InstrumentRules = {
  market: "spot", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
  tickSize: "0.1", stepSize: "0.001", minimumQuantity: "0.001",
};
const rulesProvider: InstrumentRulesProvider = async () => ({ rules, verifiedAt: 1_700_000_000_000 });
const request: ExchangeSubmitRequest = {
  target: { market: "spot", mode: "live" },
  clientOrderId: "cbl-1",
  intent: {
    symbol: "BTCUSDT", side: "buy", quantity: "0.001", price: "30000.1",
    expectedSlippageBps: "1", reduceOnly: false,
  },
};

describe("WeexPrivateClient", () => {
  it("signs and transmits the exact canonical spot body", async () => {
    const transport = new ScriptedTransport([ok({ orderId: "42", clientOrderId: "cbl-1" })]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await expect(client.submitOrder(request)).resolves.toEqual({ status: "acknowledged", exchangeOrderId: "42" });
    expect(transport.requests[0]).toMatchObject({
      method: "POST",
      url: "https://api-spot.weex.com/api/v3/order",
      body: '{"newClientOrderId":"cbl-1","price":"30000.1","quantity":"0.001","side":"BUY","symbol":"BTCUSDT","timeInForce":"GTC","type":"LIMIT"}',
    });
    expect(transport.requests[0]?.headers).toMatchObject({
      "ACCESS-KEY": "api-key", "ACCESS-PASSPHRASE": "passphrase",
      "ACCESS-TIMESTAMP": "1700000000000",
    });
    expect(clock.assertPrivateRequestWindow).toHaveBeenCalledWith(1_700_000_000_000);
  });

  it("does not resubmit after an ambiguous POST timeout", async () => {
    const transport = new ScriptedTransport([
      new WeexApiError("timeout after send", { category: "network", retryable: true }),
      ok({ orderId: "late", clientOrderId: "cbl-1" }),
    ]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await expect(client.submitOrder(request)).resolves.toMatchObject({ status: "unknown" });
    expect(transport.requests.filter(({ method }) => method === "POST")).toHaveLength(1);
  });

  it("uses the documented futures demo route and derives positionSide", async () => {
    const futuresRules: InstrumentRules = { ...rules, market: "futures", maximumLeverage: "100" };
    const transport = new ScriptedTransport([ok({ orderId: "43", clientOrderId: "cbl-2" })]);
    const client = new WeexPrivateClient({
      transport, credentials, clock,
      rulesProvider: async () => ({ rules: futuresRules, verifiedAt: 1_700_000_000_000 }),
    });
    await client.submitOrder({
      ...request,
      target: { market: "futures", mode: "futures-demo" },
      clientOrderId: "cbl-2",
      intent: { ...request.intent, side: "sell" },
    });
    expect(transport.requests[0]?.url).toBe("https://api-contract.weex.com/capi/v3/sim/order");
    expect(JSON.parse(transport.requests[0]?.body ?? "{}")).toMatchObject({ positionSide: "SHORT", side: "SELL" });
  });

  it("retries only safe GET failures with injected bounded backoff", async () => {
    const scheduler = vi.fn(async () => undefined);
    const transport = new ScriptedTransport([
      new WeexApiError("busy", { category: "server", retryable: true }),
      ok({ canTrade: true, canWithdraw: false, balances: [] }),
    ]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider, scheduler });
    await expect(client.verifyAccount({ market: "spot", mode: "live" })).resolves.toMatchObject({
      market: "spot", mode: "live", withdrawalPermission: "absent",
    });
    expect(transport.requests).toHaveLength(2);
    expect(scheduler).toHaveBeenCalledTimes(1);
  });

  it("never sends an undocumented demo cancellation request", async () => {
    const transport = new ScriptedTransport([]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await expect(client.cancelOrder({
      target: { market: "futures", mode: "futures-demo" }, symbol: "BTCUSDT", clientOrderId: "cbl-1",
    })).resolves.toEqual({ status: "rejected", reason: "unsupported-demo-cancel" });
    expect(transport.requests).toHaveLength(0);
  });

  it("looks up a spot order directly and validates its full remembered identity", async () => {
    const transport = new ScriptedTransport([
      ok({ orderId: "42", clientOrderId: "cbl-1" }),
      ok({
        orderId: "42", clientOrderId: "cbl-1", symbol: "BTCUSDT", side: "BUY",
        origQty: "0.001", executedQty: "0.0005", avgPrice: "30000.1", status: "PARTIALLY_FILLED",
      }),
    ]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await client.submitOrder(request);
    await expect(client.findOrderByClientOrderId({
      target: request.target, symbol: "BTCUSDT", clientOrderId: "cbl-1",
    })).resolves.toMatchObject({ status: "PARTIALLY_FILLED", side: "buy", quantity: "0.001" });
    expect(transport.requests[1]?.url).toBe(
      "https://api-spot.weex.com/api/v3/order?origClientOrderId=cbl-1",
    );
  });

  it("searches bounded futures open orders and then history by exact client id", async () => {
    const futuresRules: InstrumentRules = { ...rules, market: "futures", maximumLeverage: "100" };
    const transport = new ScriptedTransport([
      ok([]),
      ok([{ orderId: 9, clientOrderId: "target", symbol: "BTCUSDT", side: "SELL", origQty: "1", executedQty: "1", status: "FILLED" }]),
    ]);
    const client = new WeexPrivateClient({
      transport, credentials, clock,
      rulesProvider: async () => ({ rules: futuresRules, verifiedAt: 1_700_000_000_000 }),
    });
    await expect(client.findOrderByClientOrderId({
      target: { market: "futures", mode: "live" }, symbol: "BTCUSDT", clientOrderId: "target",
    })).resolves.toMatchObject({ exchangeOrderId: "9", status: "FILLED" });
    expect(transport.requests.map(({ url }) => url)).toEqual([
      "https://api-contract.weex.com/capi/v3/openOrders?limit=100&page=0&symbol=BTCUSDT",
      "https://api-contract.weex.com/capi/v3/order/history?limit=100&page=0&symbol=BTCUSDT",
    ]);
  });

  it("paginates futures searches explicitly and stops each route on a short page", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ clientOrderId: `other-${index}` }));
    const transport = new ScriptedTransport([ok(fullPage), ok([]), ok([])]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await expect(client.findOrderByClientOrderId({
      target: { market: "futures", mode: "live" }, symbol: "BTCUSDT", clientOrderId: "missing",
    })).resolves.toBeNull();
    expect(transport.requests.map(({ url }) => url)).toEqual([
      "https://api-contract.weex.com/capi/v3/openOrders?limit=100&page=0&symbol=BTCUSDT",
      "https://api-contract.weex.com/capi/v3/openOrders?limit=100&page=1&symbol=BTCUSDT",
      "https://api-contract.weex.com/capi/v3/order/history?limit=100&page=0&symbol=BTCUSDT",
    ]);
  });

  it("fails closed when an exact futures client id appears more than once", async () => {
    const duplicate = { orderId: "8", clientOrderId: "duplicate", symbol: "BTCUSDT", side: "BUY", origQty: "1", status: "NEW" };
    const transport = new ScriptedTransport([ok([duplicate]), ok([{ ...duplicate, orderId: "9" }])]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await expect(client.findOrderByClientOrderId({
      target: { market: "futures", mode: "live" }, symbol: "BTCUSDT", clientOrderId: "duplicate",
    })).rejects.toMatchObject({ category: "schema" });
  });

  it("accepts a risk-approved spot exit while omitting unsupported reduceOnly", async () => {
    const transport = new ScriptedTransport([ok({ orderId: "44", clientOrderId: "spot-exit" })]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await expect(client.submitOrder({
      ...request,
      clientOrderId: "spot-exit",
      intent: { ...request.intent, side: "sell", reduceOnly: true },
    })).resolves.toMatchObject({ status: "acknowledged" });
    expect(JSON.parse(transport.requests[0]?.body ?? "{}")).toEqual({
      newClientOrderId: "spot-exit", price: "30000.1", quantity: "0.001",
      side: "SELL", symbol: "BTCUSDT", timeInForce: "GTC", type: "LIMIT",
    });
  });

  it("verifies live futures balance and hedge-mode account config before submitting", async () => {
    const futuresRules: InstrumentRules = { ...rules, market: "futures", maximumLeverage: "100" };
    const transport = new ScriptedTransport([
      ok([{ asset: "USDT", balance: "100", availableBalance: "90", frozen: "10", unrealizePnl: "-1" }]),
      ok({ canTrade: true, canDeposit: true, canWithdraw: false, dualSidePosition: true, updateTime: 1_700_000_000_000 }),
      ok({ orderId: "45", clientOrderId: "future-1" }),
    ]);
    const client = new WeexPrivateClient({
      transport, credentials, clock,
      rulesProvider: async () => ({ rules: futuresRules, verifiedAt: 1_700_000_000_000 }),
    });
    await expect(client.verifyAccount({ market: "futures", mode: "live" })).resolves.toMatchObject({
      canTrade: true, withdrawalPermission: "absent", positionMode: "hedge", balanceAssetCount: 1,
    });
    await expect(client.submitOrder({
      ...request, target: { market: "futures", mode: "live" }, clientOrderId: "future-1",
    })).resolves.toMatchObject({ status: "acknowledged" });
    expect(transport.requests.map(({ url }) => url)).toEqual([
      "https://api-contract.weex.com/capi/v3/account/balance",
      "https://api-contract.weex.com/capi/v3/account/accountConfig",
      "https://api-contract.weex.com/capi/v3/order",
    ]);
  });

  it("fails closed before live futures submit when account config is one-way", async () => {
    const futuresRules: InstrumentRules = { ...rules, market: "futures", maximumLeverage: "100" };
    const transport = new ScriptedTransport([
      ok([{ asset: "USDT", balance: "100", availableBalance: "90", frozen: "10", unrealizePnl: "0" }]),
      ok({ canTrade: true, canDeposit: true, canWithdraw: false, dualSidePosition: false, updateTime: 1_700_000_000_000 }),
    ]);
    const client = new WeexPrivateClient({
      transport, credentials, clock,
      rulesProvider: async () => ({ rules: futuresRules, verifiedAt: 1_700_000_000_000 }),
    });
    await expect(client.verifyAccount({ market: "futures", mode: "live" })).resolves.toMatchObject({ positionMode: "one-way" });
    await expect(client.submitOrder({
      ...request, target: { market: "futures", mode: "live" }, clientOrderId: "future-1",
    })).rejects.toMatchObject({ category: "validation" });
    expect(transport.requests).toHaveLength(2);
  });

  it("uses direct futures orderId lookup and validates the returned exchange id", async () => {
    const transport = new ScriptedTransport([ok({
      orderId: "91", clientOrderId: "direct-1", symbol: "BTCUSDT", side: "BUY",
      origQty: "1", executedQty: "0", status: "NEW",
    })]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await expect(client.findOrderByClientOrderId({
      target: { market: "futures", mode: "live" }, symbol: "BTCUSDT",
      clientOrderId: "direct-1", exchangeOrderId: "91",
    })).resolves.toMatchObject({ exchangeOrderId: "91" });
    expect(transport.requests[0]?.url).toBe("https://api-contract.weex.com/capi/v3/order?orderId=91");
  });

  it("uses target-specific exact cancellation queries and requires spot CANCELED", async () => {
    const transport = new ScriptedTransport([
      ok({ orderId: "51", origClientOrderId: "cancel-spot", symbol: "BTCUSDT", status: "CANCELED" }),
      ok({ orderId: "52", clientOrderId: "cancel-future" }),
    ]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await expect(client.cancelOrder({
      target: { market: "spot", mode: "live" }, symbol: "BTCUSDT", clientOrderId: "cancel-spot",
    })).resolves.toEqual({ status: "cancelled" });
    await expect(client.cancelOrder({
      target: { market: "futures", mode: "live" }, symbol: "BTCUSDT", clientOrderId: "cancel-future", exchangeOrderId: "52",
    })).resolves.toEqual({ status: "cancelled" });
    expect(transport.requests.map(({ url }) => url)).toEqual([
      "https://api-spot.weex.com/api/v3/order?origClientOrderId=cancel-spot&symbol=BTCUSDT",
      "https://api-contract.weex.com/capi/v3/order?orderId=52",
    ]);
  });

  it("uses one signed live DELETE and maps malformed cancellation acknowledgement to unknown", async () => {
    const transport = new ScriptedTransport([ok({ unexpected: true })]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await expect(client.cancelOrder({
      target: { market: "spot", mode: "live" }, symbol: "BTCUSDT", clientOrderId: "cbl-1",
    })).resolves.toEqual({ status: "unknown", reason: "ambiguous-cancel-outcome" });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({ method: "DELETE" });
  });

  it("does not retry authentication failures or send when the private clock preflight fails", async () => {
    const authTransport = new ScriptedTransport([
      new WeexApiError("bad key", { category: "authentication", retryable: false }),
      ok({ canTrade: true, canWithdraw: false, balances: [] }),
    ]);
    const authClient = new WeexPrivateClient({ transport: authTransport, credentials, clock, rulesProvider });
    await expect(authClient.verifyAccount({ market: "spot", mode: "live" }))
      .rejects.toMatchObject({ category: "authentication" });
    expect(authTransport.requests).toHaveLength(1);

    const preflightTransport = new ScriptedTransport([]);
    const preflightClock = {
      now: () => 1_700_000_000_000,
      assertPrivateRequestWindow: () => { throw new WeexApiError("stale", { category: "clock", retryable: false }); },
    };
    const preflightClient = new WeexPrivateClient({
      transport: preflightTransport, credentials, clock: preflightClock, rulesProvider,
    });
    await expect(preflightClient.submitOrder(request)).rejects.toMatchObject({ category: "clock" });
    expect(preflightTransport.requests).toHaveLength(0);
  });

  it("fails closed on stale rules and malformed account schemas before trading", async () => {
    const transport = new ScriptedTransport([ok({ canTrade: true, canWithdraw: false, balances: [{}] })]);
    const client = new WeexPrivateClient({
      transport, credentials, clock,
      rulesProvider: async () => ({ rules, verifiedAt: 1_699_999_000_000 }),
    });
    await expect(client.submitOrder(request)).rejects.toMatchObject({ category: "validation" });
    expect(transport.requests).toHaveLength(0);
    await expect(client.verifyAccount({ market: "spot", mode: "live" })).rejects.toMatchObject({ category: "schema" });
  });

  it("keeps demo account permissions and position mode unknown with strict signed PnL", async () => {
    const transport = new ScriptedTransport([
      ok([{ asset: "USDT", balance: "10", availableBalance: "9", frozen: "1", unrealizePnl: "-0.5" }]),
    ]);
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await expect(client.verifyAccount({ market: "futures", mode: "futures-demo" })).resolves.toMatchObject({
      canTrade: "unknown", withdrawalPermission: "unknown", positionMode: "unknown",
    });
    expect(transport.requests[0]?.url).toBe("https://api-contract.weex.com/capi/v3/sim/balance");
  });

  it("enforces the official futures client id length before transport", async () => {
    const futuresRules: InstrumentRules = { ...rules, market: "futures", maximumLeverage: "100" };
    const transport = new ScriptedTransport([]);
    const client = new WeexPrivateClient({
      transport, credentials, clock,
      rulesProvider: async () => ({ rules: futuresRules, verifiedAt: 1_700_000_000_000 }),
    });
    await expect(client.submitOrder({
      ...request, target: { market: "futures", mode: "futures-demo" }, clientOrderId: "x".repeat(37),
    })).rejects.toMatchObject({ category: "validation" });
    expect(transport.requests).toHaveLength(0);
  });

  it("hard-stops a full zero-based futures search after pages 0 through 9", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ clientOrderId: `other-${index}` }));
    const transport = new ScriptedTransport(Array.from({ length: 10 }, () => ok(fullPage)));
    const client = new WeexPrivateClient({ transport, credentials, clock, rulesProvider });
    await expect(client.findOrderByClientOrderId({
      target: { market: "futures", mode: "live" }, symbol: "BTCUSDT", clientOrderId: "missing",
    })).rejects.toMatchObject({ category: "schema" });
    expect(transport.requests).toHaveLength(10);
    expect(transport.requests[0]?.url).toContain("page=0");
    expect(transport.requests[9]?.url).toContain("page=9");
  });

  it("revokes a previous futures gate before a failed account re-verification", async () => {
    const futuresRules: InstrumentRules = { ...rules, market: "futures", maximumLeverage: "100" };
    const transport = new ScriptedTransport([
      ok([{ asset: "USDT", balance: "100", availableBalance: "90", frozen: "10", unrealizePnl: "0" }]),
      ok({ canTrade: true, canDeposit: true, canWithdraw: false, dualSidePosition: true, updateTime: 1_700_000_000_000 }),
      new WeexApiError("revoked", { category: "authentication", retryable: false }),
    ]);
    const client = new WeexPrivateClient({
      transport, credentials, clock,
      rulesProvider: async () => ({ rules: futuresRules, verifiedAt: 1_700_000_000_000 }),
    });
    await client.verifyAccount({ market: "futures", mode: "live" });
    await expect(client.verifyAccount({ market: "futures", mode: "live" })).rejects.toMatchObject({ category: "authentication" });
    const countBeforeSubmit = transport.requests.length;
    await expect(client.submitOrder({
      ...request, target: { market: "futures", mode: "live" }, clientOrderId: "future-after-failure",
    })).rejects.toMatchObject({ category: "validation" });
    expect(transport.requests).toHaveLength(countBeforeSubmit);
  });

  it("requires bounded frozen balance and exact cancellation identifier echoes", async () => {
    const malformedBalance = new ScriptedTransport([
      ok([{ asset: "USDT", balance: "10", availableBalance: "9", unrealizePnl: "0" }]),
    ]);
    const malformedClient = new WeexPrivateClient({ transport: malformedBalance, credentials, clock, rulesProvider });
    await expect(malformedClient.verifyAccount({ market: "futures", mode: "futures-demo" }))
      .rejects.toMatchObject({ category: "schema" });

    const cancelTransport = new ScriptedTransport([
      ok({ orderId: "arbitrary", status: "CANCELED", symbol: "BTCUSDT" }),
      ok({ success: true }),
    ]);
    const cancelClient = new WeexPrivateClient({ transport: cancelTransport, credentials, clock, rulesProvider });
    await expect(cancelClient.cancelOrder({
      target: { market: "spot", mode: "live" }, symbol: "BTCUSDT", clientOrderId: "client-cancel",
    })).resolves.toMatchObject({ status: "unknown" });
    await expect(cancelClient.cancelOrder({
      target: { market: "futures", mode: "live" }, symbol: "BTCUSDT",
      clientOrderId: "future-cancel", exchangeOrderId: "52",
    })).resolves.toMatchObject({ status: "unknown" });
  });

  it("does not serialize credentials", () => {
    expect(JSON.stringify(credentials)).toBe("{}" );
    expect(String(credentials)).not.toContain("secret");
  });
});
