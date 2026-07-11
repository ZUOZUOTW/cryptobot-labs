import { describe, expect, it, vi } from "vitest";
import type { ApiAuthDependencies } from "../lib/server/auth";
import {
  createBootstrapCompleteHandler,
  createConsumePairingCodeHandler,
  createDeleteDeviceHandler,
  createIssuePairingCodeHandler,
} from "../lib/server/pairing-routes";
import { PairingError } from "../lib/server/pairing";

const originPolicy = { publicOrigin: "https://app.example.test" };
const user = { id: "usr_a", normalizedEmail: "a@example.test", displayName: "A", createdAt: 1, updatedAt: 1 };
const auth = (identity = true): ApiAuthDependencies => ({
  identityProvider: { getIdentity: async () => identity ? ({ email: "a@example.test", displayName: "A" }) : null },
  userRepository: { upsertIdentity: vi.fn(async () => user) },
  deriveUserId: async () => "usr_a",
  now: () => 10,
});
const browserRequest = (path: string, method: string, body?: string, headers: Record<string, string> = {}) =>
  new Request(`https://app.example.test${path}`, {
    method,
    headers: { host: "app.example.test", origin: "https://app.example.test", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body }),
  });
const agentRequest = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`https://app.example.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
const canonicalX = btoa(String.fromCharCode(...new Uint8Array(32).fill(7))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwk = { kty: "OKP", crv: "Ed25519", x: canonicalX, ext: true, key_ops: ["verify"] };

describe("pairing browser routes", () => {
  it("requires platform identity, configured same-origin, strict empty JSON, and returns a one-time no-store code", async () => {
    const issuedCode = `CBL-${"A".repeat(22)}`;
    const issueCode = vi.fn(async () => ({ code: issuedCode, expiresAt: 300_010 }));
    const handler = createIssuePairingCodeHandler({ auth: auth(), originPolicy, pairingService: { issueCode }, now: () => 10 });
    const missing = createIssuePairingCodeHandler({ auth: auth(false), originPolicy, pairingService: { issueCode }, now: () => 10 });
    expect((await missing(browserRequest("/api/pairing-codes", "POST", "{}"))).status).toBe(401);
    expect((await handler(browserRequest("/api/pairing-codes", "POST", "{}", { origin: "https://evil.test" }))).status).toBe(403);
    expect((await handler(browserRequest("/api/pairing-codes", "POST", "{}", { host: "evil.test" }))).status).toBe(403);
    expect((await handler(browserRequest("/api/pairing-codes", "POST", '{"unexpected":1}'))).status).toBe(400);
    expect((await handler(browserRequest("/api/pairing-codes", "POST", JSON.stringify({ padding: "x".repeat(2_000) })))).status).toBe(413);
    const response = await handler(browserRequest("/api/pairing-codes", "POST", "{}"));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ code: issuedCode, expiresAt: 300_010 });
    expect(issueCode).toHaveBeenCalledWith({ userId: "usr_a", now: 10 });
  });

  it("revokes an owned device and credential atomically through the scoped repository without remote erase commands", async () => {
    const revoke = vi.fn(async (owner: string, id: string, now: number) => owner === "usr_a" && id === "dev_owned"
      ? { id, userId: owner, status: "revoked", revokedAt: now } : null);
    const handler = createDeleteDeviceHandler({ auth: auth(), originPolicy, deviceRepository: { revoke }, now: () => 99 });
    const response = await handler(browserRequest("/api/devices/dev_owned", "DELETE"), { params: Promise.resolve({ id: "dev_owned" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ device: { id: "dev_owned", status: "revoked", revokedAt: 99 } });
    expect(revoke).toHaveBeenCalledWith("usr_a", "dev_owned", 99);
    expect((await handler(browserRequest("/api/devices/dev_owned", "DELETE"), { params: { id: "dev_owned" } })).status).toBe(200);
    expect((await handler(browserRequest("/api/devices/dev_other", "DELETE"), { params: { id: "dev_other" } })).status).toBe(404);
    expect((await handler(browserRequest("/api/devices/bad%20id", "DELETE"), { params: { id: "bad id" } })).status).toBe(400);
    expect((await handler(browserRequest("/api/devices/dev_owned", "DELETE", "{}"), { params: { id: "dev_owned" } })).status).toBe(400);
  });
});

describe("pairing agent routes", () => {
  it("strictly consumes a code without identity and never exposes stored hashes", async () => {
    const bootstrapToken = `bst_${"A".repeat(22)}`;
    const challenge = `chl_${"A".repeat(43)}`;
    const consumeCode = vi.fn(async () => ({ deviceId: "dev_new", bootstrapToken, challenge,
      expiresAt: 61_000, bootstrapTokenHash: "MUST_NOT_LEAK" }));
    const handler = createConsumePairingCodeHandler({ pairingService: { consumeCode }, now: () => 1_000 });
    const body = JSON.stringify({ code: "CBL-AAAAAAAAAAAAAAAAAAAAAA", name: "My Mac", platform: "macos", publicKeyJwk: jwk });
    const response = await handler(agentRequest("/api/agent/pairings/consume", body));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ deviceId: "dev_new", bootstrapToken, challenge, expiresAt: 61_000 });
    expect(JSON.stringify(consumeCode.mock.calls)).not.toContain("Hash");
    expect((await handler(agentRequest("/api/agent/pairings/consume", JSON.stringify({ ...JSON.parse(body), extra: true })))).status).toBe(400);
    expect((await handler(agentRequest("/api/agent/pairings/consume", JSON.stringify({ ...JSON.parse(body), publicKeyJwk: { ...jwk, d: "private" } })))).status).toBe(400);
    expect((await handler(agentRequest("/api/agent/pairings/consume", JSON.stringify({ padding: "x".repeat(9_000) })))).status).toBe(413);
  });

  it("maps invalid and replayed codes to the same generic response and hides database failures", async () => {
    const pairingFailure = createConsumePairingCodeHandler({ pairingService: { consumeCode: vi.fn(async () => { throw new PairingError(); }) }, now: () => 1 });
    const valid = JSON.stringify({ code: "CBL-AAAAAAAAAAAAAAAAAAAAAA", name: "Mac", platform: "macos", publicKeyJwk: jwk });
    const malformed = JSON.stringify({ code: "not-a-code", name: "Mac", platform: "macos", publicKeyJwk: jwk });
    const one = await pairingFailure(agentRequest("/api/agent/pairings/consume", valid));
    const two = await pairingFailure(agentRequest("/api/agent/pairings/consume", malformed));
    expect([one.status, await one.text()]).toEqual([two.status, await two.text()]);
    const broken = createConsumePairingCodeHandler({ pairingService: { consumeCode: vi.fn(async () => { throw new Error("code_hash=SECRET"); }) }, now: () => 1 });
    const response = await broken(agentRequest("/api/agent/pairings/consume", valid));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("SECRET");
  });

  it("passes canonical bootstrap proof fields and returns a credential once with generic retry failure", async () => {
    const credential = `cred_${"A".repeat(43)}`;
    const completeActivation = vi.fn(async () => ({ credential, expiresAt: 123_456 }));
    const handler = createBootstrapCompleteHandler({ pairingService: { completeActivation }, now: () => 2 });
    const input = { deviceId: "dev_new", bootstrapToken: "bst_AAAAAAAAAAAAAAAAAAAAAA", challenge: `chl_${"A".repeat(43)}`, signature: "A".repeat(86) };
    const response = await handler(agentRequest("/api/agent/bootstrap/complete", JSON.stringify(input)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ deviceId: "dev_new", credential, expiresAt: 123_456 });
    expect(completeActivation).toHaveBeenCalledWith({ deviceId: "dev_new", bootstrapToken: input.bootstrapToken,
      challenge: input.challenge, proof: { signature: input.signature }, now: 2 });
    const replay = createBootstrapCompleteHandler({ pairingService: { completeActivation: vi.fn(async () => { throw new PairingError(); }) }, now: () => 3 });
    const retry = await replay(agentRequest("/api/agent/bootstrap/complete", JSON.stringify(input)));
    expect(retry.status).toBe(401);
    expect(await retry.json()).toMatchObject({ error: { code: "pairing_failed" } });
    expect((await handler(agentRequest("/api/agent/bootstrap/complete", JSON.stringify({ ...input, unknown: true })))).status).toBe(400);
  });
});
