import type {
  ExecutionContext,
  ExecutionCoordinator,
  ExecutionOutcome,
  StrategyInput,
} from "@cryptobot-labs/trading-core";
import {
  StrategyWorker,
  StrategyWorkerFault,
  type StrategyWorkerRequest,
} from "./strategy-worker";

export interface RuntimeDeployment {
  readonly deploymentId: string;
  readonly configurationVersion: string;
  readonly scriptHash: string;
  readonly source: string;
}

export interface RuntimeEvaluationRequest {
  readonly input: Readonly<StrategyInput>;
  readonly now: number;
  readonly randomSeed: string;
  readonly context: ExecutionContext;
}

export type RuntimeAuditEvent = Readonly<{
  type: "signal-proposed" | "signal-discarded" | "strategy-paused";
  deploymentId: string;
  configurationVersion: string;
  scriptHash: string;
  at: number;
  reason: string;
}>;

export type RuntimeEvaluationOutcome =
  | { readonly status: "proposed"; readonly outcome: ExecutionOutcome }
  | { readonly status: "discarded"; readonly reason: "inactive" | "stale" }
  | { readonly status: "paused"; readonly reason: string };

export interface ExecutionRuntimeDependencies {
  readonly worker: StrategyWorker;
  readonly coordinator: Pick<ExecutionCoordinator, "propose">;
  readonly audit: (event: RuntimeAuditEvent) => void | Promise<void>;
}

/** Trusted bridge from a signal-only sandbox to the mandatory risk coordinator. */
export class ExecutionRuntime {
  readonly #worker: StrategyWorker;
  readonly #coordinator: Pick<ExecutionCoordinator, "propose">;
  readonly #audit: ExecutionRuntimeDependencies["audit"];
  #deployment: RuntimeDeployment | null = null;
  #epoch = 0;
  #tail: Promise<void> = Promise.resolve();
  #pausedReason: string | null = null;

  constructor(dependencies: ExecutionRuntimeDependencies) {
    this.#worker = dependencies.worker;
    this.#coordinator = dependencies.coordinator;
    this.#audit = dependencies.audit;
  }

  get paused(): boolean {
    return this.#pausedReason !== null;
  }

  start(deployment: RuntimeDeployment): void {
    if (!deployment.deploymentId || !deployment.configurationVersion ||
        !deployment.scriptHash || !deployment.source) {
      throw new TypeError("invalid runtime deployment");
    }
    this.#epoch += 1;
    this.#deployment = Object.freeze({ ...deployment });
    this.#pausedReason = null;
  }

  evaluate(request: RuntimeEvaluationRequest): Promise<RuntimeEvaluationOutcome> {
    const deployment = this.#deployment;
    const epoch = this.#epoch;
    if (deployment === null) {
      return Promise.resolve({ status: "discarded", reason: "inactive" });
    }
    if (this.#pausedReason !== null) {
      return Promise.resolve({ status: "paused", reason: this.#pausedReason });
    }
    const work = this.#tail.then(() => this.#evaluate(deployment, epoch, request));
    this.#tail = work.then(() => undefined, () => undefined);
    return work;
  }

  async stop(): Promise<void> {
    this.#epoch += 1;
    this.#deployment = null;
    this.#pausedReason = null;
    await this.#worker.cancel();
  }

  async dispose(): Promise<void> {
    this.#epoch += 1;
    this.#deployment = null;
    this.#pausedReason = "disposed";
    await this.#worker.dispose();
  }

  async #evaluate(
    deployment: RuntimeDeployment,
    epoch: number,
    request: RuntimeEvaluationRequest,
  ): Promise<RuntimeEvaluationOutcome> {
    if (!this.#isCurrent(deployment, epoch)) {
      return { status: "discarded", reason: "stale" };
    }
    if (request.context.deploymentId !== deployment.deploymentId ||
        request.context.configurationVersion !== deployment.configurationVersion) {
      await this.#auditSafely(deployment, request.now, "signal-discarded", "context-version-mismatch");
      return { status: "discarded", reason: "stale" };
    }
    if (!this.#matchesExecutionContext(request)) {
      await this.#auditSafely(
        deployment,
        request.context.now,
        "signal-discarded",
        "context-input-mismatch",
      );
      return { status: "discarded", reason: "stale" };
    }

    const workerRequest: StrategyWorkerRequest = {
      source: deployment.source,
      input: request.input,
      now: request.now,
      randomSeed: request.randomSeed,
    };

    let result: Awaited<ReturnType<StrategyWorker["evaluate"]>>;
    try {
      result = await this.#worker.evaluate(workerRequest);
    } catch (failure) {
      if (!this.#isCurrent(deployment, epoch) ||
          (failure instanceof StrategyWorkerFault && failure.code === "cancelled")) {
        return { status: "discarded", reason: "stale" };
      }
      return this.#pause(deployment, request.now, "sandbox-fault");
    }

    if (!this.#isCurrent(deployment, epoch)) {
      await this.#auditSafely(deployment, request.now, "signal-discarded", "stale-result");
      return { status: "discarded", reason: "stale" };
    }
    if (result.scriptHash !== deployment.scriptHash) {
      return this.#pause(deployment, request.now, "script-hash-mismatch");
    }

    try {
      // This is the only path by which a sandbox signal can leave the runtime.
      const outcome = await this.#coordinator.propose(result.signal, request.context);
      if (!this.#isCurrent(deployment, epoch)) {
        await this.#auditSafely(deployment, request.now, "signal-discarded", "stale-proposal-result");
        return { status: "discarded", reason: "stale" };
      }
      await this.#auditSafely(
        deployment,
        request.now,
        "signal-proposed",
        `${result.signal.reason}:${outcome.status}`.slice(0, 256),
      );
      return { status: "proposed", outcome };
    } catch {
      return this.#pause(deployment, request.now, "execution-coordinator-fault");
    }
  }

  #isCurrent(deployment: RuntimeDeployment, epoch: number): boolean {
    return this.#epoch === epoch && this.#deployment === deployment && this.#pausedReason === null;
  }

  #matchesExecutionContext(request: RuntimeEvaluationRequest): boolean {
    const { context, input, now } = request;
    const riskContext = context.riskContext;
    return typeof riskContext === "object" && riskContext !== null &&
      input.market === context.market &&
      input.symbol === riskContext.symbol &&
      input.now === context.now &&
      now === context.now &&
      riskContext.market === context.market &&
      riskContext.now === context.now &&
      (input.leverage === undefined || input.leverage === riskContext.leverage);
  }

  async #pause(
    deployment: RuntimeDeployment,
    at: number,
    reason: string,
  ): Promise<RuntimeEvaluationOutcome> {
    if (this.#deployment === deployment) this.#pausedReason = reason;
    await this.#auditSafely(deployment, at, "strategy-paused", reason);
    return { status: "paused", reason };
  }

  async #auditSafely(
    deployment: RuntimeDeployment,
    at: number,
    type: RuntimeAuditEvent["type"],
    reason: string,
  ): Promise<void> {
    try {
      await this.#audit({
        type,
        deploymentId: deployment.deploymentId,
        configurationVersion: deployment.configurationVersion,
        scriptHash: deployment.scriptHash,
        at,
        reason: reason.slice(0, 256),
      });
    } catch {
      // Audit transport cannot cause an unreviewed retry or bypass the coordinator.
    }
  }
}
