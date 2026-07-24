import {
  createFetchTransport,
  encryptWeexCredentials,
  sha256Base64Url,
  verifyExecutorOAuthHandoff,
  WeexClock,
  WeexApiError,
  WeexCredentials,
  WeexPrivateClient,
  type CredentialEnvelopeKms,
} from "@cryptobot-labs/weex-client";

import type { OAuthRepository } from "./oauth-repository";

const CLOCK_PROBE_URL = "https://api-spot.weex.com/api/v3/market/ticker/price?symbol=BTCUSDT";

export type ManualConnectionFailureReason =
  | "invalid_credentials"
  | "ip_not_allowed"
  | "permission_denied"
  | "clock_error"
  | "rate_limited"
  | "weex_unavailable"
  | "invalid_weex_response"
  | "verification_failed";

export function manualConnectionFailureReason(error: unknown): ManualConnectionFailureReason {
  if (!(error instanceof WeexApiError)) return "verification_failed";
  if (error.code === "40018") return "ip_not_allowed";
  if (["40006", "40009", "40012", "-1040", "-1041", "-1044", "-1047", "-1048", "-1049"]
    .includes(error.code ?? "")) return "invalid_credentials";
  if (error.category === "authentication") return "invalid_credentials";
  if (error.category === "permission") return "permission_denied";
  if (error.category === "clock") return "clock_error";
  if (error.category === "rate-limit") return "rate_limited";
  if (error.category === "network" || error.category === "server") return "weex_unavailable";
  if (error.category === "schema") return "invalid_weex_response";
  return "verification_failed";
}

const id = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `conn_${Buffer.from(bytes).toString("base64url")}`;
};

export class ManualWeexConnectionService {
  constructor(private readonly options: {
    repository: OAuthRepository;
    kms: CredentialEnvelopeKms;
    handoffSecret: string;
    shardId: string;
    liveTradingEnabled: boolean;
    now?: () => number;
  }) {}

  async connect(handoffToken: string, input: {
    apiKey: string;
    secretKey: string;
    passphrase: string;
  }): Promise<{ connectionId: string; maskedApiKeySuffix: string; liveReady: boolean }> {
    const now = (this.options.now ?? Date.now)();
    const handoff = await verifyExecutorOAuthHandoff(handoffToken, this.options.handoffSecret, now);
    await this.options.repository.reserveHandoff({
      handoff,
      nonceHash: await sha256Base64Url(handoff.nonce),
      now,
    });
    const connectionId = await this.options.repository.prepareConnection({
      candidateId: id(),
      userId: handoff.userId,
      shardId: this.options.shardId,
      now,
    });
    try {
      const credentials = new WeexCredentials(input.apiKey, input.secretKey, input.passphrase);
      const transport = createFetchTransport({ timeoutMs: 10_000 });
      const sentAt = (this.options.now ?? Date.now)();
      const probe = await transport.send({ method: "GET", url: CLOCK_PROBE_URL, headers: { Accept: "application/json" } });
      const receivedAt = (this.options.now ?? Date.now)();
      const serverTime = Date.parse(probe.headers.date ?? "");
      if (!Number.isSafeInteger(serverTime) || receivedAt < sentAt) throw new Error("WEEX clock verification failed");
      const clock = new WeexClock(this.options.now ?? Date.now);
      clock.recordServerTime(serverTime, sentAt, receivedAt);
      const client = new WeexPrivateClient({ transport, credentials, clock, now: () => Math.floor(clock.now()),
        maximumGetAttempts: 1 });
      const demo = await client.verifyAccount({ market: "futures", mode: "futures-demo" });
      if (demo.readPermission !== true) throw new Error("WEEX futures demo permission is unavailable");
      let liveReady = false;
      if (this.options.liveTradingEnabled) {
        const live = await client.verifyAccount({ market: "futures", mode: "live" });
        liveReady = live.canTrade === true && live.withdrawalPermission === "absent" && live.positionMode === "hedge";
        if (!liveReady) throw new Error("WEEX live permissions are unsafe");
      }
      const context = Object.freeze({ purpose: "weex_api_credentials", connection_id: connectionId,
        user_id: handoff.userId, version: "1" });
      const envelope = await encryptWeexCredentials({ credentials, context, kms: this.options.kms });
      const suffix = input.apiKey.slice(-4);
      await this.options.repository.completeManualConnection({
        connectionId,
        userId: handoff.userId,
        credentialEnvelope: envelope,
        credentialContext: context,
        maskedApiKeySuffix: suffix,
        permissions: Object.freeze({ read: true, spotTrade: false, futuresTrade: true, withdrawal: false }),
        now: (this.options.now ?? Date.now)(),
      });
      return { connectionId, maskedApiKeySuffix: suffix, liveReady };
    } catch (error) {
      await this.options.repository.failConnection({ connectionId, userId: handoff.userId,
        now: (this.options.now ?? Date.now)() }).catch(() => undefined);
      throw error;
    }
  }
}
