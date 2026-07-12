import {
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
  readonly now?: () => number;
}

type LiveRuntime = ReturnType<typeof createLiveRuntime>;
interface LiveSession { readonly manager: RunManager; readonly coordinator: LiveRuntime["coordinator"]; }

/** Owns one fail-closed live session; deployment activation remains a separate local gate. */
export class LiveRunRunner {
  readonly #options: LiveRunRunnerOptions;
  readonly #now: () => number;
  #session: LiveSession | null = null;
  #transitioning = false;

  constructor(options: LiveRunRunnerOptions) { this.#options = options; this.#now = options.now ?? Date.now; }
  get status() { return this.#session?.manager.status ?? "idle"; }

  async resume(bundle: DeploymentBundle): Promise<void> {
    if (this.#transitioning || this.#session) throw new Error("Live runner is already active");
    if (bundle.deployment.mode !== "live" || bundle.strategy.config === null || bundle.risk === null
      || !bundle.risk.allowedSymbols.includes(bundle.strategy.symbol)) throw new Error("Live runner requires a complete live deployment");
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
        source: bundle.strategy.source ?? "visual" }, mode: "live",
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

  async cancelOpenOrders(deploymentId: string): Promise<unknown> {
    if (!this.#session) throw new Error("Live runner is inactive");
    return this.#session.coordinator.cancelOpenOrders(deploymentId, this.#timestamp());
  }

  #createSession(bundle: DeploymentBundle): LiveSession {
    const config = { ...(bundle.strategy.config as VisualBotConfig), source: undefined };
    const live = createLiveRuntime({ config, source: bundle.strategy.source,
      ...(bundle.strategy.source === null ? {} : { worker: this.#options.createStrategyWorker?.() ?? new StrategyWorker() }),
      repository: this.#options.repository, client: this.#options.client, audit: this.#options.runtimeAudit });
    const reconciliation = { reconcileBeforeSubmit: async (input: { deploymentId: string; symbol: string }) => {
      const active = await this.#options.repository.listActive(input.deploymentId, input.symbol);
      for (const order of active) {
        if (order.status === "proposed") continue;
        const snapshot = await live.exchange.findByClientOrderId({ target: order.executionTarget,
          symbol: order.approvedIntent.symbol, clientOrderId: order.clientOrderId,
          exchangeOrderId: order.exchangeOrderId });
        if (!snapshot) return { ready: false as const, reason: "live-order-unresolved" };
        const result = reconcileOrder({ local: order, snapshot, at: Math.max(this.#timestamp(), order.updatedAt) });
        if (result.resolution !== "resolved") return { ready: false as const, reason: "live-order-unresolved" };
        if (result.state !== order) await this.#options.repository.save(result.state, order.version);
      }
      return { ready: true as const };
    } };
    const manager = new RunManager({ runtime: live.runtime, market: this.#options.market, clock: this.#options.clock,
      connection: this.#options.connection, instruments: this.#options.instruments, reconciliation,
      circuitBreaker: live.circuitBreaker, audit: this.#options.runAudit });
    return { manager, coordinator: live.coordinator };
  }

  #timestamp(): number {
    const value = this.#now(); if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid live runner clock"); return value;
  }
}
