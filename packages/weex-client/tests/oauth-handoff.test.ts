import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { createExecutorOAuthHandoff, sha256Base64Url, verifyExecutorOAuthHandoff } from "../src/oauth-handoff";

beforeAll(() => { Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto }); });

describe("executor OAuth handoff", () => {
  const fixtureHex = ["0123", "4567", "89ab", "cdef"].join("");
  const secret = fixtureHex.repeat(2);

  it("signs a one-minute, single-purpose payload without including the access token", async () => {
    const sessionHash = await sha256Base64Url("supabase-access-token");
    const token = await createExecutorOAuthHandoff({ userId: "usr_123", sessionHash, returnTo: "/connections",
      secret, now: 1_000_000, crypto: { getRandomValues: <T extends ArrayBufferView | null>(value: T): T => {
        if (value instanceof Uint8Array) value.fill(7); return value;
      } } });
    expect(token).not.toContain("supabase-access-token");
    await expect(verifyExecutorOAuthHandoff(token, secret, 1_030_000)).resolves.toMatchObject({
      action: "connect", userId: "usr_123", sessionHash, returnTo: "/connections", expiresAt: 1_060_000,
    });
  });

  it("rejects tampering, expiry, and open redirect payloads", async () => {
    const sessionHash = await sha256Base64Url("session");
    const token = await createExecutorOAuthHandoff({ userId: "usr_123", sessionHash, returnTo: "/connections",
      secret, now: 1_000_000 });
    await expect(verifyExecutorOAuthHandoff(`${token}x`, secret, 1_010_000)).rejects.toThrow();
    await expect(verifyExecutorOAuthHandoff(token, secret, 1_060_000)).rejects.toThrow(/expired/);
    await expect(createExecutorOAuthHandoff({ userId: "usr_123", sessionHash, returnTo: "//evil.example",
      secret, now: 1_000_000 })).rejects.toThrow();
  });
});
