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
  | "hedge_mode_required"
  | "verification_failed";

export interface ManualConnectionFailureLog {
  reason: ManualConnectionFailureReason;
  source: "provider" | "policy" | "internal";
  category?: WeexApiError["category"];
  code?: string;
  status?: number;
}

class ManualConnectionPolicyError extends Error {
  constructor(readonly reason: ManualConnectionFailureReason, message: string) {
    super(message);
    this.name = "ManualConnectionPolicyError";
  }
}

export function manualConnectionFailureReason(error: unknown): ManualConnectionFailureReason {
  if (error instanceof ManualConnectionPolicyError) return error.reason;
  if (!(error instanceof WeexApiError)) return "verification_failed";
  if (["40018", "-1056"].includes(error.code ?? "")) return "ip_not_allowed";
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

export function manualConnectionFailureLog(error: unknown): ManualConnectionFailureLog {
  const reason = manualConnectionFailureReason(error);
  if (error instanceof ManualConnectionPolicyError) return { reason, source: "policy" };
  if (!(error instanceof WeexApiError)) return { reason, source: "internal" };
  const code = typeof error.code === "string" && /^-?[A-Za-z0-9_]{1,32}$/.test(error.code)
    ? error.code : undefined;
  const status = Number.isSafeInteger(error.status) && (error.status ?? 0) >= 100 && (error.status ?? 0) <= 599
    ? error.status : undefined;
  return {
    reason,
    source: "provider",
    category: error.category,
    ...(code === undefined ? {} : { code }),
    ...(status === undefined ? {} : { status }),
  };
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
      if (!this.options.liveTradingEnabled) throw new Error("WEEX live trading is unavailable");
      const [spot, futures] = await Promise.allSettled([
        client.verifyAccount({ market: "spot", mode: "live" }),
        client.verifyAccount({ market: "futures", mode: "live" }),
      ]);
      const spotSummary = spot.status === "fulfilled" ? spot.value : null;
      const futuresSummary = futures.status === "fulfilled" ? futures.value : null;
      const spotReady = spotSummary?.readPermission === true && spotSummary.canTrade === true
        && spotSummary.withdrawalPermission === "absent";
      const futuresReady = futuresSummary?.readPermission === true && futuresSummary.canTrade === true
        && futuresSummary.withdrawalPermission === "absent" && futuresSummary.positionMode === "hedge";
      const withdrawalAbsent = (spotSummary?.withdrawalPermission ?? futuresSummary?.withdrawalPermission) === "absent"
        && spotSummary?.withdrawalPermission !== "present" && futuresSummary?.withdrawalPermission !== "present";
      if (!withdrawalAbsent) {
        throw new ManualConnectionPolicyError("permission_denied",
          "The configured WEEX API capability surface is unsafe");
      }
      if (!spotReady && !futuresReady) {
        if (futuresSummary?.readPermission === true && futuresSummary.canTrade === true
          && futuresSummary.positionMode === "one-way") {
          throw new ManualConnectionPolicyError("hedge_mode_required",
            "WEEX futures hedge mode is required");
        }
        const rejected = [spot, futures].find((result) => result.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
        throw new ManualConnectionPolicyError("permission_denied",
          "WEEX Spot or Futures trading permission is required");
      }
      const liveReady = spotReady || futuresReady;
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
        permissions: Object.freeze({
          read: true,
          spotTrade: spotReady,
          futuresTrade: futuresReady,
          withdrawal: false,
          liveVerified: true,
        }),
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
