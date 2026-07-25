import {
  reconcileOrder,
  type InstrumentRules,
  type OrderRepository,
  type VisualBotConfig,
} from "@cryptobot-labs/trading-core";

import type { RuntimeAuditEvent } from "../runtime/execution-runtime";
import { StrategyWorker } from "../runtime/strategy-worker";
import type { DeploymentBundle } from "./deployment-client";
import type { ClockFreshnessGuard, MarketStreamState } from "./market-stream";
import { createPaperRuntime } from "./paper-runtime";
import { RunManager, type RunAuditEvent, type RunEvaluationRequest, type RunEvaluationResult } from "./run-manager";

export interface PaperRunRunnerOptions {
  readonly repository: OrderRepository;
  readonly market: Pick<MarketStreamState, "requireFresh">;
  readonly clock: Pick<ClockFreshnessGuard, "requireFresh">;
  readonly instruments: { requireFresh(market: "spot" | "futures", symbol: string, now: number): Readonly<InstrumentRules> };
  readonly runtimeAudit: (event: RuntimeAuditEvent) => void | Promise<void>;
  readonly runAudit: (event: RunAuditEvent) => void | Promise<void>;
  readonly createStrategyWorker?: () => StrategyWorker;
  readonly now?: () => number;
}

type PaperRuntime = ReturnType<typeof createPaperRuntime>;
interface PaperSession {
  readonly manager: RunManager;
  readonly coordinator: PaperRuntime["coordinator"];
  readonly exchange: PaperRuntime["exchange"];
}

/** Owns one fail-closed Paper RunManager session for the desktop agent. */
export class PaperRunRunner {
  readonly #options: PaperRunRunnerOptions;
  readonly #now: () => number;
  #session: PaperSession | null = null;
  #transitioning = false;

  constructor(options: PaperRunRunnerOptions) { this.#options = options; this.#now = options.now ?? Date.now; }

  get status() { return this.#session?.manager.status ?? "idle"; }

  async resume(bundle: DeploymentBundle): Promise<void> {
    if (this.#transitioning || this.#session) throw new Error("Paper runner is already active");
    if (bundle.deployment.mode !== "paper" || bundle.strategy.config === null || bundle.risk === null) {
      throw new Error("Paper runner requires a complete paper deployment");
    }
    const configuredSource = (bundle.strategy.config as { source?: unknown }).source;
    if ((bundle.strategy.source === null && configuredSource !== undefined)
      || (bundle.strategy.source !== null && configuredSource !== bundle.strategy.source)) {
      throw new Error("Paper runner strategy source is inconsistent");
    }
    this.#transitioning = true;
    try {
      const session = this.#createSession(bundle);
      session.manager.start({ deployment: { deploymentId: bundle.deployment.id,
        configurationVersion: `v${bundle.deployment.version}`,
        scriptHash: bundle.strategy.sourceHash ?? bundle.strategy.configHash,
        source: bundle.strategy.source ?? "visual" },
      mode: "paper", market: bundle.strategy.market, symbol: bundle.strategy.symbol });
      this.#session = session;
    } finally { this.#transitioning = false; }
  }

  async pause(): Promise<void> {
    if (this.#transitioning) throw new Error("Paper runner lifecycle transition is active");
    const session = this.#session;
    if (!session) return;
    this.#transitioning = true;
    try { await session.manager.stop(this.#timestamp()); this.#session = null; }
    finally { this.#transitioning = false; }
  }

  evaluate(request: RunEvaluationRequest): Promise<RunEvaluationResult> {
    return this.#session?.manager.evaluate(request) ?? Promise.resolve({ status: "paused", reason: "inactive" });
  }

  async cancelOpenOrders(deploymentId: string): Promise<unknown> {
    const session = this.#session;
    if (!session) throw new Error("Paper runner is inactive");
    return session.coordinator.cancelOpenOrders(deploymentId, this.#timestamp());
  }

  #createSession(bundle: DeploymentBundle): PaperSession {
    const config = { ...(bundle.strategy.config as VisualBotConfig), source: undefined };
    const paper = createPaperRuntime({ config, source: bundle.strategy.source,
      ...(bundle.strategy.source === null ? {} : { worker: this.#options.createStrategyWorker?.() ?? new StrategyWorker() }),
      repository: this.#options.repository, audit: this.#options.runtimeAudit });
    const reconciliation = { reconcileBeforeSubmit: async (input: { deploymentId: string; symbol: string }) => {
      const active = await this.#options.repository.listActive(input.deploymentId, input.symbol);
      for (const order of active) {
        if (order.status === "proposed") continue;
        const snapshot = await paper.exchange.findByClientOrderId({ target: order.executionTarget,
          symbol: order.approvedIntent.symbol, clientOrderId: order.clientOrderId,
          exchangeOrderId: order.exchangeOrderId });
        if (!snapshot) return { ready: false as const, reason: "paper-order-unresolved" };
        const result = reconcileOrder({ local: order, snapshot, at: Math.max(this.#timestamp(), order.updatedAt) });
        if (result.resolution !== "resolved") return { ready: false as const, reason: "paper-order-unresolved" };
        if (result.state !== order) await this.#options.repository.save(result.state, order.version);
      }
      return { ready: true as const };
    } };
    const manager = new RunManager({ runtime: paper.runtime, market: this.#options.market, clock: this.#options.clock,
      connection: { requireFresh() { throw new Error("Paper mode has no private connection"); } },
      instruments: this.#options.instruments, reconciliation, circuitBreaker: paper.circuitBreaker,
      audit: this.#options.runAudit });
    return { manager, coordinator: paper.coordinator, exchange: paper.exchange };
  }

  #timestamp(): number {
    const value = this.#now(); if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid runner clock"); return value;
  }
}
