import {
  ExecutionCoordinator,
  SignalIntentNormalizer,
  evaluateOrderRisk,
  type CancelOpenOrdersResult,
  type ExecutionContext,
  type ExecutionOutcome,
  type ExchangeOrderSnapshot,
  type ExchangeFillSnapshot,
  reconcileOrder,
  type InstrumentRules,
  type OrderRepository,
  type VisualBotConfig,
} from "@cryptobot-labs/trading-core";
import type { WeexExecutionClient } from "@cryptobot-labs/weex-client";

import type { RuntimeAuditEvent } from "../runtime/execution-runtime";
import { StrategyWorker } from "../runtime/strategy-worker";
import type { ConnectionRegistry } from "./connections";
import type { DeploymentBundle } from "./deployment-client";
import { createLiveRuntime } from "./live-runtime";
import type { ClockFreshnessGuard, MarketStreamState } from "./market-stream";
import { RunManager, type RunAuditEvent, type RunEvaluationRequest, type RunEvaluationResult } from "./run-manager";

export interface LiveRunRunnerOptions {
  readonly repository: OrderRepository;
  readonly client: WeexExecutionClient;
  readonly market: Pick<MarketStreamState, "requireFresh">;
  readonly clock: Pick<ClockFreshnessGuard, "requireFresh">;
  readonly connection: Pick<ConnectionRegistry, "requireFresh">;
  readonly instruments: { requireFresh(market: "spot" | "futures", symbol: string, now: number): Readonly<InstrumentRules> };
  readonly runtimeAudit: (event: RuntimeAuditEvent) => void | Promise<void>;
  readonly runAudit: (event: RunAuditEvent) => void | Promise<void>;
  readonly createStrategyWorker?: () => StrategyWorker;
  readonly onReconciledOrder?: (order: Parameters<OrderRepository["save"]>[0], snapshot: ExchangeOrderSnapshot) => void | Promise<void>;
  readonly now?: () => number;
}

type LiveRuntime = ReturnType<typeof createLiveRuntime>;
interface LiveSession {
  readonly mode: "live" | "futures-demo";
  readonly manager: RunManager;
  readonly coordinator: LiveRuntime["coordinator"];
  readonly exchange: LiveRuntime["exchange"];
  readonly closer: Pick<ExecutionCoordinator, "propose">;
}
export interface ReconciledOrderEvidence {
  readonly order: Parameters<OrderRepository["save"]>[0];
  readonly fills: readonly ExchangeFillSnapshot[];
}

/** Owns one fail-closed private-exchange session; deployment activation remains a separate local gate. */
export class LiveRunRunner {
  readonly #options: LiveRunRunnerOptions;
  readonly #now: () => number;
  #session: LiveSession | null = null;
  #transitioning = false;

  constructor(options: LiveRunRunnerOptions) { this.#options = options; this.#now = options.now ?? Date.now; }
  get status() { return this.#session?.manager.status ?? "idle"; }

  async resume(bundle: DeploymentBundle): Promise<void> {
    if (this.#transitioning || this.#session) throw new Error("Live runner is already active");
    const mode = bundle.deployment.mode;
    const supportedMode = mode === "live" || (mode === "futures-demo" && bundle.strategy.market === "futures");
    if (!supportedMode || bundle.strategy.config === null || bundle.risk === null
      || !bundle.risk.allowedSymbols.includes(bundle.strategy.symbol)) throw new Error("Live runner requires a complete live deployment");
    const now = this.#timestamp();
    const target = mode === "futures-demo"
      ? { market: "futures" as const, mode }
      : { market: bundle.strategy.market, mode };
    this.#options.connection.requireFresh(target, now);
    this.#options.clock.requireFresh(now);
    this.#options.market.requireFresh(bundle.strategy.market, bundle.strategy.symbol, now, 60_000);
    this.#options.instruments.requireFresh(bundle.strategy.market, bundle.strategy.symbol, now);
    const configuredSource = (bundle.strategy.config as { source?: unknown }).source;
    if ((bundle.strategy.source === null && configuredSource !== undefined)
      || (bundle.strategy.source !== null && configuredSource !== bundle.strategy.source)) {
      throw new Error("Live runner strategy source is inconsistent");
    }
    this.#transitioning = true;
    try {
      const session = this.#createSession(bundle);
      session.manager.start({ deployment: { deploymentId: bundle.deployment.id,
        configurationVersion: `v${bundle.deployment.version}`,
        scriptHash: bundle.strategy.sourceHash ?? bundle.strategy.configHash,
        source: bundle.strategy.source ?? "visual" }, mode,
      market: bundle.strategy.market, symbol: bundle.strategy.symbol });
      this.#session = session;
    } finally { this.#transitioning = false; }
  }

  async pause(): Promise<void> {
    if (this.#transitioning) throw new Error("Live runner lifecycle transition is active");
    const session = this.#session; if (!session) return;
    this.#transitioning = true;
    try { await session.manager.stop(this.#timestamp()); this.#session = null; }
    finally { this.#transitioning = false; }
  }

  evaluate(request: RunEvaluationRequest): Promise<RunEvaluationResult> {
    return this.#session?.manager.evaluate(request) ?? Promise.resolve({ status: "paused", reason: "inactive" });
  }

  async reconcileActiveOrders(deploymentId: string, symbol: string): Promise<
    | { readonly ready: true; readonly evidence: readonly ReconciledOrderEvidence[] }
    | { readonly ready: false; readonly reason: string }
  > {
    const session = this.#session;
    if (!session) return { ready: false, reason: "live-runner-inactive" };
    const active = await this.#options.repository.listActive(deploymentId, symbol);
    const evidence: ReconciledOrderEvidence[] = [];
    for (const order of active) {
      if (order.status === "proposed") continue;
      const snapshot = await session.exchange.findByClientOrderId({ target: order.executionTarget,
        symbol: order.approvedIntent.symbol, clientOrderId: order.clientOrderId,
        exchangeOrderId: order.exchangeOrderId });
      if (!snapshot) return { ready: false, reason: "live-order-unresolved" };
      const result = reconcileOrder({ local: order, snapshot, at: Math.max(this.#timestamp(), order.updatedAt) });
      if (result.resolution !== "resolved") return { ready: false, reason: "live-order-unresolved" };
      evidence.push(Object.freeze({ order: result.state, fills: Object.freeze([...(snapshot.fills ?? [])]) }));
      await this.#options.onReconciledOrder?.(result.state, snapshot);
      if (result.state !== order) await this.#options.repository.save(result.state, order.version);
    }
    return { ready: true, evidence: Object.freeze(evidence) };
  }

  async cancelOpenOrders(deploymentId: string): Promise<CancelOpenOrdersResult> {
    if (!this.#session) throw new Error("Live runner is inactive");
    return this.#session.coordinator.cancelOpenOrders(deploymentId, this.#timestamp());
  }

  stopNewOrders(): void {
    const session = this.#session;
    if (!session) throw new Error("Live runner is inactive");
    session.coordinator.emergencyStop();
  }

  closePosition(context: ExecutionContext, signalId: string): Promise<ExecutionOutcome> {
    const session = this.#session;
    if (!session || context.mode !== session.mode || context.riskContext.positionSide === "flat") {
      throw new Error("A verified private-exchange position is required");
    }
    return session.closer.propose(Object.freeze({ id: signalId, action: "close", reason: "manual-close-positions",
      createdAt: context.now }), context);
  }

  #createSession(bundle: DeploymentBundle): LiveSession {
    const config = { ...(bundle.strategy.config as VisualBotConfig), source: undefined };
    const live = createLiveRuntime({ config, source: bundle.strategy.source,
      ...(bundle.strategy.source === null ? {} : { worker: this.#options.createStrategyWorker?.() ?? new StrategyWorker() }),
      repository: this.#options.repository, client: this.#options.client, audit: this.#options.runtimeAudit });
    const closer = new ExecutionCoordinator({ normalizer: new SignalIntentNormalizer(), riskEvaluator: evaluateOrderRisk,
      repository: this.#options.repository, exchange: live.exchange, circuitBreaker: live.circuitBreaker,
      failureClassifier: () => "unknown" });
    const reconciliation = { reconcileBeforeSubmit: (input: { deploymentId: string; symbol: string }) =>
      this.reconcileActiveOrders(input.deploymentId, input.symbol) };
    const manager = new RunManager({ runtime: live.runtime, market: this.#options.market, clock: this.#options.clock,
      connection: this.#options.connection, instruments: this.#options.instruments, reconciliation,
      circuitBreaker: live.circuitBreaker, audit: this.#options.runAudit });
    return { mode: bundle.deployment.mode as "live" | "futures-demo",
      manager, coordinator: live.coordinator, exchange: live.exchange, closer };
  }

  #timestamp(): number {
    const value = this.#now(); if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid live runner clock"); return value;
  }
}
