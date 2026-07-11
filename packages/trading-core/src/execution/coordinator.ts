import type { ExecutionMode, StrategySignal } from "../contracts";
import {
  createTrackedOrder,
  deriveClientOrderId,
  transitionOrder,
  type SubmitOutcome,
} from "../orders";
import { StrategySignalSchema } from "../schemas";
import type {
  ExecutionContext,
  ExecutionCoordinatorDependencies,
  ExecutionOutcome,
} from "./types";

export const MAX_PENDING = 1_024;

function parseSignal(signal: StrategySignal): StrategySignal {
  const parsed = StrategySignalSchema.safeParse(signal);
  if (!parsed.success) throw new TypeError("invalid strategy signal");
  return parsed.data;
}

function isSubmitOutcome(value: unknown): value is SubmitOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const outcome = value as Record<string, unknown>;
  if (outcome.status === "acknowledged") {
    return typeof outcome.exchangeOrderId === "string" && outcome.exchangeOrderId.length > 0;
  }
  if (outcome.status === "rejected") {
    return typeof outcome.reason === "string" && outcome.reason.trim().length > 0;
  }
  return outcome.status === "unknown" &&
    (outcome.reason === undefined || typeof outcome.reason === "string");
}

export class ExecutionCoordinator {
  readonly #dependencies: ExecutionCoordinatorDependencies;
  readonly #inFlight = new Map<string, Promise<ExecutionOutcome>>();
  #stopped = false;
  #pending = 0;

  constructor(dependencies: ExecutionCoordinatorDependencies) {
    this.#dependencies = dependencies;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  get pending(): number {
    return this.#pending;
  }

  emergencyStop(): void {
    this.#stopped = true;
  }

  resumePaper(mode: ExecutionMode): boolean {
    if (mode !== "paper") return false;
    this.#stopped = false;
    return true;
  }

  async propose(
    candidateSignal: StrategySignal,
    context: ExecutionContext,
  ): Promise<ExecutionOutcome> {
    const signal = parseSignal(candidateSignal);
    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };

    const clientOrderId = await deriveClientOrderId({
      deploymentId: context.deploymentId,
      configurationVersion: context.configurationVersion,
      signalId: signal.id,
      sequence: context.signalSequence,
    });

    const active = this.#inFlight.get(clientOrderId);
    if (active !== undefined) {
      await active;
      const order = await this.#dependencies.repository.getByClientOrderId(clientOrderId);
      if (order === null) throw new Error("completed proposal was not persisted");
      return { status: "idempotent", order };
    }

    const existing = await this.#dependencies.repository.getByClientOrderId(clientOrderId);
    if (existing !== null) return { status: "idempotent", order: existing };

    const raced = this.#inFlight.get(clientOrderId);
    if (raced !== undefined) {
      await raced;
      const order = await this.#dependencies.repository.getByClientOrderId(clientOrderId);
      if (order === null) throw new Error("completed proposal was not persisted");
      return { status: "idempotent", order };
    }
    if (this.#pending >= MAX_PENDING) return { status: "blocked", reason: "queue-full" };

    const work = this.#execute(signal, context, clientOrderId);
    this.#inFlight.set(clientOrderId, work);
    this.#pending += 1;
    try {
      return await work;
    } finally {
      this.#pending -= 1;
      this.#inFlight.delete(clientOrderId);
    }
  }

  async #execute(
    signal: StrategySignal,
    context: ExecutionContext,
    clientOrderId: string,
  ): Promise<ExecutionOutcome> {
    const intent = await this.#dependencies.normalizer.normalize(signal, context);
    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };

    let order = createTrackedOrder({
      deploymentId: context.deploymentId,
      clientOrderId,
      approvedIntent: intent,
      at: context.now,
    });
    order = await this.#dependencies.repository.save(order, null);

    const risk = this.#dependencies.riskEvaluator(
      context.riskPolicy,
      context.riskContext,
      intent,
      context.instrumentRules,
    );
    if (!risk.allowed) {
      order = transitionOrder(order, {
        type: "risk-rejected",
        reason: risk.reason,
        at: context.now,
      });
      order = await this.#dependencies.repository.save(order, order.version - 1);
      return { status: "risk-rejected", order };
    }

    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
    const conflicts = await this.#dependencies.repository.listActive(
      context.deploymentId,
      intent.symbol,
    );
    if (conflicts.length > 0) {
      return { status: "blocked", reason: "active-order-conflict" };
    }
    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };

    const acquisition = this.#dependencies.circuitBreaker.tryAcquire(context.now);
    if (!acquisition.allowed) return { status: "blocked", reason: "circuit-breaker" };

    order = transitionOrder(order, { type: "submit-start", at: context.now });
    order = await this.#dependencies.repository.save(order, order.version - 1);
    if (this.#stopped) {
      order = transitionOrder(order, { type: "submit-timeout", at: context.now });
      await this.#dependencies.repository.save(order, order.version - 1);
      this.#dependencies.circuitBreaker.recordFailure(
        acquisition.token,
        "unknown",
        context.now,
      );
      return { status: "blocked", reason: "emergency-stop" };
    }

    let submitResult: unknown;
    try {
      submitResult = await this.#dependencies.exchange.submit(order.approvedIntent);
      if (!isSubmitOutcome(submitResult)) throw new TypeError("malformed submit outcome");

      if (submitResult.status === "acknowledged") {
        order = transitionOrder(order, {
          type: "submit-acknowledged",
          exchangeOrderId: submitResult.exchangeOrderId,
          at: context.now,
        });
        this.#dependencies.circuitBreaker.recordSuccess(acquisition.token, context.now);
      } else if (submitResult.status === "rejected") {
        order = transitionOrder(order, {
          type: "submit-rejected",
          reason: submitResult.reason,
          at: context.now,
        });
        this.#dependencies.circuitBreaker.recordSuccess(acquisition.token, context.now);
      } else {
        order = transitionOrder(order, { type: "submit-timeout", at: context.now });
        this.#dependencies.circuitBreaker.recordFailure(
          acquisition.token,
          this.#dependencies.failureClassifier(submitResult),
          context.now,
        );
      }
    } catch (failure) {
      order = transitionOrder(order, { type: "submit-timeout", at: context.now });
      this.#dependencies.circuitBreaker.recordFailure(
        acquisition.token,
        this.#dependencies.failureClassifier(failure),
        context.now,
      );
    }

    order = await this.#dependencies.repository.save(order, order.version - 1);
    return { status: "submitted", order };
  }
}
