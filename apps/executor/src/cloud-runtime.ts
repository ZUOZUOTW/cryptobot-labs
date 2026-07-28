import {
  SignalIntentNormalizer,
  createVisualStrategyEvaluator,
  deriveClientOrderId,
  evaluateOrderRisk,
  type RiskContext,
  type RiskPolicy,
  type RiskDecision,
  type Candle,
  type OrderIntent,
  type StrategySignal,
  type StrategyPortfolioSnapshot,
  type VisualBotConfig,
} from "@cryptobot-labs/trading-core";
import {
  createFetchTransport,
  decryptWeexCredentials,
  WeexApiError,
  WeexClock,
  WeexPrivateClient,
  WeexPublicClient,
  type CredentialEnvelopeKms,
  type WeexAccountPosition,
  type VerifiedAccountSummary,
  type WeexAccountSnapshot,
} from "@cryptobot-labs/weex-client";

import type { ClaimedOrder, CloudRun, CloudRuntimeRepository } from "./cloud-repository";
import type { ClaimedAccountSnapshot } from "./cloud-repository";
import { CloudMarketDataCache } from "./cloud-market-cache";
import { mapWithConcurrency } from "./concurrency";
import { RateLimitedWeexTransport } from "./rate-limited-transport";

const CLOCK_PROBE_URL = "https://api-spot.weex.com/api/v3/market/ticker/price?symbol=BTCUSDT";
const DECIMAL = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;
const TRADE_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const ORDER_RECONCILIATION_GRACE_MS = 30_000;
const SAFE_READ_ATTEMPTS = 3;
const PRIVATE_CLIENT_TTL_MS = 20_000;
const ACCOUNT_VERIFICATION_TTL_MS = 15_000;
const ACCOUNT_SNAPSHOT_TTL_MS = 2_000;
const CLOCK_SAMPLE_TTL_MS = 5_000;
const LEASE_HEARTBEAT_MS = 30_000;

type LiveTarget =
  | { readonly market: "spot"; readonly mode: "live" }
  | { readonly market: "futures"; readonly mode: "futures-demo" | "live" };

interface TimedRequest<T> {
  readonly expiresAt: number;
  readonly promise: Promise<T>;
}

interface CachedPrivateClient {
  readonly client: WeexPrivateClient;
  readonly expiresAt: number;
  readonly verifications: Map<string, TimedRequest<VerifiedAccountSummary>>;
  readonly snapshots: Map<string, TimedRequest<WeexAccountSnapshot>>;
}

class AccountSyncStageError extends Error {
  constructor(readonly stage: "client" | "snapshot" | "projection" | "database", cause: unknown) {
    super("WEEX account synchronization stage failed", { cause });
  }
}

export async function retryWeexRead<T>(
  operation: () => Promise<T>,
  scheduler: (delayMs: number) => Promise<void> =
    (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  maximumAttempts = SAFE_READ_ATTEMPTS,
): Promise<T> {
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 5) {
    throw new TypeError("Invalid WEEX read retry limit");
  }
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof WeexApiError) || !error.retryable || attempt === maximumAttempts) throw error;
      await scheduler(100 * 2 ** (attempt - 1));
    }
  }
  throw new Error("Unreachable WEEX read retry state");
}

type CloudRunFailureStage = "account" | "exchange" | "runtime";

class CloudRunExecutionError extends Error {
  constructor(
    readonly code: "demo_funds_required" | "account_equity_unavailable" | "live_trading_disabled"
      | "live_api_permission_required" | "withdrawal_permission_forbidden" | "hedge_mode_required"
      | "unsupported_market_mode" | "unknown_order_state" | "ambiguous_position_state"
      | "unmanaged_position_state",
    readonly stage: CloudRunFailureStage,
    readonly terminal: boolean,
  ) {
    super("Cloud strategy execution prerequisite is unavailable");
  }
}

interface SettlementBalance {
  asset: string;
  total: string;
  available: string;
}

export const requireSettlementBalance = (
  balances: readonly SettlementBalance[],
  mode: CloudRun["mode"],
): SettlementBalance => {
  const expectedAsset = mode === "futures-demo" ? "SUSDT" : "USDT";
  const balance = balances.find(({ asset }) => asset === expectedAsset);
  if (!balance || !DECIMAL.test(balance.total) || Number(balance.total) <= 0) {
    throw new CloudRunExecutionError(
      mode === "futures-demo" ? "demo_funds_required" : "account_equity_unavailable",
      "account",
      true,
    );
  }
  return balance;
};

const cloudRunFailure = (error: unknown): {
  code: string;
  stage: CloudRunFailureStage;
  category: string;
  name: string;
  exchangeCode: string | null;
  status: number | null;
  terminal: boolean;
} => {
  if (error instanceof CloudRunExecutionError) {
    return {
      code: error.code,
      stage: error.stage,
      category: "precondition",
      name: error.name,
      exchangeCode: null,
      status: null,
      terminal: error.terminal,
    };
  }
  if (error instanceof WeexApiError) {
    return {
      code: `weex_${error.category.replace(/[^a-z0-9]+/g, "_")}`,
      stage: "exchange",
      category: error.category,
      name: error.name,
      exchangeCode: error.code ?? null,
      status: error.status ?? null,
      terminal: false,
    };
  }
  const name = error && typeof error === "object" && "name" in error
    && typeof error.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
    ? error.name : "Error";
  return {
    code: "execution_failed",
    stage: "runtime",
    category: "internal",
    name,
    exchangeCode: null,
    status: null,
    terminal: false,
  };
};

const amount = (value: unknown, fallback = "0"): string =>
  typeof value === "string" && DECIMAL.test(value) ? value : fallback;
const decimalSum = (values: readonly string[]): string => {
  const parsed = values.map((value) => {
    if (!SIGNED_DECIMAL.test(value)) throw new Error("Invalid decimal");
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [whole, fraction = ""] = unsigned.split(".");
    return { amount: BigInt(`${negative ? "-" : ""}${whole}${fraction}`), scale: fraction.length };
  });
  const scale = parsed.reduce((maximum, value) => Math.max(maximum, value.scale), 0);
  const total = parsed.reduce((sum, value) =>
    sum + value.amount * BigInt(10) ** BigInt(scale - value.scale), BigInt(0));
  const negative = total < BigInt(0);
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? "" : digits.slice(-scale).replace(/0+$/, "");
  const canonical = fraction ? `${whole}.${fraction}` : whole;
  return negative && canonical !== "0" ? `-${canonical}` : canonical;
};
const decimalParts = (value: string): { amount: bigint; scale: number } => {
  if (!DECIMAL.test(value)) throw new Error("Invalid decimal");
  const [whole, fraction = ""] = value.split(".");
  return { amount: BigInt(`${whole}${fraction}`), scale: fraction.length };
};
const decimalCompare = (left: string, right: string): number => {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const normalizedA = a.amount * BigInt(10) ** BigInt(scale - a.scale);
  const normalizedB = b.amount * BigInt(10) ** BigInt(scale - b.scale);
  return normalizedA < normalizedB ? -1 : normalizedA > normalizedB ? 1 : 0;
};
export const decimalRatio = (numerator: string, denominator: string, outputScale = 18): string => {
  const a = decimalParts(numerator);
  const b = decimalParts(denominator);
  if (b.amount === BigInt(0) || !Number.isSafeInteger(outputScale) || outputScale < 0 || outputScale > 18) {
    throw new Error("Invalid decimal ratio");
  }
  const scaled = (a.amount * BigInt(10) ** BigInt(b.scale + outputScale))
    / (b.amount * BigInt(10) ** BigInt(a.scale));
  const digits = scaled.toString().padStart(outputScale + 1, "0");
  if (outputScale === 0) return digits;
  const fraction = digits.slice(-outputScale).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -outputScale)}.${fraction}` : digits.slice(0, -outputScale);
};
export const deriveFuturesPositionSnapshot = (
  position: WeexAccountPosition,
  candles: readonly Candle[],
): NonNullable<StrategyPortfolioSnapshot["position"]> => {
  const entryPrice = decimalRatio(position.openValue, position.size);
  if (!DECIMAL.test(entryPrice) || decimalCompare(entryPrice, "0") <= 0) throw new Error("Invalid position entry price");
  const relevant = candles.filter((candle) => candle.complete
    && (position.openedAt === null || candle.closeTime >= position.openedAt));
  const peakPrice = relevant.reduce((peak, candle) =>
    decimalCompare(candle.high, peak) > 0 ? candle.high : peak, entryPrice);
  const troughPrice = relevant.reduce((trough, candle) =>
    decimalCompare(candle.low, trough) < 0 ? candle.low : trough, entryPrice);
  return Object.freeze({
    side: position.side,
    ...(position.openedAt === null ? {} : { entryTime: position.openedAt }),
    entryPrice,
    peakPrice,
    troughPrice,
    quantity: position.size,
    usedMargin: position.openValue,
    layerCount: 1,
  });
};

export async function executeCloudOrder(input: {
  repository: CloudRuntimeRepository;
  client: Pick<WeexPrivateClient, "findOrderByClientOrderId" | "submitOrder">;
  run: CloudRun;
  owner: string;
  candleCloseAt: number;
  signal: StrategySignal;
  intent: OrderIntent;
  decision: RiskDecision;
  claim: ClaimedOrder;
  target: { market: "spot"; mode: "live" } | { market: "futures"; mode: "futures-demo" | "live" };
  symbol: string;
  now: number;
}): Promise<"completed" | "deferred"> {
  if (!input.claim.fresh) {
    return settleBlockingCloudOrder({
      repository: input.repository,
      client: input.client,
      run: input.run,
      owner: input.owner,
      order: input.claim,
      target: input.target,
      symbol: input.symbol,
      now: input.now,
    });
  }
  const finish = async (signal: unknown): Promise<"completed"> => {
    await input.repository.complete(input.run, input.owner, input.candleCloseAt, signal, input.now);
    return "completed";
  };
  if (!input.decision.allowed) {
    await input.repository.recordOrder({
      runId: input.run.id,
      candleCloseAt: input.candleCloseAt,
      status: "risk-rejected",
      intent: input.intent,
      errorCode: input.decision.reason,
      now: input.now,
    });
    return finish({ ...input.signal, riskRejected: input.decision.reason });
  }
  await input.repository.recordOrder({
    runId: input.run.id,
    candleCloseAt: input.candleCloseAt,
    status: "unknown",
    intent: input.intent,
    errorCode: "submission_in_progress",
    now: input.now,
  });
  const outcome = await input.client.submitOrder({
    target: input.target,
    clientOrderId: input.claim.clientOrderId,
    intent: input.intent,
  });
  await input.repository.recordOrder({
    runId: input.run.id,
    candleCloseAt: input.candleCloseAt,
    status: outcome.status,
    intent: input.intent,
    ...(outcome.status === "acknowledged"
      ? { exchangeOrderId: outcome.exchangeOrderId }
      : { errorCode: outcome.reason ?? outcome.status }),
    now: input.now,
  });
  if (outcome.status === "unknown") {
    await input.repository.release(input.run.id, input.owner, input.now);
    return "deferred";
  }
  return finish(input.signal);
}

export async function settleBlockingCloudOrder(input: {
  repository: CloudRuntimeRepository;
  client: Pick<WeexPrivateClient, "findOrderByClientOrderId">;
  run: CloudRun;
  owner: string;
  order: ClaimedOrder;
  target: { market: "spot"; mode: "live" } | { market: "futures"; mode: "futures-demo" | "live" };
  symbol: string;
  now: number;
}): Promise<"completed" | "deferred"> {
  const finish = async (signal: unknown): Promise<"completed"> => {
    await input.repository.complete(
      input.run,
      input.owner,
      input.order.candleCloseAt,
      signal,
      input.now,
    );
    return "completed";
  };
  if (input.order.status === "risk-rejected" || input.order.status === "rejected") {
    return finish(input.order.signal);
  }
  const existing = await input.client.findOrderByClientOrderId({
    target: input.target,
    symbol: input.symbol,
    clientOrderId: input.order.clientOrderId,
    ...(input.order.exchangeOrderId ? { exchangeOrderId: input.order.exchangeOrderId } : {}),
  });
  if (existing) {
    const partiallyFilled = decimalCompare(existing.cumulativeFilledQuantity, "0") > 0;
    const exchangeState = existing.status === "FILLED"
      ? { status: "acknowledged" as const, errorCode: "exchange_order_filled" }
      : existing.status === "CANCELED" && partiallyFilled
        ? { status: "acknowledged" as const, errorCode: "exchange_order_cancelled_partially_filled" }
        : existing.status === "CANCELED"
          ? { status: "rejected" as const, errorCode: "exchange_order_cancelled" }
          : existing.status === "REJECTED"
            ? { status: "rejected" as const, errorCode: "exchange_order_rejected" }
            : existing.status === "PARTIALLY_FILLED"
              ? { status: "acknowledged" as const, errorCode: "exchange_order_partially_filled" }
              : { status: "acknowledged" as const, errorCode: "exchange_order_open" };
    await input.repository.recordOrder({
      runId: input.run.id,
      candleCloseAt: input.order.candleCloseAt,
      status: exchangeState.status,
      ...(input.order.intent ? { intent: input.order.intent } : {}),
      exchangeOrderId: existing.exchangeOrderId,
      errorCode: exchangeState.errorCode,
      now: input.now,
    });
    return finish(input.order.signal);
  }
  if (input.order.status === "acknowledged") {
    await input.repository.release(input.run.id, input.owner, input.now);
    return "deferred";
  }
  if (input.now - input.order.createdAt < ORDER_RECONCILIATION_GRACE_MS) {
    await input.repository.release(input.run.id, input.owner, input.now);
    return "deferred";
  }
  await input.repository.recordOrder({
    runId: input.run.id,
    candleCloseAt: input.order.candleCloseAt,
    status: "rejected",
    ...(input.order.intent ? { intent: input.order.intent } : {}),
    errorCode: "stale_claim_no_exchange_order",
    now: input.now,
  });
  return finish({ ...input.order.signal, orderSkipped: "stale_claim_no_exchange_order" });
}
const trackedSpotPosition = (
  storedPositions: readonly unknown[],
  position: WeexAccountPosition,
  candles: readonly Candle[],
  lastCandleAt: number | null,
): NonNullable<StrategyPortfolioSnapshot["position"]> => {
  const stored = storedPositions.find((value) => value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).symbol === position.symbol) as Record<string, unknown> | undefined;
  const previousEntry = typeof stored?.entryPrice === "string" && DECIMAL.test(stored.entryPrice)
    && decimalCompare(stored.entryPrice, "0") > 0 ? stored.entryPrice : null;
  const previousPeak = typeof stored?.peakPrice === "string" && DECIMAL.test(stored.peakPrice)
    && decimalCompare(stored.peakPrice, "0") > 0 ? stored.peakPrice : null;
  const previousTrough = typeof stored?.troughPrice === "string" && DECIMAL.test(stored.troughPrice)
    && decimalCompare(stored.troughPrice, "0") > 0 ? stored.troughPrice : null;
  const entryCandle = lastCandleAt === null ? undefined : candles.find(({ closeTime }) => closeTime === lastCandleAt);
  const latest = candles.at(-1);
  if (!latest) throw new Error("Spot position candle history is unavailable");
  const entryPrice = previousEntry ?? entryCandle?.close ?? latest.close;
  const openedAt = typeof stored?.openedAt === "number" && Number.isSafeInteger(stored.openedAt)
    ? stored.openedAt : lastCandleAt;
  const relevant = candles.filter(({ complete, closeTime }) => complete
    && (openedAt === null || closeTime >= openedAt));
  const peakPrice = relevant.reduce((peak, candle) =>
    decimalCompare(candle.high, peak) > 0 ? candle.high : peak, previousPeak ?? entryPrice);
  const troughPrice = relevant.reduce((trough, candle) =>
    decimalCompare(candle.low, trough) < 0 ? candle.low : trough, previousTrough ?? entryPrice);
  return Object.freeze({
    side: "long",
    ...(openedAt === null ? {} : { entryTime: openedAt }),
    entryPrice,
    peakPrice,
    troughPrice,
    quantity: position.size,
    usedMargin: position.openValue,
    layerCount: 1,
  });
};
const decimalProduct = (left: string, right: string): string => {
  if (!DECIMAL.test(left) || !DECIMAL.test(right)) throw new Error("Invalid decimal");
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = leftFraction.length + rightFraction.length;
  const total = BigInt(leftWhole + leftFraction) * BigInt(rightWhole + rightFraction);
  const digits = total.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -scale)}.${fraction}` : digits.slice(0, -scale);
};

const policy = (value: Record<string, unknown>): RiskPolicy => Object.freeze({
  allowedSymbols: Object.freeze([...(value.allowedSymbols as string[])]),
  maximumOrderNotional: amount(value.maxOrderNotional),
  maximumPositionNotional: amount(value.maxPositionNotional),
  maximumTotalExposure: amount(value.maxTotalExposure),
  maximumSimultaneousPositions: Number(value.maxSimultaneousPositions),
  maximumDailyLoss: amount(value.maxDailyLoss),
  maximumLeverage: amount(value.maxLeverage),
  maximumSlippageBps: String(value.maxSlippageBps),
  minimumSignalCooldownMs: Number(value.minSignalCooldownMs),
  maximumConsecutiveFailures: Number(value.maxConsecutiveFailures),
  maximumPriceAgeMs: 120_000,
});

export class CloudStrategyRuntime {
  readonly #owner = `worker_${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
  readonly #transport = new RateLimitedWeexTransport(createFetchTransport({ timeoutMs: 10_000 }));
  readonly #public = new WeexPublicClient(this.#transport);
  readonly #market = new CloudMarketDataCache(this.#public, () => (this.options.now ?? Date.now)());
  readonly #privateClients = new Map<string, CachedPrivateClient>();
  readonly #privateClientRequests = new Map<string, Promise<CachedPrivateClient>>();
  #clockSample: TimedRequest<{ sentAt: number; receivedAt: number; serverTime: number }> | null = null;
  #active = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #lastTickStartedAt: number | null = null;
  #lastTickDurationMs: number | null = null;
  #lastClaimedAccounts = 0;
  #lastClaimedRuns = 0;

  constructor(private readonly options: {
    repository: CloudRuntimeRepository;
    kms: CredentialEnvelopeKms;
    brokerId: string;
    liveTradingEnabled: boolean;
    now?: () => number;
    accountConcurrency?: number;
    strategyConcurrency?: number;
    tickIntervalMs?: number;
  }) {}

  start(): void {
    if (this.#active) return;
    this.#active = true;
    void this.#tick();
  }

  stop(): void {
    this.#active = false;
    if (this.#timer) clearTimeout(this.#timer);
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      active: this.#active,
      owner: this.#owner,
      lastTickStartedAt: this.#lastTickStartedAt,
      lastTickDurationMs: this.#lastTickDurationMs,
      lastClaimedAccounts: this.#lastClaimedAccounts,
      lastClaimedRuns: this.#lastClaimedRuns,
      privateClientCacheSize: this.#privateClients.size,
      weex: this.#transport.governor.snapshot(),
    });
  }

  async #tick(): Promise<void> {
    if (!this.#active) return;
    const tickStartedAt = (this.options.now ?? Date.now)();
    this.#lastTickStartedAt = tickStartedAt;
    try {
      const accountConcurrency = this.options.accountConcurrency ?? 4;
      const strategyConcurrency = this.options.strategyConcurrency ?? 8;
      const [accounts, runs] = await Promise.all([
        this.options.repository.claimAccountSnapshots(this.#owner, tickStartedAt, Math.max(20, accountConcurrency * 10)),
        this.options.repository.claimRuns(this.#owner, tickStartedAt, Math.max(40, strategyConcurrency * 12)),
      ]);
      this.#lastClaimedAccounts = accounts.length;
      this.#lastClaimedRuns = runs.length;
      await Promise.all([
        mapWithConcurrency(accounts, accountConcurrency, async (account) => {
        try {
          await this.#withLeaseHeartbeat(
            () => this.options.repository.renewAccountLease(
              account,
              this.#owner,
              (this.options.now ?? Date.now)(),
            ),
            () => this.#synchronizeAccount(account),
          );
        }
        catch (error) {
          const failure = error instanceof AccountSyncStageError ? error.cause : error;
          const generic = failure && typeof failure === "object"
            ? failure as { name?: unknown; code?: unknown; constraint_name?: unknown }
            : null;
          const genericCode = typeof generic?.code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(generic.code)
            ? generic.code : null;
          const genericName = typeof generic?.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(generic.name)
            ? generic.name : "Error";
          const constraintName = typeof generic?.constraint_name === "string"
            && /^[a-z][a-z0-9_]{0,127}$/.test(generic.constraint_name)
            ? generic.constraint_name : null;
          const code = failure instanceof WeexApiError
            ? `weex_${failure.category.replace(/[^a-z0-9]+/g, "_")}`
            : genericCode ? `sync_${genericCode.toLowerCase()}` : "account_sync_failed";
          console.warn(JSON.stringify({
            event: "weex_account_sync_failed",
            stage: error instanceof AccountSyncStageError ? error.stage : "unknown",
            category: failure instanceof WeexApiError ? failure.category : "internal",
            name: genericName,
            code: failure instanceof WeexApiError ? failure.code ?? null : genericCode,
            constraint: constraintName,
            status: failure instanceof WeexApiError ? failure.status ?? null : null,
          }));
          await this.options.repository.failAccountProjection(account, this.#owner, code,
            (this.options.now ?? Date.now)()).catch(() => undefined);
        }
        }),
        mapWithConcurrency(runs, strategyConcurrency, async (run) => {
        try {
          await this.#withLeaseHeartbeat(
            () => this.options.repository.renewRunLease(run.id, this.#owner, (this.options.now ?? Date.now)()),
            () => this.#evaluate(run),
          );
        }
        catch (error) {
          const failure = cloudRunFailure(error);
          console.warn(JSON.stringify({
            event: "cloud_strategy_run_failed",
            runId: run.id,
            mode: run.mode,
            lastCandleAt: run.lastCandleAt,
            failureAttempt: run.consecutiveFailures + 1,
            stage: failure.stage,
            category: failure.category,
            name: failure.name,
            code: failure.exchangeCode,
            status: failure.status,
            reason: failure.code,
          }));
          await this.options.repository.fail(run, this.#owner, failure.code,
            (this.options.now ?? Date.now)(), failure.terminal).catch(() => undefined);
        }
        }),
      ]);
    } finally {
      this.#lastTickDurationMs = Math.max(0, (this.options.now ?? Date.now)() - tickStartedAt);
      if (this.#lastClaimedAccounts > 0 || this.#lastClaimedRuns > 0
        || this.#lastTickDurationMs > (this.options.tickIntervalMs ?? 2_000)) {
        console.info(JSON.stringify({
          event: "cloud_runtime_tick",
          durationMs: this.#lastTickDurationMs,
          accounts: this.#lastClaimedAccounts,
          runs: this.#lastClaimedRuns,
          rateLimit: this.#transport.governor.snapshot(),
        }));
      }
      if (this.#active) {
        this.#timer = setTimeout(() => void this.#tick(), this.options.tickIntervalMs ?? 2_000);
      }
    }
  }

  async #withLeaseHeartbeat<T>(
    renew: () => Promise<boolean>,
    operation: () => Promise<T>,
  ): Promise<T> {
    let renewing = false;
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void renew().then((owned) => {
        if (!owned) console.warn(JSON.stringify({ event: "cloud_runtime_lease_lost" }));
      }).catch(() => {
        console.warn(JSON.stringify({ event: "cloud_runtime_lease_heartbeat_failed" }));
      }).finally(() => { renewing = false; });
    }, LEASE_HEARTBEAT_MS);
    timer.unref?.();
    try {
      return await operation();
    } finally {
      clearInterval(timer);
    }
  }

  async #clock(): Promise<WeexClock> {
    const now = (this.options.now ?? Date.now)();
    if (!this.#clockSample || this.#clockSample.expiresAt <= now) {
      const promise = retryWeexRead(async () => {
        const sentAt = (this.options.now ?? Date.now)();
        const probe = await this.#transport.send({
          method: "GET",
          url: CLOCK_PROBE_URL,
          headers: { Accept: "application/json" },
        });
        const receivedAt = (this.options.now ?? Date.now)();
        const serverTime = Date.parse(probe.headers.date ?? "");
        if (!Number.isSafeInteger(serverTime) || receivedAt < sentAt) {
          throw new WeexApiError("WEEX clock is unavailable", { category: "clock", retryable: true });
        }
        return { sentAt, receivedAt, serverTime };
      });
      this.#clockSample = { expiresAt: now + CLOCK_SAMPLE_TTL_MS, promise };
      promise.catch(() => {
        if (this.#clockSample?.promise === promise) this.#clockSample = null;
      });
    }
    const sampleRequest = this.#clockSample;
    const sample = await sampleRequest.promise;
    const clock = new WeexClock(this.options.now ?? Date.now);
    clock.recordServerTime(sample.serverTime, sample.sentAt, sample.receivedAt);
    return clock;
  }

  async #privateClient(connectionId: string, userId: string): Promise<CachedPrivateClient> {
    const cacheKey = `${connectionId}:${userId}`;
    const now = (this.options.now ?? Date.now)();
    const existing = this.#privateClients.get(cacheKey);
    if (existing && existing.expiresAt > now) return existing;
    const pending = this.#privateClientRequests.get(cacheKey);
    if (pending) return pending;
    const request = this.#createPrivateClient(cacheKey, connectionId, userId, now);
    this.#privateClientRequests.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.#privateClientRequests.delete(cacheKey);
    }
  }

  async #createPrivateClient(
    cacheKey: string,
    connectionId: string,
    userId: string,
    now: number,
  ): Promise<CachedPrivateClient> {
    const stored = await this.options.repository.credential(connectionId, userId);
    const credentials = await decryptWeexCredentials({
      envelope: stored.envelope,
      context: stored.context,
      kms: this.options.kms,
    });
    const clock = await this.#clock();
    const entry: CachedPrivateClient = {
      expiresAt: now + PRIVATE_CLIENT_TTL_MS,
      verifications: new Map(),
      snapshots: new Map(),
      client: new WeexPrivateClient({
        transport: this.#transport,
        credentials,
        clock,
        brokerId: this.options.brokerId,
        rulesProvider: async (target, symbol) => ({
          rules: await this.#market.instrumentRules(target.market, symbol),
          verifiedAt: (this.options.now ?? Date.now)(),
        }),
        now: () => Math.floor(clock.now()),
        maximumGetAttempts: SAFE_READ_ATTEMPTS,
      }),
    };
    this.#privateClients.delete(cacheKey);
    while (this.#privateClients.size >= 256) {
      const oldest = this.#privateClients.keys().next().value;
      if (oldest === undefined) break;
      this.#privateClients.delete(oldest);
    }
    this.#privateClients.set(cacheKey, entry);
    return entry;
  }

  async #verifiedAccount(entry: CachedPrivateClient, target: LiveTarget): Promise<VerifiedAccountSummary> {
    const key = `${target.market}:${target.mode}`;
    const now = (this.options.now ?? Date.now)();
    const existing = entry.verifications.get(key);
    if (existing && existing.expiresAt > now) return existing.promise;
    const promise = entry.client.verifyAccount(target);
    entry.verifications.set(key, { expiresAt: now + ACCOUNT_VERIFICATION_TTL_MS, promise });
    promise.catch(() => {
      if (entry.verifications.get(key)?.promise === promise) entry.verifications.delete(key);
    });
    return promise;
  }

  async #accountSnapshot(entry: CachedPrivateClient, target: LiveTarget): Promise<WeexAccountSnapshot> {
    const key = `${target.market}:${target.mode}`;
    const now = (this.options.now ?? Date.now)();
    const existing = entry.snapshots.get(key);
    if (existing && existing.expiresAt > now) return existing.promise;
    const promise = entry.client.getAccountSnapshot(target);
    entry.snapshots.set(key, { expiresAt: now + ACCOUNT_SNAPSHOT_TTL_MS, promise });
    promise.catch(() => {
      if (entry.snapshots.get(key)?.promise === promise) entry.snapshots.delete(key);
    });
    return promise;
  }

  async #synchronizeAccount(account: ClaimedAccountSnapshot): Promise<void> {
    const cached = await this.#privateClient(account.connectionId, account.userId)
      .catch((error: unknown) => { throw new AccountSyncStageError("client", error); });
    const client = cached.client;
    const now = (this.options.now ?? Date.now)();
    if (this.options.liveTradingEnabled && account.permissions.liveVerified !== true) {
      const [spot, futures] = await Promise.allSettled([
        this.#verifiedAccount(cached, { market: "spot", mode: "live" }),
        this.#verifiedAccount(cached, { market: "futures", mode: "live" }),
      ]);
      const spotSummary = spot.status === "fulfilled" ? spot.value : null;
      const futuresSummary = futures.status === "fulfilled" ? futures.value : null;
      if (spotSummary || futuresSummary) {
        const spotReady = spotSummary?.readPermission === true && spotSummary.canTrade === true
          && spotSummary.withdrawalPermission === "absent";
        const futuresReady = futuresSummary?.readPermission === true && futuresSummary.canTrade === true
          && futuresSummary.withdrawalPermission === "absent" && futuresSummary.positionMode === "hedge";
        const withdrawalAbsent = (spotSummary?.withdrawalPermission ?? futuresSummary?.withdrawalPermission) === "absent"
          && spotSummary?.withdrawalPermission !== "present" && futuresSummary?.withdrawalPermission !== "present";
        await this.options.repository.recordConnectionPermissions(account, this.#owner, {
          read: spotSummary?.readPermission === true || futuresSummary?.readPermission === true,
          spotTrade: spotReady,
          futuresTrade: futuresReady,
          withdrawal: !withdrawalAbsent,
          liveVerified: true,
        }, withdrawalAbsent, now);
      }
    }
    const snapshot = await client.getReadOnlyAccountSnapshot({ market: "futures", mode: "live" })
      .catch((error: unknown) => { throw new AccountSyncStageError("snapshot", error); });
    let uid: string | null = null;
    let partialErrorCode: string | undefined;
    try {
      uid = (await client.getAccountIdentity()).uid;
    } catch {
      partialErrorCode = "uid_sync_unavailable";
    }
    const cursor = Math.min(account.tradeCursorAt, now);
    const endTime = Math.min(now, cursor + TRADE_WINDOW_MS);
    let trades: Awaited<ReturnType<WeexPrivateClient["getFuturesTradeHistory"]>> = [];
    let nextTradeCursorAt = cursor;
    try {
      trades = await client.getFuturesTradeHistory({ startTime: cursor, endTime, limit: 100 });
      const last = trades.at(-1);
      nextTradeCursorAt = trades.length === 100 && last
        ? Math.max(cursor, last.tradedAt + 1)
        : endTime + 1;
    } catch {
      partialErrorCode = partialErrorCode ? "partial_account_sync" : "trade_sync_unavailable";
    }
    const balance = snapshot.balances.find(({ asset }) => asset === "USDT") ?? snapshot.balances[0];
    if (!balance || !DECIMAL.test(balance.total) || !DECIMAL.test(balance.available)) {
      throw new AccountSyncStageError("projection", new Error("WEEX account balance is unavailable"));
    }
    await this.options.repository.recordAccountProjection(account, this.#owner, {
      uid,
      observedAt: snapshot.observedAt,
      balances: snapshot.balances,
      positions: snapshot.positions,
      equity: balance.total,
      availableEquity: balance.available,
      unrealizedPnl: decimalSum(snapshot.positions.map(({ unrealizedPnl }) => unrealizedPnl)),
      trades: trades.map((trade) => ({
        ...trade,
        netPnl: decimalSum([trade.realizedPnl, `-${trade.commission}`]),
      })),
      nextTradeCursorAt,
      ...(partialErrorCode ? { partialErrorCode } : {}),
    }).catch((error: unknown) => { throw new AccountSyncStageError("database", error); });
  }

  async #evaluate(run: CloudRun): Promise<void> {
    if (run.mode === "live" && !this.options.liveTradingEnabled) {
      throw new CloudRunExecutionError("live_trading_disabled", "runtime", true);
    }
    const config = createVisualStrategyEvaluator(run.config as unknown as VisualBotConfig).config;
    if (config.market === "spot" && run.mode !== "live") {
      throw new CloudRunExecutionError("unsupported_market_mode", "runtime", true);
    }
    const blockingOrder = await this.options.repository.blockingOrder(run.id, run.lastCandleAt);
    const now = (this.options.now ?? Date.now)();
    const expectedCloseAt = this.#market.expectedCloseAt({
      market: config.market,
      symbol: config.symbol,
      timeframe: config.timeframe,
    }, now);
    if (!blockingOrder && expectedCloseAt <= (run.lastCandleAt ?? -1)) {
      await this.options.repository.release(run.id, this.#owner, now);
      return;
    }
    const candles = await retryWeexRead(() => this.#market.history({
      market: config.market,
      symbol: config.symbol,
      timeframe: config.timeframe,
    }, now));
    const latest = candles.at(-1);
    if (!blockingOrder && (!latest || latest.closeTime <= (run.lastCandleAt ?? -1))) {
      await this.options.repository.release(run.id, this.#owner, (this.options.now ?? Date.now)());
      return;
    }
    const rules = await retryWeexRead(() => this.#market.instrumentRules(config.market, config.symbol));
    const target = config.market === "spot"
      ? { market: "spot" as const, mode: "live" as const }
      : { market: "futures" as const, mode: run.mode };
    const cached = await this.#privateClient(run.connectionId, run.userId);
    const client = cached.client;
    const verification = await this.#verifiedAccount(cached, target);
    if (verification.readPermission !== true) {
      throw new CloudRunExecutionError("live_api_permission_required", "account", true);
    }
    if (blockingOrder) {
      await settleBlockingCloudOrder({
        repository: this.options.repository,
        client,
        run,
        owner: this.#owner,
        order: blockingOrder,
        target,
        symbol: config.symbol,
        now: (this.options.now ?? Date.now)(),
      });
      return;
    }
    if (verification.canTrade !== true) {
      throw new CloudRunExecutionError("live_api_permission_required", "account", true);
    }
    if (verification.withdrawalPermission !== "absent") {
      throw new CloudRunExecutionError("withdrawal_permission_forbidden", "account", true);
    }
    if (config.market === "futures" && run.mode === "live" && verification.positionMode !== "hedge") {
      throw new CloudRunExecutionError("hedge_mode_required", "account", true);
    }
    if (!latest || latest.closeTime <= (run.lastCandleAt ?? -1)) {
      await this.options.repository.release(run.id, this.#owner, (this.options.now ?? Date.now)());
      return;
    }
    const account = await this.#accountSnapshot(cached, target);
    const futuresPositions = account.positions
      .filter((candidate) => candidate.symbol === config.symbol && Number(candidate.size) > 0);
    if (futuresPositions.length > 1) {
      throw new CloudRunExecutionError("ambiguous_position_state", "account", true);
    }
    const futuresPosition = futuresPositions[0];
    const quoteBalance = account.balances.find(({ asset }) => asset === rules.quoteAsset)
      ?? { asset: rules.quoteAsset, total: "0", available: "0", frozen: "0", unrealizedPnl: "0" };
    const baseBalance = account.balances.find(({ asset }) => asset === rules.baseAsset);
    const spotQuantity = baseBalance?.available ?? "0";
    const spotNotional = decimalProduct(baseBalance?.total ?? "0", latest.close);
    const spotPosition = config.market === "spot" && Number(spotQuantity) > 0
      ? {
          asset: rules.baseAsset,
          symbol: config.symbol,
          side: "long" as const,
          leverage: "1",
          size: spotQuantity,
          openValue: spotNotional,
          unrealizedPnl: "0",
          openedAt: null,
          updatedAt: account.observedAt,
        }
      : undefined;
    const position = config.market === "spot" ? spotPosition : futuresPosition;
    if (position && !(await this.options.repository.hasAcknowledgedOrder(run.id))) {
      throw new CloudRunExecutionError("unmanaged_position_state", "account", true);
    }
    const balance = config.market === "spot" ? quoteBalance : requireSettlementBalance(account.balances, run.mode);
    const equity = config.market === "spot"
      ? decimalSum([quoteBalance.total, spotNotional])
      : balance.total;
    if (!DECIMAL.test(equity) || Number(equity) <= 0) {
      throw new CloudRunExecutionError("account_equity_unavailable", "account", true);
    }
    const portfolioPosition = futuresPosition
      ? deriveFuturesPositionSnapshot(futuresPosition, candles)
      : spotPosition
        ? trackedSpotPosition(run.positions, spotPosition, candles, run.lastCandleAt)
        : undefined;
    const recordedPositions = config.market === "spot"
      ? (spotPosition && portfolioPosition ? [{ ...spotPosition, ...portfolioPosition }] : [])
      : account.positions.filter(({ size }) => Number(size) > 0);
    await this.options.repository.recordAccountSnapshot(run, this.#owner, {
      asset: balance.asset,
      observedAt: account.observedAt,
      equity,
      availableEquity: balance.available,
      unrealizedPnl: config.market === "spot" ? "0" : decimalSum(account.positions.map(({ unrealizedPnl }) => unrealizedPnl)),
      positions: recordedPositions,
    });
    const utcDay = new Date(account.observedAt).toISOString().slice(0, 10);
    const dayStartAt = Date.parse(`${utcDay}T00:00:00.000Z`);
    const realizedDailyPnl = await this.options.repository.realizedPnl(
      run.userId,
      run.connectionId,
      dayStartAt,
      account.observedAt,
    );
    const unrealizedDailyPnl = config.market === "spot"
      ? "0"
      : decimalSum(account.positions.map(({ unrealizedPnl }) => unrealizedPnl));
    const dayStartEquity = await this.options.repository.dayStartEquity(
      run.id,
      this.#owner,
      utcDay,
      equity,
      account.observedAt,
    );
    const portfolio: StrategyPortfolioSnapshot = Object.freeze({
      equity, dayStartEquity, availableEquity: balance?.available, utcDay,
      ...(portfolioPosition ? { position: portfolioPosition } : {}),
    });
    const evaluator = createVisualStrategyEvaluator(config);
    const signal = await evaluator.evaluate({ candles, market: config.market, symbol: config.symbol,
      timeframe: config.timeframe, leverage: String(config.leverage), now: account.observedAt, portfolio });
    if (signal.action === "hold") {
      await this.options.repository.complete(run, this.#owner, latest.closeTime, signal, account.observedAt);
      return;
    }
    const currentNotional = position?.openValue ?? "0";
    const context: RiskContext = Object.freeze({ market: config.market, symbol: config.symbol, now: account.observedAt,
      priceTimestamp: latest.closeTime, lastSignalAt: run.lastEvaluatedAt, openPositions: recordedPositions.length,
      positionSide: position?.side ?? "flat", currentPositionQuantity: position?.size ?? "0",
      currentPositionNotional: currentNotional,
      totalExposure: config.market === "spot" ? currentNotional : decimalSum(account.positions.map(({ openValue }) => openValue)),
      realizedDailyPnl,
      unrealizedDailyPnl,
      consecutiveFailures: run.consecutiveFailures, leverage: String(config.leverage) });
    const riskPolicy = policy(run.risk);
    const intent = await new SignalIntentNormalizer().normalize(signal, {
      deploymentId: run.id, configurationVersion: `v${run.version}`, signalSequence: latest.closeTime,
      market: config.market, mode: run.mode, referencePrice: latest.close, riskPolicy, riskContext: context,
      instrumentRules: rules, now: account.observedAt,
    });
    const decision = evaluateOrderRisk(riskPolicy, context, intent, rules);
    const clientOrderId = await deriveClientOrderId({
      deploymentId: run.id,
      configurationVersion: run.configurationHash,
      signalId: "cloud-candle",
      sequence: latest.closeTime,
      brokerId: this.options.brokerId,
    });
    const claim = await this.options.repository.claimOrder({
      runId: run.id,
      candleCloseAt: latest.closeTime,
      clientOrderId,
      signal,
      intent,
      now: account.observedAt,
    });
    if (claim.status !== "claimed" && claim.status !== "unknown") {
      await this.options.repository.complete(run, this.#owner, latest.closeTime, signal, account.observedAt);
      return;
    }
    await executeCloudOrder({
      repository: this.options.repository,
      client,
      run,
      owner: this.#owner,
      candleCloseAt: latest.closeTime,
      signal,
      intent,
      decision,
      claim,
      target,
      symbol: config.symbol,
      now: account.observedAt,
    });
  }
}
