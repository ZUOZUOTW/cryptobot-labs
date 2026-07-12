import type {
  CancelOutcome,
  ExchangeOrderQuery,
  ExchangeOrderSnapshot,
  ExchangeSubmitRequest,
  ExecutionTarget,
  SubmitOutcome,
} from "@cryptobot-labs/trading-core";
import {
  WeexClock,
  WeexCredentials,
  WeexPrivateClient,
  createFetchTransport,
  type HttpTransport,
  type InstrumentRulesProvider,
  type VerifiedAccountSummary,
} from "@cryptobot-labs/weex-client";

import type { CredentialVault } from "./vault";

const CLOCK_PROBE_URL = "https://api-spot.weex.com/api/v3/market/ticker/price?symbol=BTCUSDT";
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export interface VaultWeexExecutionClientOptions {
  readonly vault: Pick<CredentialVault, "withCredentials">;
  readonly rulesProvider: InstrumentRulesProvider;
  readonly transport?: HttpTransport;
  readonly now?: () => number;
}

function liveTarget(target: ExecutionTarget): void {
  if (target.mode !== "live") throw new Error("Vault WEEX execution only supports live targets");
}

function safe(summary: VerifiedAccountSummary, target: ExecutionTarget): void {
  if (summary.market !== target.market || summary.mode !== "live" || summary.canTrade !== true
    || summary.readPermission !== true || summary.withdrawalPermission !== "absent"
    || (target.market === "futures" && summary.positionMode !== "hedge")) {
    throw new Error("WEEX live account verification is unsafe");
  }
}

/** Keeps every private client and plaintext credential inside one Vault callback. */
export function createVaultWeexExecutionClient(options: VaultWeexExecutionClientOptions) {
  const transport = options.transport ?? createFetchTransport({ timeoutMs: 10_000 });
  const now = options.now ?? Date.now;
  const withClient = async <Result>(target: ExecutionTarget,
    operation: (client: WeexPrivateClient) => Promise<Result>): Promise<Result> => {
    liveTarget(target);
    const sentAt = now();
    if (!Number.isSafeInteger(sentAt) || sentAt < 0) throw new Error("Invalid WEEX clock probe start");
    const probe = await transport.send({ method: "GET", url: CLOCK_PROBE_URL, headers: {} });
    const receivedAt = now();
    const body = probe.body as { symbol?: unknown; price?: unknown } | null;
    if (!Number.isSafeInteger(receivedAt) || receivedAt < sentAt || !body || body.symbol !== "BTCUSDT"
      || typeof body.price !== "string" || !DECIMAL.test(body.price) || !/[1-9]/.test(body.price)) {
      throw new Error("Invalid WEEX clock evidence");
    }
    const serverTime = typeof probe.headers.date === "string" ? Date.parse(probe.headers.date) : NaN;
    if (!Number.isSafeInteger(serverTime) || serverTime < 0) throw new Error("WEEX server time evidence is unavailable");
    const clock = new WeexClock(now); clock.recordServerTime(serverTime, sentAt, receivedAt);
    return options.vault.withCredentials(async (stored) => {
      const client = new WeexPrivateClient({ transport,
        credentials: new WeexCredentials(stored.apiKey, stored.secretKey, stored.passphrase), clock,
        rulesProvider: options.rulesProvider, now: () => Math.floor(clock.now()), maximumGetAttempts: 1 });
      safe(await client.verifyAccount(target), target);
      return operation(client);
    });
  };
  return Object.freeze({
    submitOrder(request: ExchangeSubmitRequest): Promise<SubmitOutcome> {
      return withClient(request.target, (client) => client.submitOrder(request));
    },
    findOrderByClientOrderId(query: ExchangeOrderQuery): Promise<ExchangeOrderSnapshot | null> {
      return withClient(query.target, (client) => client.findOrderByClientOrderId(query));
    },
    cancelOrder(query: ExchangeOrderQuery): Promise<CancelOutcome> {
      return withClient(query.target, (client) => client.cancelOrder(query));
    },
  });
}
