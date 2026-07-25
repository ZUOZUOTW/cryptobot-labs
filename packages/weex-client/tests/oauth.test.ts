import { createHmac, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  buildWeexAuthorizationUrl,
  buildWeexOAuthSignaturePayload,
  createWeexOAuthTransaction,
  signWeexOAuthRequest,
  WeexOAuthClient,
  WeexOAuthClientCredentials,
  WeexOAuthError,
  type WeexOAuthTransport,
} from "../src/oauth";

const fixedCrypto = {
  subtle: webcrypto.subtle,
  getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    if (array instanceof Uint8Array) array.fill(7);
    return array;
  },
} as Pick<Crypto, "getRandomValues" | "subtle">;

describe("WEEX broker OAuth", () => {
  it("creates backend-only state and PKCE values with their state hash", async () => {
    const transaction = await createWeexOAuthTransaction(fixedCrypto);
    expect(transaction.state).toHaveLength(43);
    expect(transaction.stateHash).toHaveLength(43);
    expect(transaction.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(transaction.codeChallenge).toHaveLength(43);
    expect(transaction).toEqual(Object.freeze(transaction));
  });

  it("constructs the documented authorization URL without leaking the verifier", async () => {
    const transaction = await createWeexOAuthTransaction(fixedCrypto);
    const url = new URL(buildWeexAuthorizationUrl({ clientId: "client-123",
      redirectUri: "https://api.example.com/oauth/weex/callback", state: transaction.state,
      codeChallenge: transaction.codeChallenge }));
    expect(url.origin + url.pathname).toBe("https://www.weex.com/oauth");
    expect(Object.fromEntries(url.searchParams)).toEqual({ clientId: "client-123", responseType: "code",
      scope: "create:apikey", redirectUri: "https://api.example.com/oauth/weex/callback", state: transaction.state,
      codeChallenge: transaction.codeChallenge, codeChallengeMethod: "S256" });
    expect(url.toString()).not.toContain(transaction.codeVerifier);
  });

  it("signs the exact body with standard Base64 HMAC-SHA256", async () => {
    const body = "{\"grantType\":\"authorization_code\",\"code\":\"code123\",\"redirectUri\":\"https://client.example.com/callback\",\"codeVerifier\":\"verifier123\"}";
    const payload = buildWeexOAuthSignaturePayload({ timestamp: "1710000000000", nonce: "abc123xyz0000000",
      method: "post", requestPath: "/v1/oauth/token", body });
    expect(payload).toBe(`1710000000000abc123xyz0000000POST/v1/oauth/token${body}`);
    await expect(signWeexOAuthRequest("client-secret", payload, webcrypto.subtle)).resolves.toBe(
      createHmac("sha256", "client-secret").update(payload).digest("base64"));
  });

  it("uses a signed exact token body and keeps secrets out of enumerable state", async () => {
    const requests: Parameters<WeexOAuthTransport>[0][] = [];
    const transport: WeexOAuthTransport = async (request) => {
      requests.push(request);
      return { status: 200, body: { code: "00000", data: { accessToken: "access", refreshToken: "refresh",
        tokenType: "Bearer", expiresIn: 3600, refreshExpiresIn: 36000, scope: "create:apikey" } } };
    };
    const credentials = new WeexOAuthClientCredentials("client-id", "client-secret");
    expect(JSON.stringify(credentials)).not.toContain("client-secret");
    const client = new WeexOAuthClient({ credentials, transport, now: () => 1_710_000_000_000,
      crypto: fixedCrypto });
    await expect(client.exchangeAuthorizationCode({ code: "authorization-code",
      redirectUri: "https://api.example.com/oauth/weex/callback", codeVerifier: "a".repeat(64) })).resolves.toEqual({
        accessToken: "access", refreshToken: "refresh", expiresIn: 3600, refreshExpiresIn: 36000,
        scope: "create:apikey",
      });
    expect(requests[0]).toMatchObject({ url: "https://gateway.weex.com/v1/oauth/token", method: "POST",
      body: "{\"grantType\":\"authorization_code\",\"code\":\"authorization-code\",\"redirectUri\":\"https://api.example.com/oauth/weex/callback\",\"codeVerifier\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"" + "}" });
    expect(requests[0]?.headers).toMatchObject({ "Client-Id": "client-id", Timestamp: "1710000000000",
      "Content-Type": "application/json" });
    expect(requests[0]?.headers.Sign).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("fetches API credentials once through Bearer auth and rejects malformed success responses", async () => {
    const transport = vi.fn<WeexOAuthTransport>(async () => ({ status: 200, body: { code: "00000",
      data: { apiKey: "api", secret: "secret", passphrase: "pass" } } }));
    const client = new WeexOAuthClient({ credentials: new WeexOAuthClientCredentials("id", "secret"), transport });
    await expect(client.createApiCredentials("access-token")).resolves.toEqual({ apiKey: "api", secret: "secret",
      passphrase: "pass" });
    expect(transport).toHaveBeenCalledWith({ url: "https://gateway.weex.com/v1/oauth/resource/create-api",
      method: "POST", headers: { Authorization: "Bearer access-token", Accept: "application/json" } });
    transport.mockResolvedValueOnce({ status: 200, body: { code: "00000", data: { apiKey: "api" } } });
    await expect(client.createApiCredentials("access-token")).rejects.toBeInstanceOf(WeexOAuthError);
  });

  it("rejects insecure redirect URIs before transport", async () => {
    const transport = vi.fn<WeexOAuthTransport>();
    const client = new WeexOAuthClient({ credentials: new WeexOAuthClientCredentials("id", "secret"), transport });
    await expect(client.exchangeAuthorizationCode({ code: "code", redirectUri: "http://example.com/callback",
      codeVerifier: "a".repeat(64) })).rejects.toMatchObject({ code: "invalid_redirect" });
    expect(transport).not.toHaveBeenCalled();
  });
});
