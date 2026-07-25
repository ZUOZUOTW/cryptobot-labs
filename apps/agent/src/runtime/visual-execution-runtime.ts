import type { ExecutionCoordinator, VisualStrategyEvaluator } from "@cryptobot-labs/trading-core";

import type {
  RuntimeAuditEvent,
  RuntimeDeployment,
  RuntimeEvaluationOutcome,
  RuntimeEvaluationRequest,
} from "./execution-runtime";

export interface VisualExecutionRuntimeDependencies {
  readonly evaluator: VisualStrategyEvaluator;
  readonly coordinator: Pick<ExecutionCoordinator, "propose">;
  readonly audit: (event: RuntimeAuditEvent) => void | Promise<void>;
}

/** Trusted visual evaluator bridge; signals can leave only through ExecutionCoordinator. */
export class VisualExecutionRuntime {
  readonly #dependencies: VisualExecutionRuntimeDependencies;
  #deployment: RuntimeDeployment | null = null;
  #epoch = 0;
  #tail: Promise<void> = Promise.resolve();
  #pausedReason: string | null = null;

  constructor(dependencies: VisualExecutionRuntimeDependencies) { this.#dependencies = dependencies; }

  start(deployment: RuntimeDeployment): void {
    if (!deployment.deploymentId || !deployment.configurationVersion || !deployment.scriptHash) {
      throw new TypeError("invalid visual runtime deployment");
    }
    this.#epoch += 1; this.#deployment = Object.freeze({ ...deployment }); this.#pausedReason = null;
  }

  evaluate(request: RuntimeEvaluationRequest): Promise<RuntimeEvaluationOutcome> {
    const deployment = this.#deployment, epoch = this.#epoch;
    if (!deployment) return Promise.resolve({ status: "discarded", reason: "inactive" });
    if (this.#pausedReason) return Promise.resolve({ status: "paused", reason: this.#pausedReason });
    const work = this.#tail.then(() => this.#evaluate(deployment, epoch, request));
    this.#tail = work.then(() => undefined, () => undefined); return work;
  }

  async stop(): Promise<void> { this.#epoch += 1; this.#deployment = null; this.#pausedReason = null; }

  async #evaluate(deployment: RuntimeDeployment, epoch: number, request: RuntimeEvaluationRequest): Promise<RuntimeEvaluationOutcome> {
    if (!this.#current(deployment, epoch) || request.context.deploymentId !== deployment.deploymentId ||
        request.context.configurationVersion !== deployment.configurationVersion || request.input.now !== request.now ||
        request.context.now !== request.now || request.input.market !== request.context.market ||
        request.input.symbol !== request.context.riskContext.symbol) return { status: "discarded", reason: "stale" };
    let signal;
    try { signal = await this.#dependencies.evaluator.evaluate(request.input); }
    catch { return this.#pause(deployment, request.now, "visual-evaluator-fault"); }
    if (!this.#current(deployment, epoch)) return { status: "discarded", reason: "stale" };
    if (signal.action === "hold") {
      await this.#audit(deployment, request.now, "signal-discarded", signal.reason);
      return { status: "discarded", reason: "hold" };
    }
    try {
      const outcome = await this.#dependencies.coordinator.propose(signal, request.context);
      if (!this.#current(deployment, epoch)) return { status: "discarded", reason: "stale" };
      await this.#audit(deployment, request.now, "signal-proposed", `${signal.reason}:${outcome.status}`,
        { signal, outcome, symbol: request.input.symbol });
      return { status: "proposed", outcome };
    } catch { return this.#pause(deployment, request.now, "execution-coordinator-fault"); }
  }

  #current(deployment: RuntimeDeployment, epoch: number): boolean {
    return this.#deployment === deployment && this.#epoch === epoch && this.#pausedReason === null;
  }

  async #pause(deployment: RuntimeDeployment, at: number, reason: string): Promise<RuntimeEvaluationOutcome> {
    if (this.#deployment === deployment) this.#pausedReason = reason;
    await this.#audit(deployment, at, "strategy-paused", reason); return { status: "paused", reason };
  }

  async #audit(deployment: RuntimeDeployment, at: number, type: RuntimeAuditEvent["type"], reason: string,
    details: Pick<RuntimeAuditEvent, "signal" | "outcome" | "symbol"> = {}): Promise<void> {
    try { await this.#dependencies.audit({ type, deploymentId: deployment.deploymentId,
      configurationVersion: deployment.configurationVersion, scriptHash: deployment.scriptHash,
      at, reason: reason.slice(0, 256), ...details }); } catch { /* Audit transport cannot alter trading state. */ }
  }
}
