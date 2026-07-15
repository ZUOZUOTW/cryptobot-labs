import type { InstrumentRules } from "@cryptobot-labs/trading-core";
import type { HttpRequest, HttpResponse, HttpTransport } from "@cryptobot-labs/weex-client";
import { describe, expect, it } from "vitest";

import { createVaultWeexExecutionClient } from "../src/main/vault-weex-execution-client";

const NOW = 1_700_000_000_000;
const response = (body: unknown, headers: Record<string, string> = {}): HttpResponse => ({ status: 200, headers, body });

class Transport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: HttpResponse[]) {}
  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const next = this.responses.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  }
}

const rules: InstrumentRules = {
  market: "futures", symbol: "BTCSUSDT", baseAsset: "BTC", quoteAsset: "SUSDT",
  tickSize: "0.1", stepSize: "0.001", minimumQuantity: "0.001", maximumLeverage: "100",
};
const target = { market: "futures" as const, mode: "futures-demo" as const };

describe("vault WEEX execution client", () => {
  it("keeps credentials isolated while verifying and submitting a Demo market order", async () => {
    const balances = [{ asset: "SUSDT", balance: "5000", availableBalance: "5000", frozen: "0", unrealizePnl: "0" }];
    const transport = new Transport([
      response({ symbol: "BTCUSDT", price: "50000" }, { date: new Date(NOW).toUTCString() }),
      response(balances),
      response({ orderId: "demo-42", clientOrderId: "demo-client-1", success: true, errorCode: "", errorMessage: "" }),
    ]);
    const vault = { withCredentials: async <T>(operation: (value: Readonly<{
      apiKey: string; secretKey: string; passphrase: string;
    }>) => T | Promise<T>) => operation({ apiKey: "api-key", secretKey: "secret-key", passphrase: "passphrase" }) };
    const client = createVaultWeexExecutionClient({ vault, transport, now: () => NOW,
      rulesProvider: async () => ({ rules, verifiedAt: NOW }) });

    await expect(client.submitOrder({ target, clientOrderId: "demo-client-1", intent: {
      symbol: "BTCSUSDT", side: "buy", quantity: "0.001", price: "50000",
      expectedSlippageBps: "2", reduceOnly: false,
    } })).resolves.toEqual({ status: "acknowledged", exchangeOrderId: "demo-42" });
    expect(transport.requests.map(({ url }) => url)).toEqual([
      "https://api-spot.weex.com/api/v3/market/ticker/price?symbol=BTCUSDT",
      "https://api-contract.weex.com/capi/v3/sim/balance",
      "https://api-contract.weex.com/capi/v3/sim/order",
    ]);
    expect(JSON.parse(transport.requests[2]?.body ?? "{}")).toMatchObject({ type: "MARKET", symbol: "BTCSUSDT" });
  });

  it("rejects unsupported Demo cancellation before reading credentials or contacting WEEX", async () => {
    let credentialReads = 0;
    const transport = new Transport([]);
    const client = createVaultWeexExecutionClient({
      vault: { withCredentials: async () => { credentialReads += 1; throw new Error("must not read credentials"); } },
      transport, now: () => NOW, rulesProvider: async () => ({ rules, verifiedAt: NOW }),
    });
    await expect(client.cancelOrder({ target, symbol: "BTCSUSDT", clientOrderId: "demo-client-1" }))
      .resolves.toEqual({ status: "rejected", reason: "unsupported-demo-cancel" });
    expect(credentialReads).toBe(0);
    expect(transport.requests).toHaveLength(0);
  });
});
