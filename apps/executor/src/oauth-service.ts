import { timingSafeEqual } from "node:crypto";

import {
  buildWeexAuthorizationUrl,
  createWeexOAuthTransaction,
  encryptWeexCredentials,
  sha256Base64Url,
  verifyExecutorOAuthHandoff,
  WeexCredentials,
  WeexOAuthError,
  type CredentialEnvelopeKms,
  type WeexOAuthApiCredentials,
  type WeexOAuthToken,
} from "@cryptobot-labs/weex-client";

import type { OAuthRepository, StoredOAuthState } from "./oauth-repository";
import { decryptBackendSecret, encryptBackendSecret } from "./secret-envelope";

export interface WeexOAuthPort {
  exchangeAuthorizationCode(input: { code: string; redirectUri: string; codeVerifier: string }): Promise<WeexOAuthToken>;
  createApiCredentials(accessToken: string): Promise<WeexOAuthApiCredentials>;
}

const id = (prefix: "conn" | "woauth", implementation: Pick<Crypto, "getRandomValues"> = crypto): string => {
  const value = new Uint8Array(24);
  implementation.getRandomValues(value);
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return `${prefix}_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
};

const sameHash = (left: string, right: string): boolean => {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
};

const failureCode = (error: unknown): string => {
  if (error instanceof WeexOAuthError) {
    if (error.code === "80004") return "pkce_failed";
    if (error.code === "81001" || error.code === "80008") return "api_already_bound";
    if (/^8\d{4}$/.test(error.code)) return `weex_${error.code}`;
    if (error.code === "http_error") return "weex_unavailable";
  }
  return "oauth_failed";
};

export class ExecutorOAuthService {
  constructor(private readonly options: {
    repository: OAuthRepository;
    kms: CredentialEnvelopeKms;
    oauthClient: WeexOAuthPort | null;
    clientId: string | null;
    handoffSecret: string;
    redirectUri: string;
    publicOrigin: string;
    shardId: string;
    now?: () => number;
  }) {}

  get enabled(): boolean { return this.options.oauthClient !== null && this.options.clientId !== null; }

  async start(handoffToken: string): Promise<string> {
    if (!this.enabled) throw new WeexOAuthError("WEEX OAuth is not configured", "oauth_disabled");
    const now = (this.options.now ?? Date.now)();
    const handoff = await verifyExecutorOAuthHandoff(handoffToken, this.options.handoffSecret, now);
    const nonceHash = await sha256Base64Url(handoff.nonce);
    await this.options.repository.reserveHandoff({ handoff, nonceHash, now });

    const connection = await this.options.repository.prepareConnection({ candidateId: id("conn"),
      userId: handoff.userId, shardId: this.options.shardId, credentialSource: "oauth", now });
    const stateId = id("woauth");
    const transaction = await createWeexOAuthTransaction();
    const context = Object.freeze({ purpose: "weex_oauth_pkce", oauth_state_id: stateId,
      connection_id: connection.id, connection_version: String(connection.version), user_id: handoff.userId });
    const envelope = await encryptBackendSecret({ plaintext: transaction.codeVerifier, context, kms: this.options.kms });
    await this.options.repository.createState({ id: stateId, connectionId: connection.id,
      connectionVersion: connection.version, userId: handoff.userId,
      stateHash: transaction.stateHash, sessionHash: handoff.sessionHash, redirectUri: this.options.redirectUri,
      expiresAt: now + 600_000, now, envelope, context });
    return buildWeexAuthorizationUrl({ clientId: this.options.clientId!, redirectUri: this.options.redirectUri,
      state: transaction.state, codeChallenge: transaction.codeChallenge });
  }

  async callback(input: { state: string; code?: string; error?: string }): Promise<URL> {
    const now = (this.options.now ?? Date.now)();
    const stateHash = await sha256Base64Url(input.state);
    const stored = await this.options.repository.findState(stateHash);
    if (!stored || !sameHash(stored.stateHash, stateHash) || stored.expiresAt <= now
      || !await this.options.repository.consumeState(stored.id, stateHash, stored.connectionVersion, now)) {
      return this.result("error", "state_invalid");
    }
    if (input.error || !input.code || !this.options.oauthClient) {
      await this.options.repository.failState({ state: stored, code: input.error ? "authorization_denied" : "oauth_disabled", now });
      return this.result("error", input.error ? "authorization_denied" : "oauth_unavailable");
    }
    try {
      const codeVerifier = await this.decryptVerifier(stored);
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) throw new WeexOAuthError("Invalid PKCE verifier", "invalid_pkce");
      const token = await this.options.oauthClient.exchangeAuthorizationCode({ code: input.code,
        redirectUri: stored.redirectUri, codeVerifier });
      const api = await this.options.oauthClient.createApiCredentials(token.accessToken);
      const credentialContext = Object.freeze({ purpose: "weex_api_credentials", connection_id: stored.connectionId,
        connection_version: String(stored.connectionVersion), user_id: stored.userId, version: "1" });
      const credentials = new WeexCredentials(api.apiKey, api.secret, api.passphrase);
      const credentialEnvelope = await encryptWeexCredentials({ credentials, context: credentialContext, kms: this.options.kms });
      await this.options.repository.completeState({ state: stored, credentialEnvelope, credentialContext,
        maskedApiKeySuffix: api.apiKey.slice(-4), now: (this.options.now ?? Date.now)() });
      return this.result("connected");
    } catch (error) {
      const code = failureCode(error);
      await this.options.repository.failState({ state: stored, code, now: (this.options.now ?? Date.now)() }).catch(() => undefined);
      return this.result("error", code);
    }
  }

  private async decryptVerifier(state: StoredOAuthState): Promise<string> {
    return decryptBackendSecret({ envelope: { version: 1, keyId: state.keyId,
      encryptedDataKey: state.encryptedDataKey, initializationVector: state.initializationVector,
      ciphertext: state.ciphertext }, context: state.context, kms: this.options.kms });
  }

  private result(status: "connected" | "error", reason?: string): URL {
    const url = new URL("/connections", this.options.publicOrigin);
    url.searchParams.set("status", status);
    if (reason) url.searchParams.set("reason", reason);
    return url;
  }
}
