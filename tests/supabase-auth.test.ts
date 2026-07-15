import { describe, expect, it, vi } from "vitest";
import {
  callbackUrl,
  createAuthTransaction,
  exchangeAuthCode,
  getCurrentSupabaseUser,
  getSupabaseAuthConfig,
  productionAuthReady,
  readAuthTransaction,
  refreshSupabaseSession,
  safeReturnTo,
} from "../lib/server/supabase-auth";

const environment = {
  DEMO_MODE: "false",
  PUBLIC_ORIGIN: "https://app.example.test",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_1234567890",
  AUTH_COOKIE_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("Supabase production auth boundary", () => {
  it("fails closed until every server-side auth setting is valid", () => {
    expect(productionAuthReady({ ...environment, DEMO_MODE: "true" })).toBe(false);
    expect(productionAuthReady({ ...environment, AUTH_COOKIE_SECRET: "short" })).toBe(false);
    expect(productionAuthReady(environment)).toBe(true);
    expect(getSupabaseAuthConfig(environment)).toMatchObject({
      origin: "https://app.example.test", supabaseUrl: "https://project.supabase.co",
    });
  });

  it("signs a short-lived PKCE transaction and rejects tampering, expiry, and open redirects", async () => {
    const config = getSupabaseAuthConfig(environment);
    const created = await createAuthTransaction("/workshop?bot=orbit#paper", config, 1_000_000);
    expect(created.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(callbackUrl(config, created.transaction.state)).toContain("/auth/callback?state=");
    await expect(readAuthTransaction(created.cookieValue, created.transaction.state, config, 1_300_000))
      .resolves.toMatchObject({ returnTo: "/workshop?bot=orbit#paper" });
    await expect(readAuthTransaction(`${created.cookieValue}x`, created.transaction.state, config, 1_300_000)).resolves.toBeNull();
    await expect(readAuthTransaction(created.cookieValue, "wrong", config, 1_300_000)).resolves.toBeNull();
    await expect(readAuthTransaction(created.cookieValue, created.transaction.state, config, 1_700_000)).resolves.toBeNull();
    expect(safeReturnTo("//evil.example", "/bots")).toBe("/bots");
    expect(safeReturnTo("/auth/callback?code=x", "/bots")).toBe("/bots");
  });

  it("exchanges and refreshes sessions without accepting malformed token responses", async () => {
    const config = getSupabaseAuthConfig(environment);
    const good = vi.fn(async () => Response.json({
      access_token: "access_token_1234567890", refresh_token: "opaque123", expires_in: 3600,
    }));
    await expect(exchangeAuthCode("auth_code_1234567890", "v".repeat(43), config, good)).resolves.toMatchObject({ expiresIn: 3600 });
    expect(good).toHaveBeenCalledWith(expect.stringContaining("grant_type=pkce"), expect.objectContaining({ method: "POST" }));
    await expect(refreshSupabaseSession("opaque123", config, good)).resolves.toMatchObject({ expiresIn: 3600 });
    await expect(refreshSupabaseSession("bad token", config, good)).resolves.toBeNull();
    const malformed = vi.fn(async () => Response.json({ access_token: "short", refresh_token: "short", expires_in: 3600 }));
    await expect(exchangeAuthCode("auth_code_1234567890", "v".repeat(43), config, malformed)).resolves.toBeNull();
  });

  it("trusts only the Auth user endpoint for the current identity", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access_token_1234567890");
      return Response.json({ id: "9fd9d213-4a7b-4f3d-99a0-f0fd8c42b783", email: " MEMBER@EXAMPLE.COM ",
        user_metadata: { full_name: "正式會員" } });
    }) as unknown as typeof fetch;
    await expect(getCurrentSupabaseUser(environment, fetchImpl, {
      get: () => ({ value: "access_token_1234567890" }),
    })).resolves.toEqual({ id: "9fd9d213-4a7b-4f3d-99a0-f0fd8c42b783", email: "member@example.com", displayName: "正式會員" });
  });
});
