import type { ExecutionMode, StrategySignal } from "../contracts";
import {
  createTrackedOrder,
  deriveClientOrderId,
  transitionOrder,
  type ApprovedOrderIntent,
  type CancelOutcome,
  type OrderQuery,
  type SubmitOutcome,
  type TrackedOrder,
} from "../orders";
import type { CircuitBreakerFailureCategory } from "../reliability";
import { StrategySignalSchema } from "../schemas";
import type {
  ExecutionContext,
  ExecutionCoordinatorDependencies,
  ExecutionOutcome,
  CancelOpenOrdersResult,
  ProposalClaim,
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

function isCancelOutcome(value: unknown): value is CancelOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const outcome = value as Record<string, unknown>;
  const keys = Object.keys(outcome);
  if (outcome.status === "cancelled") return keys.length === 1;
  if (outcome.status === "rejected") {
    return keys.length === 2 &&
      typeof outcome.reason === "string" && outcome.reason.trim().length > 0 &&
      outcome.reason.length <= 256;
  }
  if (outcome.status !== "unknown") return false;
  return (keys.length === 1 || keys.length === 2) &&
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

function sameTrackedOrder(left: TrackedOrder, right: TrackedOrder): boolean {
  return left.deploymentId === right.deploymentId &&
    left.clientOrderId === right.clientOrderId &&
    left.exchangeOrderId === right.exchangeOrderId &&
    sameIntent(left.approvedIntent, right.approvedIntent);
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

  async cancelOpenOrders(
    deploymentId: string,
    now: number,
  ): Promise<CancelOpenOrdersResult> {
    if (typeof deploymentId !== "string" || deploymentId.length === 0) {
      throw new TypeError("invalid deployment id");
    }
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("invalid timestamp");

    const result = { cancelled: 0, rejected: 0, unresolved: 0, skipped: 0 };
    const orders = await this.#dependencies.repository.listActive(deploymentId);
    for (const candidate of orders) {
      if (candidate.deploymentId !== deploymentId) {
        result.skipped += 1;
        continue;
      }
      const claim = await this.#claimCancellation(candidate, now);
      if (claim.status === "skipped") {
        result.skipped += 1;
        continue;
      }
      if (claim.status === "unresolved") {
        result.unresolved += 1;
        continue;
      }

      const pending = claim.order;
      const query: OrderQuery = {
        symbol: pending.approvedIntent.symbol,
        clientOrderId: pending.clientOrderId,
        ...(pending.exchangeOrderId === undefined
          ? {}
          : { exchangeOrderId: pending.exchangeOrderId }),
      };
      let outcome: CancelOutcome;
      try {
        const candidateOutcome = await this.#dependencies.exchange.cancel(query);
        if (!isCancelOutcome(candidateOutcome)) {
          await this.#preserveCancelPending(pending, now);
          result.unresolved += 1;
          continue;
        }
        outcome = candidateOutcome;
      } catch {
        // The request may have reached the exchange. Keep cancel-pending and never retry.
        await this.#preserveCancelPending(pending, now);
        result.unresolved += 1;
        continue;
      }

      if (outcome.status === "unknown") {
        await this.#preserveCancelPending(pending, now);
        result.unresolved += 1;
        continue;
      }
      const persisted = await this.#persistCancelResult(pending, outcome, now);
      if (persisted === null) {
        result.unresolved += 1;
      } else if (outcome.status === "cancelled" && persisted.status === "cancelled") {
        result.cancelled += 1;
      } else if (outcome.status === "rejected") {
        result.rejected += 1;
      } else {
        result.skipped += 1;
      }
    }
    return Object.freeze(result);
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
        if (!sameIntent(existing.approvedIntent, intent)) {
          return { status: "blocked", reason: "client-order-id-collision" };
        }
        if (existing.status !== "proposed") return { status: "idempotent", order: existing };
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

      const work = this.#execute(
        context,
        clientOrderId,
        intent,
        existing?.status === "proposed" ? existing : null,
      );
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
    existingProposal: TrackedOrder | null,
  ): Promise<ExecutionOutcome> {
    const conflicts = await this.#dependencies.repository.listActive(
      context.deploymentId,
      intent.symbol,
    );
    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
    if (conflicts.some((order) => order.clientOrderId !== clientOrderId)) {
      return { status: "blocked", reason: "active-order-conflict" };
    }
    if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };

    let order: TrackedOrder;
    if (existingProposal !== null) {
      order = existingProposal;
    } else {
      const proposal = createTrackedOrder({
        deploymentId: context.deploymentId,
        clientOrderId,
        approvedIntent: intent,
        at: context.now,
      });
      let claim: ProposalClaim;
      try {
        claim = await this.#dependencies.repository.claim(proposal);
      } catch (claimFailure) {
        if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
        throw claimFailure;
      }
      if (this.#stopped) return { status: "blocked", reason: "emergency-stop" };
      if (!claim.claimed) {
        if (claim.reason === "active-order-conflict") {
          return { status: "blocked", reason: "active-order-conflict" };
        }
        if (!sameIntent(claim.order.approvedIntent, intent)) {
          return { status: "blocked", reason: "client-order-id-collision" };
        }
        if (claim.order.status !== "proposed") {
          return { status: "idempotent", order: claim.order };
        }
        order = claim.order;
      } else {
        order = claim.order;
      }
    }

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
      try {
        const winner = await this.#dependencies.repository.getByClientOrderId(clientOrderId);
        if (
          winner !== null &&
          winner.status !== "proposed" &&
          sameIntent(winner.approvedIntent, intent)
        ) {
          settlement.success();
          return { status: "idempotent", order: winner };
        }
      } catch {
        // Preserve the original transition or persistence failure.
      }
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

  async #claimCancellation(
    candidate: TrackedOrder,
    at: number,
  ): Promise<
    | { readonly status: "claimed"; readonly order: TrackedOrder }
    | { readonly status: "skipped" }
    | { readonly status: "unresolved" }
  > {
    let base = candidate;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (base.status !== "acknowledged" && base.status !== "partially-filled") {
        return { status: "skipped" };
      }
      const pending = transitionOrder(base, {
        type: "cancel-request",
        at: Math.max(at, base.updatedAt),
      });
      try {
        const saved = await this.#dependencies.repository.save(pending, base.version);
        return { status: "claimed", order: saved };
      } catch {
        try {
          const winner = await this.#dependencies.repository.getByClientOrderId(
            base.clientOrderId,
          );
          if (winner === null || !sameTrackedOrder(winner, base)) {
            return { status: "unresolved" };
          }
          if (winner.version === base.version) {
            if (attempt === 1) return { status: "unresolved" };
          } else if (
            winner.status !== "acknowledged" &&
            winner.status !== "partially-filled"
          ) {
            return { status: "skipped" };
          }
          base = winner;
        } catch {
          return { status: "unresolved" };
        }
      }
    }
    return { status: "unresolved" };
  }

  async #persistCancelResult(
    pending: TrackedOrder,
    outcome: Exclude<CancelOutcome, { readonly status: "unknown" }>,
    at: number,
  ): Promise<TrackedOrder | null> {
    let base = pending;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (outcome.status === "cancelled" && base.status === "cancelled") return base;
      if (outcome.status === "rejected" &&
          (base.status === "acknowledged" || base.status === "partially-filled")) {
        return base;
      }
      if (
        base.status !== "cancel-pending" &&
        !(outcome.status === "cancelled" &&
          (base.status === "acknowledged" || base.status === "partially-filled"))
      ) return base;
      const cancelPending = base.status === "cancel-pending"
        ? base
        : transitionOrder(base, {
            type: "cancel-request",
            at: Math.max(at, base.updatedAt),
          });
      const next = outcome.status === "cancelled"
        ? transitionOrder(cancelPending, {
            type: "cancel-acknowledged",
            at: Math.max(at, cancelPending.updatedAt),
          })
        : transitionOrder(cancelPending, {
            type: "cancel-rejected",
            reason: outcome.reason,
            at: Math.max(at, cancelPending.updatedAt),
          });
      try {
        return await this.#dependencies.repository.save(next, base.version);
      } catch {
        try {
          const winner = await this.#dependencies.repository.getByClientOrderId(
            base.clientOrderId,
          );
          if (winner === null || !sameTrackedOrder(winner, base)) return null;
          base = winner;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  async #preserveCancelPending(
    pending: TrackedOrder,
    at: number,
  ): Promise<TrackedOrder | null> {
    let base: TrackedOrder | null;
    try {
      base = await this.#dependencies.repository.getByClientOrderId(
        pending.clientOrderId,
      );
    } catch {
      return null;
    }
    if (base === null || !sameTrackedOrder(base, pending)) return null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (base.status === "cancel-pending") return base;
      if (base.status !== "acknowledged" && base.status !== "partially-filled") {
        return base;
      }
      const restored = transitionOrder(base, {
        type: "cancel-request",
        at: Math.max(at, base.updatedAt),
      });
      try {
        return await this.#dependencies.repository.save(restored, base.version);
      } catch {
        try {
          const winner = await this.#dependencies.repository.getByClientOrderId(
            pending.clientOrderId,
          );
          if (winner === null || !sameTrackedOrder(winner, pending)) return null;
          base = winner;
        } catch {
          return null;
        }
      }
    }
    return null;
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
