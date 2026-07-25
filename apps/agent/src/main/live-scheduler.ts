import { parseIntervalMs } from "@cryptobot-labs/weex-client";
import type { TrackedOrder } from "@cryptobot-labs/trading-core";

import type { DeploymentBundle } from "./deployment-client";
import type { ConnectionRegistry } from "./connections";
import { buildLiveEvaluationRequest } from "./live-evaluation-context";
import type { createLiveAccountService, LiveAccountEvidence } from "./live-account-service";
import type { LiveRunRunner } from "./live-run-runner";
import type { DurableLiveState, LiveLocalSnapshot } from "./live-state";
import type { MarketStreamState } from "./market-stream";
import type { PublicMarketService } from "./public-market-service";

type LiveStatePort = Pick<DurableLiveState,
  "initialize" | "snapshot" | "mark" | "rollDay" | "applyFill" | "completeEvaluation">;

export interface LiveSchedulerOptions {
  readonly collector: Pick<PublicMarketService, "collect">;
  readonly market: Pick<MarketStreamState, "requireFresh">;
  readonly account: Pick<ReturnType<typeof createLiveAccountService>, "collect">;
  readonly connection: Pick<ConnectionRegistry, "refresh">;
  readonly state: (deploymentId: string) => LiveStatePort;
  readonly orders: { listForDeployment(deploymentId: string, symbol?: string): Promise<readonly TrackedOrder[]> };
  readonly runner: Pick<LiveRunRunner,
    "resume" | "pause" | "evaluate" | "reconcileActiveOrders" | "stopNewOrders" | "cancelOpenOrders" | "closePosition">;
  readonly onActivated?: (bundle: DeploymentBundle) => void | Promise<void>;
  readonly onOrder?: (order: TrackedOrder, bundle: DeploymentBundle) => void | Promise<void>;
  readonly onHeartbeat?: (evidence: LiveAccountEvidence, markPrice: string, bundle: DeploymentBundle,
    sequence: number, health: "healthy" | "paused") => void | Promise<void>;
  readonly onFault: (reason: string, bundle: DeploymentBundle) => void | Promise<void>;
  readonly schedule?: (work: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

const localEvidence = (snapshot: LiveLocalSnapshot | null) => snapshot ? {
  lastSignalAt: snapshot.lastSignalAt,
  realizedDailyPnl: snapshot.realizedDailyPnl,
  consecutiveFailures: snapshot.consecutiveFailures,
  dayStartEquity: snapshot.dayStartEquity,
  ...(snapshot.position ? { position: snapshot.position } : {}),
} : { lastSignalAt: null, realizedDailyPnl: "0", consecutiveFailures: 0, dayStartEquity: null };

function withDayStart(evidence: LiveAccountEvidence, dayStartEquity: string): LiveAccountEvidence {
  return Object.freeze({ ...evidence, portfolio: Object.freeze({ ...evidence.portfolio, dayStartEquity }),
    risk: Object.freeze({ ...evidence.risk, realizedDailyPnl: "0" }) });
}

const PENDING_ORDER = new Set(["submitting", "acknowledged", "partially-filled", "cancel-pending", "unknown", "reconciled"]);

type PrivateTarget =
  | { readonly market: "spot" | "futures"; readonly mode: "live" }
  | { readonly market: "futures"; readonly mode: "futures-demo" };

function privateTarget(bundle: DeploymentBundle): PrivateTarget {
  if (bundle.deployment.mode === "live") {
    return { market: bundle.strategy.market, mode: "live" };
  }
  if (bundle.deployment.mode === "futures-demo" && bundle.strategy.market === "futures") {
    return { market: "futures", mode: "futures-demo" };
  }
  throw new Error("Private scheduler requires a supported exchange deployment");
}

/** Runs one credential-isolated live evaluation per completed candle and fails closed on any uncertainty. */
export class LiveScheduler {
  readonly #options: LiveSchedulerOptions;
  #bundle: DeploymentBundle | null = null;
  #state: LiveStatePort | null = null;
  #active = false;
  #newOrdersStopped = false;
  #busy = false;
  #timer: unknown = null;
  #heartbeatAt = -1;
  #heartbeatOrdinal = 0;

  constructor(options: LiveSchedulerOptions) { this.#options = options; }

  async resume(bundle: DeploymentBundle): Promise<void> {
    if (this.#bundle || bundle.risk === null
      || bundle.risk.operationMode !== "automatic" || bundle.strategy.config === null) {
      throw new Error("Live scheduler cannot prepare this deployment");
    }
    privateTarget(bundle);
    await this.#options.runner.resume(bundle);
    this.#bundle = bundle; this.#state = this.#options.state(bundle.deployment.id); this.#newOrdersStopped = false;
  }

  async activate(): Promise<void> {
    if (!this.#bundle || !this.#state || this.#active) throw new Error("Live scheduler is not prepared");
    this.#active = true;
    try { await this.#options.onActivated?.(this.#bundle); await this.#tick(); this.#scheduleNext(); }
    catch (error) { await this.#fault("live-evaluation-failed"); throw error; }
  }

  async pause(): Promise<void> {
    this.#active = false; this.#cancelTimer();
    await this.#options.runner.pause(); this.#bundle = null; this.#state = null;
  }

  stopNewOrders(deploymentId: string): void {
    if (!this.#bundle || this.#bundle.deployment.id !== deploymentId || !this.#active) throw new Error("Live scheduler is inactive");
    this.#newOrdersStopped = true;
    this.#options.runner.stopNewOrders();
  }

  async cancelOpenOrders(deploymentId: string) {
    this.stopNewOrders(deploymentId);
    return this.#options.runner.cancelOpenOrders(deploymentId);
  }

  async closePositions(deploymentId: string, symbol: string | null, commandId: string): Promise<
    | { readonly closed: 0; readonly reason: "flat" | "risk-rejected" }
    | { readonly closed: 1; readonly order: TrackedOrder }
  > {
    const bundle = this.#bundle; const state = this.#state;
    if (!bundle || !state || !this.#active || bundle.deployment.id !== deploymentId
      || (symbol !== null && symbol !== bundle.strategy.symbol)) throw new Error("Live scheduler close fence failed");
    this.stopNewOrders(deploymentId);
    const cancelled = await this.#options.runner.cancelOpenOrders(deploymentId);
    if (cancelled.rejected > 0 || cancelled.unresolved > 0) throw new Error("Live order cancellation is unresolved");
    const config = bundle.strategy.config as { timeframe?: unknown; leverage?: unknown };
    if (typeof config.timeframe !== "string" || (typeof config.leverage !== "number" && typeof config.leverage !== "string")) {
      throw new Error("Live close strategy configuration is invalid");
    }
    const market = await this.#options.collector.collect({ market: bundle.strategy.market,
      symbol: bundle.strategy.symbol, timeframe: config.timeframe });
    const quote = this.#options.market.requireFresh(bundle.strategy.market, bundle.strategy.symbol, market.collectedAt, 60_000);
    const reconciliation = await this.#options.runner.reconcileActiveOrders(deploymentId, bundle.strategy.symbol);
    if (!reconciliation.ready) throw new Error(reconciliation.reason);
    const fillsByOrder = new Map(reconciliation.evidence.map((item) => [item.order.clientOrderId, item.fills] as const));
    const target = privateTarget(bundle);
    const orders = (await this.#options.orders.listForDeployment(deploymentId, bundle.strategy.symbol))
      .filter((order) => order.executionTarget.mode === target.mode && order.executionTarget.market === target.market);
    await state.mark(quote.last, market.collectedAt);
    for (const order of orders) {
      await this.#options.onOrder?.(order, bundle);
      if (order.status === "filled" || (order.status === "cancelled" && order.cumulativeFilledQuantity !== "0")) {
        await state.applyFill(order, Math.max(market.collectedAt, order.updatedAt), fillsByOrder.get(order.clientOrderId));
      }
    }
    if (orders.some((order) => PENDING_ORDER.has(order.status) || order.status === "proposed")) {
      throw new Error("Live orders remain active after cancellation");
    }
    const local = await state.snapshot(); if (!local) throw new Error("Live state is unavailable");
    let account = await this.#options.account.collect({ target,
      rules: market.rules, referencePrice: quote.last, priceTimestamp: quote.exchangeTimestamp,
      configuredLeverage: String(config.leverage), local: localEvidence(local) });
    this.#options.connection.refresh(account.connectionVerifiedAt);
    if (account.portfolio.utcDay !== local.utcDay) {
      await state.rollDay(account.portfolio.equity, account.observedAt);
      account = withDayStart(account, account.portfolio.equity);
    }
    await this.#options.onHeartbeat?.(account, quote.last, bundle, this.#heartbeatSequence(account.observedAt), "paused");
    if (account.risk.positionSide === "flat") return { closed: 0, reason: "flat" };
    const request = buildLiveEvaluationRequest({ bundle, market, quote, account,
      signalSequence: local.nextSignalSequence });
    const outcome = await this.#options.runner.closePosition(request.context, `close-${commandId}`);
    if (outcome.status === "submitted" || outcome.status === "idempotent") {
      await this.#options.onOrder?.(outcome.order, bundle); return { closed: 1, order: outcome.order };
    }
    if (outcome.status === "risk-rejected") {
      await this.#options.onOrder?.(outcome.order, bundle); return { closed: 0, reason: "risk-rejected" };
    }
    throw new Error(`Live close was not submitted: ${outcome.reason}`);
  }

  async #tick(): Promise<void> {
    const bundle = this.#bundle; const state = this.#state;
    if (!this.#active || !bundle || !state || this.#busy) return;
    this.#busy = true;
    try {
      const config = bundle.strategy.config as { timeframe?: unknown; leverage?: unknown };
      if (typeof config.timeframe !== "string" || (typeof config.leverage !== "number" && typeof config.leverage !== "string")) {
        throw new Error("Live strategy schedule is invalid");
      }
      const market = await this.#options.collector.collect({ market: bundle.strategy.market,
        symbol: bundle.strategy.symbol, timeframe: config.timeframe });
      const latest = market.candles.at(-1); if (!latest) throw new Error("Live market snapshot has no candle");
      const quote = this.#options.market.requireFresh(bundle.strategy.market, bundle.strategy.symbol, market.collectedAt, 60_000);
      const target = privateTarget(bundle);
      const reconciliation = await this.#options.runner.reconcileActiveOrders(bundle.deployment.id, bundle.strategy.symbol);
      if (!reconciliation.ready) throw new Error(reconciliation.reason);
      const fillsByOrder = new Map(reconciliation.evidence.map((item) => [item.order.clientOrderId, item.fills] as const));
      const orders = (await this.#options.orders.listForDeployment(bundle.deployment.id, bundle.strategy.symbol))
        .filter((order) => order.executionTarget.mode === target.mode && order.executionTarget.market === target.market);
      for (const order of orders) await this.#options.onOrder?.(order, bundle);
      let local = await state.snapshot(); let account: LiveAccountEvidence | null = null; let baselineAt = 0;
      if (!local) {
        if (orders.length) throw new Error("Live state is missing for existing orders");
        account = await this.#options.account.collect({ target,
          rules: market.rules, referencePrice: quote.last, priceTimestamp: quote.exchangeTimestamp,
          configuredLeverage: String(config.leverage), local: localEvidence(null) });
        this.#options.connection.refresh(account.connectionVerifiedAt);
        await state.initialize({ deploymentId: bundle.deployment.id, mode: target.mode, market: bundle.strategy.market,
          symbol: bundle.strategy.symbol, dayStartEquity: account.portfolio.equity, now: account.observedAt });
        baselineAt = account.observedAt;
        local = await state.snapshot();
        if (!local) throw new Error("Live state initialization failed");
      }
      await state.mark(quote.last, Math.max(market.collectedAt, baselineAt));
      for (const order of orders) {
        if (order.status === "filled" || (order.status === "cancelled" && order.cumulativeFilledQuantity !== "0")) {
          await state.applyFill(order, Math.max(market.collectedAt, order.updatedAt), fillsByOrder.get(order.clientOrderId));
        }
      }
      if (orders.some((order) => PENDING_ORDER.has(order.status))) return;
      local = await state.snapshot(); if (!local) throw new Error("Live state is unavailable");
      account ??= await this.#options.account.collect({ target,
        rules: market.rules, referencePrice: quote.last, priceTimestamp: quote.exchangeTimestamp,
        configuredLeverage: String(config.leverage), local: localEvidence(local) });
      this.#options.connection.refresh(account.connectionVerifiedAt);
      if (account.portfolio.utcDay !== local.utcDay) {
        await state.rollDay(account.portfolio.equity, account.observedAt);
        account = withDayStart(account, account.portfolio.equity);
      }
      await this.#options.onHeartbeat?.(account, quote.last, bundle, this.#heartbeatSequence(account.observedAt),
        this.#newOrdersStopped ? "paused" : "healthy");
      if (local.lastEvaluatedCloseTime !== null && latest.closeTime <= local.lastEvaluatedCloseTime) return;
      if (this.#newOrdersStopped) return;
      const request = buildLiveEvaluationRequest({ bundle, market, quote, account,
        signalSequence: local.nextSignalSequence });
      const result = await this.#options.runner.evaluate(request);
      const signaled = result.status === "proposed";
      if (result.status === "proposed" && (result.outcome.status === "submitted" || result.outcome.status === "idempotent")) {
        await this.#options.onOrder?.(result.outcome.order, bundle);
      }
      await state.completeEvaluation({ closeTime: latest.closeTime,
        at: Math.max(account.observedAt, result.status === "proposed" && (result.outcome.status === "submitted"
          || result.outcome.status === "idempotent") ? result.outcome.order.updatedAt : account.observedAt),
        signaled, failed: result.status === "paused" });
      if (result.status === "paused") throw new Error(result.reason);
    } finally { this.#busy = false; }
  }

  #scheduleNext(): void {
    const bundle = this.#bundle; if (!this.#active || !bundle) return;
    const interval = parseIntervalMs(String((bundle.strategy.config as { timeframe?: unknown }).timeframe));
    const delay = Math.max(5_000, Math.min(60_000, Math.floor(interval / 4)));
    this.#timer = (this.#options.schedule ?? setTimeout)(() => { this.#timer = null;
      void this.#tick().then(() => this.#scheduleNext()).catch(() => this.#fault("live-evaluation-failed")); }, delay);
  }

  async #fault(reason: string): Promise<void> {
    const bundle = this.#bundle; this.#active = false; this.#cancelTimer();
    await this.#options.runner.pause().catch(() => undefined);
    this.#bundle = null; this.#state = null; this.#newOrdersStopped = true;
    if (bundle) await this.#options.onFault(reason, bundle);
  }

  #cancelTimer(): void {
    if (this.#timer === null) return;
    if (this.#options.cancel) this.#options.cancel(this.#timer);
    else clearTimeout(this.#timer as ReturnType<typeof setTimeout>);
    this.#timer = null;
  }

  #heartbeatSequence(observedAt: number): number {
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error("Invalid heartbeat time");
    if (observedAt === this.#heartbeatAt) this.#heartbeatOrdinal += 1;
    else { this.#heartbeatAt = observedAt; this.#heartbeatOrdinal = 0; }
    const sequence = observedAt * 1_000 + this.#heartbeatOrdinal;
    if (!Number.isSafeInteger(sequence)) throw new Error("Heartbeat sequence overflow");
    return sequence;
  }
}
