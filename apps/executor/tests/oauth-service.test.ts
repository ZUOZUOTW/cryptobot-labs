import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createExecutorOAuthHandoff, sha256Base64Url, type CredentialEnvelopeKms } from "@cryptobot-labs/weex-client";

import type { OAuthRepository, StoredOAuthState } from "../src/oauth-repository";
import { ExecutorOAuthService } from "../src/oauth-service";

beforeAll(() => { Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto }); });

const secret = "0123456789abcdef0123456789abcdef";
const key = new Uint8Array(32).fill(8);
const kms: CredentialEnvelopeKms = {
  async generateDataKey() { return { plaintext: Uint8Array.from(key), ciphertext: new Uint8Array([1, 2]), keyId: "kms-key" }; },
  async decryptDataKey() { return Uint8Array.from(key); },
};

describe("executor OAuth service", () => {
  it("persists encrypted PKCE before returning the WEEX authorization URL and completes encrypted credentials", async () => {
    let state: StoredOAuthState | null = null;
    const repository: OAuthRepository = {
      assertReady: vi.fn(), registerShard: vi.fn(), close: vi.fn(), reserveHandoff: vi.fn(),
      prepareConnection: vi.fn(async () => "conn_abcdefghijklmnop"),
      createState: vi.fn(async (input) => { state = { id: input.id, connectionId: input.connectionId, userId: input.userId,
        stateHash: input.stateHash, sessionHash: input.sessionHash, redirectUri: input.redirectUri,
        keyId: input.envelope.keyId, encryptedDataKey: input.envelope.encryptedDataKey,
        initializationVector: input.envelope.initializationVector, ciphertext: input.envelope.ciphertext,
        context: input.context, expiresAt: input.expiresAt }; }),
      findState: vi.fn(async () => state), consumeState: vi.fn(async () => true),
      completeState: vi.fn(), completeManualConnection: vi.fn(), failConnection: vi.fn(), failState: vi.fn(),
    };
    const oauthClient = { exchangeAuthorizationCode: vi.fn(async () => ({ accessToken: "access", refreshToken: "refresh",
      expiresIn: 3600, refreshExpiresIn: 36000, scope: "create:apikey" as const })),
    createApiCredentials: vi.fn(async () => ({ apiKey: "api-key-1234", secret: "secret", passphrase: "pass" })) };
    const service = new ExecutorOAuthService({ repository, kms, oauthClient, clientId: "client-id", handoffSecret: secret,
      redirectUri: "https://api.example.test/oauth/weex/callback", publicOrigin: "https://www.example.test",
      shardId: "exec_abcdefghijklmnop", now: () => 1_000_000 });
    const handoff = await createExecutorOAuthHandoff({ userId: "user-1", sessionHash: await sha256Base64Url("session"),
      returnTo: "/connections", secret, now: 1_000_000 });
    const authorizationUrl = new URL(await service.start(handoff));
    expect(repository.prepareConnection).toHaveBeenCalledWith(expect.objectContaining({
      credentialSource: "oauth",
    }));
    expect(repository.createState).toHaveBeenCalledOnce();
    expect(JSON.stringify(state)).not.toContain("codeVerifier");
    const callback = await service.callback({ state: authorizationUrl.searchParams.get("state")!, code: "code-1" });
    expect(callback.toString()).toBe("https://www.example.test/connections?status=connected");
    expect(repository.completeState).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(repository.completeState).mock.calls[0])).not.toContain("secret");
  });

  it("consumes state only once and fails closed when OAuth credentials are absent", async () => {
    const repository = { assertReady: vi.fn(), registerShard: vi.fn(), close: vi.fn(), reserveHandoff: vi.fn(),
      prepareConnection: vi.fn(), createState: vi.fn(), findState: vi.fn(async () => null), consumeState: vi.fn(),
      completeState: vi.fn(), completeManualConnection: vi.fn(), failConnection: vi.fn(),
      failState: vi.fn() } satisfies OAuthRepository;
    const service = new ExecutorOAuthService({ repository, kms, oauthClient: null, clientId: null, handoffSecret: secret,
      redirectUri: "https://api.example.test/oauth/weex/callback", publicOrigin: "https://www.example.test",
      shardId: "exec_abcdefghijklmnop", now: () => 1_000_000 });
    await expect(service.start("invalid")).rejects.toMatchObject({ code: "oauth_disabled" });
    await expect(service.callback({ state: "unknown", code: "code" })).resolves.toMatchObject({
      href: "https://www.example.test/connections?status=error&reason=state_invalid",
    });
  });
});
