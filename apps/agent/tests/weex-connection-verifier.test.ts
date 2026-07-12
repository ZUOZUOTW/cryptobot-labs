import type { HttpRequest, HttpResponse, HttpTransport } from "@cryptobot-labs/weex-client";
import { describe, expect, it } from "vitest";

import { createWeexConnectionVerifier } from "../src/main/weex-connection-verifier";

class ScriptedTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: HttpResponse[]) {}
  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("unexpected WEEX request");
    return response;
  }
}

const response = (body: unknown, headers: Record<string, string> = {}): HttpResponse => ({
  status: 200,
  headers,
  body,
});

const vault = {
  withCredentials: async <T>(consume: (value: Readonly<{
    apiKey: string; secretKey: string; passphrase: string;
  }>) => T | Promise<T>): Promise<T> => consume({
    apiKey: "local-api-key-1234",
    secretKey: "local-secret",
    passphrase: "local-passphrase",
  }),
};

function transport(canWithdraw = false): ScriptedTransport {
  return new ScriptedTransport([
    response({ symbol: "BTCUSDT", price: "60000.1" }, { date: new Date(1_700_000_000_000).toUTCString() }),
    response({ canTrade: true, canWithdraw: false, balances: [] }),
    response([]),
    response({ canTrade: true, canDeposit: true, canWithdraw, dualSidePosition: true, updateTime: 1_700_000_000_000 }),
  ]);
}

describe("WEEX connection verifier", () => {
  it("verifies spot and futures permissions while exposing metadata only", async () => {
    const http = transport();
    const verifier = createWeexConnectionVerifier({ vault, transport: http, now: () => 1_700_000_000_000 });

    const result = await verifier.verify();
    expect(result).toEqual({
      provider: "WEEX",
      apiKeySuffix: "1234",
      verifiedAt: "2023-11-14T22:13:20.000Z",
      permissions: { read: true, spotTrade: true, futuresTrade: true, withdrawal: false },
    });
    expect(http.requests.map(({ method, url }) => [method, url])).toEqual([
      ["GET", "https://api-spot.weex.com/api/v3/market/ticker/price?symbol=BTCUSDT"],
      ["GET", "https://api-spot.weex.com/api/v3/account"],
      ["GET", "https://api-contract.weex.com/capi/v3/account/balance"],
      ["GET", "https://api-contract.weex.com/capi/v3/account/accountConfig"],
    ]);
    expect(JSON.stringify(result)).not.toMatch(/local-secret|local-passphrase|local-api-key/i);
  });

  it("fails closed when withdrawal permission is present", async () => {
    const verifier = createWeexConnectionVerifier({
      vault,
      transport: transport(true),
      now: () => 1_700_000_000_000,
    });
    await expect(verifier.verify()).rejects.toThrow(/unsafe/i);
  });

  it("does not access credentials without trusted server-time evidence", async () => {
    let accessed = false;
    const verifier = createWeexConnectionVerifier({
      vault: { withCredentials: async () => { accessed = true; throw new Error("must not run"); } },
      transport: new ScriptedTransport([response({ symbol: "BTCUSDT", price: "60000.1" })]),
      now: () => 1_700_000_000_000,
    });
    await expect(verifier.verify()).rejects.toThrow(/server time/i);
    expect(accessed).toBe(false);
  });
});
