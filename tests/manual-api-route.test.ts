import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsertIdentity: vi.fn(),
  getCurrentUser: vi.fn(),
  createHandoff: vi.fn(),
  hash: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: "session-access-token" }) })),
}));
vi.mock("../db", () => ({ createControlPlaneDatabase: vi.fn(() => ({})) }));
vi.mock("../db/repositories", () => ({
  createUserRepository: vi.fn(() => ({ upsertIdentity: mocks.upsertIdentity })),
}));
vi.mock("../lib/server/platform-env", () => ({
  env: {
    DB: "postgres://control.invalid/database",
    EXECUTOR_HANDOFF_SECRET: "handoff-secret",
    EXECUTOR_API_ORIGIN: "https://executor.example.test",
  },
}));
vi.mock("../lib/server/supabase-auth", () => ({
  AUTH_ACCESS_COOKIE: "auth-cookie",
  getCurrentSupabaseUser: mocks.getCurrentUser,
}));
vi.mock("@cryptobot-labs/weex-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@cryptobot-labs/weex-client")>();
  return {
    ...original,
    createExecutorOAuthHandoff: mocks.createHandoff,
    sha256Base64Url: mocks.hash,
  };
});

import { POST } from "../app/api/connections/weex/manual/route";

const request = (body: unknown, site = "same-origin") => {
  const json = JSON.stringify(body);
  return new Request("https://www.cryptobotlabs.app/api/connections/weex/manual", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(json).byteLength),
      "sec-fetch-site": site,
    },
    body: json,
  });
};

describe("manual WEEX credential relay", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.upsertIdentity.mockReset().mockResolvedValue(undefined);
    mocks.getCurrentUser.mockReset().mockResolvedValue({
      id: "usr_1",
      email: "user@example.test",
      displayName: "Trader",
    });
    mocks.createHandoff.mockReset().mockResolvedValue("signed-handoff");
    mocks.hash.mockReset().mockResolvedValue("session-hash");
  });

  it("rejects cross-site credential submissions before reading or forwarding the body", async () => {
    const executorFetch = vi.spyOn(globalThis, "fetch");
    const response = await POST(request({
      apiKey: "api-key",
      secretKey: "secret-key",
      passphrase: "passphrase",
    }, "cross-site"));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(executorFetch).not.toHaveBeenCalled();
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it("forwards credentials once to the fixed Executor origin and returns only masked metadata", async () => {
    const executorFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      maskedApiKeySuffix: "A1B2",
      liveReady: true,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await POST(request({
      apiKey: " api-key-A1B2 ",
      secretKey: " secret-key ",
      passphrase: " passphrase ",
    }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(text).not.toContain("secret-key");
    expect(text).not.toContain("passphrase");
    expect(JSON.parse(text)).toEqual({
      connection: {
        status: "active",
        maskedApiKeySuffix: "A1B2",
        futuresDemoReady: true,
        liveReady: true,
      },
    });
    expect(executorFetch).toHaveBeenCalledOnce();
    expect(executorFetch).toHaveBeenCalledWith(
      new URL("https://executor.example.test/connections/weex/manual"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          apiKey: "api-key-A1B2",
          secretKey: "secret-key",
          passphrase: "passphrase",
        }),
        cache: "no-store",
        redirect: "error",
      }),
    );
  });

  it("preserves the Executor's safe hedge-mode remediation reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: "connection_verification_failed",
      reason: "hedge_mode_required",
    }), { status: 400, headers: { "content-type": "application/json" } }));

    const response = await POST(request({
      apiKey: "api-key",
      secretKey: "secret-key",
      passphrase: "passphrase",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "connection_verification_failed",
      reason: "hedge_mode_required",
    });
  });
});
