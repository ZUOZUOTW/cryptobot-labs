import type { ExecutionMode, StrategySignal } from "../contracts";
import {
  createTrackedOrder,
  deriveClientOrderId,
  transitionOrder,
  type ApprovedOrderIntent,
  type SubmitOutcome,
  type TrackedOrder,
} from "../orders";
import type { CircuitBreakerFailureCategory } from "../reliability";
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

function sameIntent(left: ApprovedOrderIntent, right: ApprovedOrderIntent): boolean {
  return left.symbol === right.symbol &&
    left.side === right.side &&
    left.quantity === right.quantity &&
    left.price === right.price &&
    left.expectedSlippageBps === right.expectedSlippageBps &&
    left.reduceOnly === right.reduceOnly;
}

class BreakerSettlement {
  #settled = false;
  readonly #dependencies: ExecutionCoordinatorDependencies;
  readonly #token: string;
  readonly #now: number;

  constructor(
    dependencies: ExecutionCoordinatorDependencies,
    token: string,
    now: number,
  ) {
    this.#dependencies = dependencies;
    this.#token = token;
    this.#now = now;
  }

  get settled(): boolean {
    return this.#settled;
  }

  success(): boolean {
    if (this.#settled) return false;
    this.#settled = true;
    try {
      return this.#dependencies.circuitBreaker.recordSuccess(this.#token, this.#now);
    } catch {
      return false;
    }
  }

  failure(category: CircuitBreakerFailureCategory): boolean {
    if (this.#settled) return false;
    this.#settled = true;
    try {
      return this.#dependencies.circuitBreaker.recordFailure(
        this.#token,
        category,
        this.#now,
      );
    } catch {
      return false;
    }
  }
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
    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
    const signal = parseSignal(candidateSignal);
    if (this.#pending >= MAX_PENDING) return { status: "blocked", reason: "queue-full" };
    this.#pending += 1;

    try {
      const intent = await this.#dependencies.normalizer.normalize(signal, context);
      if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };

      const clientOrderId = await deriveClientOrderId({
        deploymentId: context.deploymentId,
        configurationVersion: context.configurationVersion,
        signalId: signal.id,
        sequence: context.signalSequence,
      });
      if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };

      const existing = await this.#dependencies.repository.getByClientOrderId(clientOrderId);
      if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
      if (existing !== null) {
        return sameIntent(existing.approvedIntent, intent)
          ? { status: "idempotent", order: existing }
          : { status: "blocked", reason: "client-order-id-collision" };
      }

      const active = this.#inFlight.get(clientOrderId);
      if (active !== undefined) {
        const completed = await active;
        if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
        if (completed.status === "blocked") return completed;
        const order = await this.#dependencies.repository.getByClientOrderId(clientOrderId);
        if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
        if (order === null) throw new Error("completed proposal was not persisted");
        return sameIntent(order.approvedIntent, intent)
          ? { status: "idempotent", order }
          : { status: "blocked", reason: "client-order-id-collision" };
      }

      const work = this.#execute(context, clientOrderId, intent);
      this.#inFlight.set(clientOrderId, work);
      try {
        return await work;
      } finally {
        this.#inFlight.delete(clientOrderId);
      }
    } finally {
      this.#pending -= 1;
    }
  }

  async #execute(
    context: ExecutionContext,
    clientOrderId: string,
    intent: ApprovedOrderIntent,
  ): Promise<ExecutionOutcome> {
    const conflicts = await this.#dependencies.repository.listActive(
      context.deploymentId,
      intent.symbol,
    );
    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
    if (conflicts.length > 0) return { status: "blocked", reason: "active-order-conflict" };
    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };

    let order = createTrackedOrder({
      deploymentId: context.deploymentId,
      clientOrderId,
      approvedIntent: intent,
      at: context.now,
    });
    try {
      order = await this.#dependencies.repository.save(order, null);
    } catch (createFailure) {
      if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
      const raced = await this.#dependencies.repository.getByClientOrderId(clientOrderId);
      if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
      if (raced === null) throw createFailure;
      return sameIntent(raced.approvedIntent, intent)
        ? { status: "idempotent", order: raced }
        : { status: "blocked", reason: "client-order-id-collision" };
    }
    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };

    const risk = await this.#dependencies.riskEvaluator(
      context.riskPolicy,
      context.riskContext,
      intent,
      context.instrumentRules,
    );
    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
    if (!risk.allowed) {
      order = transitionOrder(order, {
        type: "risk-rejected",
        reason: risk.reason,
        at: context.now,
      });
      order = await this.#dependencies.repository.save(order, order.version - 1);
      if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
      return { status: "risk-rejected", order };
    }

    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
    const acquisition = this.#dependencies.circuitBreaker.tryAcquire(context.now);
    if (!acquisition.allowed) return { status: "blocked", reason: "circuit-breaker" };
    const settlement = new BreakerSettlement(
      this.#dependencies,
      acquisition.token,
      context.now,
    );

    try {
      if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
      order = transitionOrder(order, { type: "submit-start", at: context.now });
      order = await this.#dependencies.repository.save(order, order.version - 1);
      if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
    } catch (failure) {
      settlement.failure("unknown");
      throw failure;
    } finally {
      if (this.#stopped && !settlement.settled) settlement.failure("unknown");
    }

    try {
      const submitResult = await this.#dependencies.exchange.submit(order.approvedIntent);
      if (!isSubmitOutcome(submitResult)) throw new TypeError("malformed submit outcome");

      const failureCategory = submitResult.status === "unknown"
        ? this.#classifyFailure(submitResult)
        : null;
      order = submitResult.status === "acknowledged"
        ? transitionOrder(order, {
            type: "submit-acknowledged",
            exchangeOrderId: submitResult.exchangeOrderId,
            at: context.now,
          })
        : submitResult.status === "rejected"
          ? transitionOrder(order, {
              type: "submit-rejected",
              reason: submitResult.reason,
              at: context.now,
            })
          : transitionOrder(order, { type: "submit-timeout", at: context.now });

      order = await this.#dependencies.repository.save(order, order.version - 1);
      const settled = failureCategory === null
        ? settlement.success()
        : settlement.failure(failureCategory);
      if (!settled) {
        const persisted = await this.#persistUnknown(order, context.now);
        if (persisted === null) return this.#persistenceFailed();
        order = persisted;
      }
      return { status: "submitted", order };
    } catch (failure) {
      const persisted = await this.#persistUnknown(order, context.now);
      settlement.failure(this.#classifyFailure(failure));
      if (persisted === null) return this.#persistenceFailed();
      order = persisted;
      return { status: "submitted", order };
    } finally {
      if (!settlement.settled) settlement.failure("unknown");
    }
  }

  #classifyFailure(failure: unknown): CircuitBreakerFailureCategory {
    try {
      return this.#dependencies.failureClassifier(failure);
    } catch {
      return "unknown";
    }
  }

  #persistenceFailed(): ExecutionOutcome {
    this.emergencyStop();
    return { status: "persistence-failed", reason: "unknown-order-not-persisted" };
  }

  async #persistUnknown(order: TrackedOrder, at: number): Promise<TrackedOrder | null> {
    let base: TrackedOrder | null;
    try {
      base = await this.#dependencies.repository.getByClientOrderId(order.clientOrderId);
    } catch {
      return null;
    }
    if (base === null || !sameIntent(base.approvedIntent, order.approvedIntent)) return null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (base.status === "unknown" || base.status !== "submitting") {
        return base.status === "proposed" ? null : base;
      }
      const uncertain = transitionOrder(base, { type: "submit-timeout", at });
      try {
        return await this.#dependencies.repository.save(uncertain, base.version);
      } catch {
        if (attempt === 1) return null;
        try {
          base = await this.#dependencies.repository.getByClientOrderId(order.clientOrderId);
        } catch {
          return null;
        }
        if (base === null || !sameIntent(base.approvedIntent, order.approvedIntent)) return null;
      }
    }
    return null;
  }
}
