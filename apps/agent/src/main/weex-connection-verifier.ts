import {
  WeexClock,
  WeexCredentials,
  WeexPrivateClient,
  createFetchTransport,
  type HttpTransport,
  type VerifiedAccountSummary,
} from "@cryptobot-labs/weex-client";

import type { VerifiedConnection } from "../shared/ipc-contract";
import type { CredentialVault } from "./vault";

const CLOCK_PROBE_URL = "https://api-spot.weex.com/api/v3/market/ticker/price?symbol=BTCUSDT";

export interface WeexConnectionVerifierOptions {
  readonly vault: Pick<CredentialVault, "withCredentials">;
  readonly transport?: HttpTransport;
  readonly now?: () => number;
}

function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

function validateClockProbe(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("WEEX clock probe returned invalid data");
  }
  const value = body as Record<string, unknown>;
  if (value.symbol !== "BTCUSDT" || typeof value.price !== "string" ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.price) || !/[1-9]/.test(value.price)) {
    throw new Error("WEEX clock probe returned invalid data");
  }
}

function assertSafeAccount(summary: VerifiedAccountSummary, market: "spot" | "futures"): void {
  if (summary.market !== market || summary.mode !== "live" || summary.readPermission !== true ||
      summary.withdrawalPermission !== "absent") {
    throw new Error("WEEX account permissions are unsafe");
  }
}

/** Verifies local credentials without ever returning or persisting secret material. */
export function createWeexConnectionVerifier(options: WeexConnectionVerifierOptions) {
  const transport = options.transport ?? createFetchTransport({ timeoutMs: 10_000 });
  const now = options.now ?? Date.now;

  return Object.freeze({
    async verify(): Promise<VerifiedConnection> {
      const clock = new WeexClock(now);
      const sentAt = timestamp(now(), "clock probe start");
      const probe = await transport.send({ method: "GET", url: CLOCK_PROBE_URL, headers: {} });
      const receivedAt = timestamp(now(), "clock probe completion");
      validateClockProbe(probe.body);
      const serverDate = probe.headers.date;
      const serverTime = typeof serverDate === "string" ? Date.parse(serverDate) : NaN;
      if (!Number.isSafeInteger(serverTime) || serverTime < 0) {
        throw new Error("WEEX server time evidence is unavailable");
      }
      clock.recordServerTime(serverTime, sentAt, receivedAt);

      return options.vault.withCredentials(async (stored) => {
        const apiKeySuffix = stored.apiKey.slice(-4);
        const client = new WeexPrivateClient({
          transport,
          credentials: new WeexCredentials(stored.apiKey, stored.secretKey, stored.passphrase),
          clock,
          now: () => Math.floor(clock.now()),
        });
        const spot = await client.verifyAccount({ market: "spot", mode: "live" });
        const futures = await client.verifyAccount({ market: "futures", mode: "live" });
        assertSafeAccount(spot, "spot");
        assertSafeAccount(futures, "futures");
        const verifiedAt = Math.min(spot.verifiedAt, futures.verifiedAt);
        timestamp(verifiedAt, "verification time");
        return Object.freeze({
          provider: "WEEX" as const,
          apiKeySuffix,
          verifiedAt: new Date(verifiedAt).toISOString(),
          permissions: Object.freeze({
            read: true,
            spotTrade: spot.canTrade === true,
            futuresTrade: futures.canTrade === true && futures.positionMode === "hedge",
            withdrawal: false as const,
          }),
        });
      });
    },
  });
}
