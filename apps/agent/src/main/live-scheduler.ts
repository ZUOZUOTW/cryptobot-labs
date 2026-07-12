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
  readonly runner: Pick<LiveRunRunner, "resume" | "pause" | "evaluate" | "reconcileActiveOrders">;
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

/** Runs one credential-isolated live evaluation per completed candle and fails closed on any uncertainty. */
export class LiveScheduler {
  readonly #options: LiveSchedulerOptions;
  #bundle: DeploymentBundle | null = null;
  #state: LiveStatePort | null = null;
  #active = false;
  #busy = false;
  #timer: unknown = null;

  constructor(options: LiveSchedulerOptions) { this.#options = options; }

  async resume(bundle: DeploymentBundle): Promise<void> {
    if (this.#bundle || bundle.deployment.mode !== "live" || bundle.risk === null
      || bundle.risk.operationMode !== "automatic" || bundle.strategy.config === null) {
      throw new Error("Live scheduler cannot prepare this deployment");
    }
    await this.#options.runner.resume(bundle);
    this.#bundle = bundle; this.#state = this.#options.state(bundle.deployment.id);
  }

  async activate(): Promise<void> {
    if (!this.#bundle || !this.#state || this.#active) throw new Error("Live scheduler is not prepared");
    this.#active = true;
    try { await this.#tick(); this.#scheduleNext(); }
    catch (error) { await this.#fault("live-evaluation-failed"); throw error; }
  }

  async pause(): Promise<void> {
    this.#active = false; this.#cancelTimer();
    await this.#options.runner.pause(); this.#bundle = null; this.#state = null;
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
      const reconciliation = await this.#options.runner.reconcileActiveOrders(bundle.deployment.id, bundle.strategy.symbol);
      if (!reconciliation.ready) throw new Error(reconciliation.reason);
      const orders = (await this.#options.orders.listForDeployment(bundle.deployment.id, bundle.strategy.symbol))
        .filter((order) => order.executionTarget.mode === "live" && order.executionTarget.market === bundle.strategy.market);
      let local = await state.snapshot(); let account: LiveAccountEvidence | null = null; let baselineAt = 0;
      if (!local) {
        if (orders.length) throw new Error("Live state is missing for existing orders");
        account = await this.#options.account.collect({ target: { market: bundle.strategy.market, mode: "live" },
          rules: market.rules, referencePrice: quote.last, priceTimestamp: quote.exchangeTimestamp,
          configuredLeverage: String(config.leverage), local: localEvidence(null) });
        this.#options.connection.refresh(account.connectionVerifiedAt);
        await state.initialize({ deploymentId: bundle.deployment.id, market: bundle.strategy.market,
          symbol: bundle.strategy.symbol, dayStartEquity: account.portfolio.equity, now: account.observedAt });
        baselineAt = account.observedAt;
        local = await state.snapshot();
        if (!local) throw new Error("Live state initialization failed");
      }
      await state.mark(quote.last, Math.max(market.collectedAt, baselineAt));
      for (const order of orders) {
        if (order.status === "filled" || (order.status === "cancelled" && order.cumulativeFilledQuantity !== "0")) {
          await state.applyFill(order, Math.max(market.collectedAt, order.updatedAt));
        }
      }
      if (orders.some((order) => PENDING_ORDER.has(order.status))) return;
      local = await state.snapshot(); if (!local) throw new Error("Live state is unavailable");
      if (local.lastEvaluatedCloseTime !== null && latest.closeTime <= local.lastEvaluatedCloseTime) return;
      account ??= await this.#options.account.collect({ target: { market: bundle.strategy.market, mode: "live" },
        rules: market.rules, referencePrice: quote.last, priceTimestamp: quote.exchangeTimestamp,
        configuredLeverage: String(config.leverage), local: localEvidence(local) });
      this.#options.connection.refresh(account.connectionVerifiedAt);
      if (account.portfolio.utcDay !== local.utcDay) {
        await state.rollDay(account.portfolio.equity, account.observedAt);
        account = withDayStart(account, account.portfolio.equity);
      }
      const request = buildLiveEvaluationRequest({ bundle, market, quote, account,
        signalSequence: local.nextSignalSequence });
      const result = await this.#options.runner.evaluate(request);
      const signaled = result.status === "proposed";
      if (result.status === "proposed" && (result.outcome.status === "submitted" || result.outcome.status === "idempotent")
        && (result.outcome.order.status === "filled" || (result.outcome.order.status === "cancelled"
          && result.outcome.order.cumulativeFilledQuantity !== "0"))) {
        await state.applyFill(result.outcome.order, Math.max(account.observedAt, result.outcome.order.updatedAt));
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
    this.#bundle = null; this.#state = null;
    if (bundle) await this.#options.onFault(reason, bundle);
  }

  #cancelTimer(): void {
    if (this.#timer === null) return;
    if (this.#options.cancel) this.#options.cancel(this.#timer);
    else clearTimeout(this.#timer as ReturnType<typeof setTimeout>);
    this.#timer = null;
  }
}
