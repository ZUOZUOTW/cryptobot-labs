import type {
  CancelOutcome,
  ExchangeOrderQuery,
  ExchangeOrderSnapshot,
  ExchangeSubmitRequest,
  ExecutionTarget,
  SubmitOutcome,
} from "@cryptobot-labs/trading-core";
import { isWeexBrokerId } from "@cryptobot-labs/trading-core";
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
  readonly brokerId: string;
  readonly vault: Pick<CredentialVault, "withCredentials">;
  readonly rulesProvider: InstrumentRulesProvider;
  readonly transport?: HttpTransport;
  readonly now?: () => number;
}

function privateTarget(target: ExecutionTarget): void {
  if (target.mode !== "live" && !(target.market === "futures" && target.mode === "futures-demo")) {
    throw new Error("Vault WEEX execution only supports private exchange targets");
  }
}

function safe(summary: VerifiedAccountSummary, target: ExecutionTarget): void {
  const exactTarget = summary.market === target.market && summary.mode === target.mode && summary.readPermission === true;
  const safeLive = target.mode !== "live" || (summary.canTrade === true
    && summary.withdrawalPermission === "absent"
    && (target.market !== "futures" || summary.positionMode === "hedge"));
  if (!exactTarget || !safeLive) {
    throw new Error("WEEX private account verification is unsafe");
  }
}

/** Keeps every private client and plaintext credential inside one Vault callback. */
export function createVaultWeexExecutionClient(options: VaultWeexExecutionClientOptions) {
  if (!isWeexBrokerId(options.brokerId)) throw new Error("A valid WEEX broker id is required");
  const transport = options.transport ?? createFetchTransport({ timeoutMs: 10_000 });
  const now = options.now ?? Date.now;
  const withClient = async <Result>(target: ExecutionTarget,
    operation: (client: WeexPrivateClient) => Promise<Result>): Promise<Result> => {
    privateTarget(target);
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
      const client = new WeexPrivateClient({ brokerId: options.brokerId, transport,
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
      if (query.target.mode === "futures-demo") {
        return Promise.resolve({ status: "rejected", reason: "unsupported-demo-cancel" });
      }
      return withClient(query.target, (client) => client.cancelOrder(query));
    },
  });
}
