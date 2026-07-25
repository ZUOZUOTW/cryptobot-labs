import type {
  ExecutionContext,
  ExecutionMode,
  ExecutionOutcome,
  ExecutionTarget,
  InstrumentRules,
  Market,
  StrategyInput,
} from "@cryptobot-labs/trading-core";
import { executionTargetFor } from "@cryptobot-labs/trading-core";
import type { ConnectionRegistry } from "./connections";
import type { ClockFreshnessGuard, MarketStreamState } from "./market-stream";
import type {
  ExecutionRuntime,
  RuntimeDeployment,
  RuntimeEvaluationOutcome,
} from "../runtime/execution-runtime";

export type RunStatus = "idle" | "running" | "paused" | "stopped";

export interface RunDefinition {
  readonly deployment: RuntimeDeployment;
  readonly mode: ExecutionMode;
  readonly market: Market;
  readonly symbol: string;
}

export interface RunAuditEvent {
  readonly type:
    | "run-started"
    | "run-stopped"
    | "run-paused"
    | "evaluation-complete"
    | "emergency-stop";
  readonly deploymentId: string;
  readonly at: number;
  readonly reason: string;
  readonly mode: ExecutionMode;
  readonly market: Market;
}

export interface RunManagerDependencies {
  readonly runtime: Pick<ExecutionRuntime, "start" | "evaluate" | "stop">;
  readonly market: Pick<MarketStreamState, "requireFresh">;
  readonly clock: Pick<ClockFreshnessGuard, "requireFresh">;
  readonly connection: Pick<ConnectionRegistry, "requireFresh">;
  readonly instruments: {
    requireFresh(market: Market, symbol: string, now: number): Readonly<InstrumentRules>;
  };
  readonly reconciliation: {
    reconcileBeforeSubmit(input: {
      readonly deploymentId: string;
      readonly market: Market;
      readonly mode: ExecutionMode;
      readonly symbol: string;
      readonly now: number;
    }): Promise<
      | { readonly ready: true }
      | { readonly ready: false; readonly reason: string }
    >;
  };
  readonly circuitBreaker: { canSubmit(now: number): boolean };
  readonly audit: (event: Readonly<RunAuditEvent>) => void | Promise<void>;
}

export interface RunEvaluationRequest {
  readonly now: number;
  readonly randomSeed: string;
  readonly context: Readonly<ExecutionContext>;
  readonly input: Readonly<StrategyInput>;
}

export type RunEvaluationResult = RuntimeEvaluationOutcome |
  { readonly status: "paused"; readonly reason: string };

const SAFE_REASON = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

function isTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function safeReason(value: string, fallback: string): string {
  return SAFE_REASON.test(value) ? value : fallback;
}

function timeframeMs(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,5})(m|h|d|w)$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]!]!;
  const result = amount * unit;
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function sameInstrument(left: Readonly<InstrumentRules>, right: Readonly<InstrumentRules>): boolean {
  return left.market === right.market && left.symbol === right.symbol &&
    left.tickSize === right.tickSize && left.stepSize === right.stepSize &&
    left.minimumQuantity === right.minimumQuantity &&
    left.minimumNotional === right.minimumNotional &&
    left.maximumLeverage === right.maximumLeverage;
}

function isAmbiguous(outcome: RuntimeEvaluationOutcome): boolean {
  if (outcome.status !== "proposed") return false;
  const proposal = outcome.outcome as ExecutionOutcome;
  return (proposal.status === "submitted" || proposal.status === "idempotent") &&
    proposal.order.status === "unknown";
}

/**
 * Fail-closed orchestration around the signal-only runtime. It intentionally
 * never owns an exchange submit port: every mode still flows through the
 * trusted ExecutionRuntime and ExecutionCoordinator.
 */
export class RunManager {
  readonly #dependencies: RunManagerDependencies;
  #definition: Readonly<RunDefinition> | null = null;
  #status: RunStatus = "idle";
  #pausedReason: string | null = null;
  #tail: Promise<void> = Promise.resolve();
  #generation = 0;
  #lifecycleTransition = false;

  constructor(dependencies: RunManagerDependencies) {
    this.#dependencies = dependencies;
  }

  get status(): RunStatus {
    return this.#status;
  }

  get pausedReason(): string | null {
    return this.#pausedReason;
  }

  start(definition: RunDefinition): void {
    if (this.#status === "running") throw new Error("a run is already active");
    if (this.#lifecycleTransition) throw new Error("a run lifecycle transition is in progress");
    if (definition.mode === "futures-demo" && definition.market !== "futures") {
      throw new TypeError("futures demo requires the futures market");
    }
    if (!definition.symbol || definition.symbol.length > 64) {
      throw new TypeError("invalid run symbol");
    }
    this.#definition = Object.freeze({ ...definition });
    this.#generation += 1;
    this.#status = "running";
    this.#pausedReason = null;
    this.#dependencies.runtime.start(definition.deployment);
    void this.#audit(definition, "run-started", 0, "started");
  }

  evaluate(request: RunEvaluationRequest): Promise<RunEvaluationResult> {
    if (!isTimestamp(request.now)) {
      return Promise.resolve({ status: "paused", reason: "invalid-clock" });
    }
    if (this.#status !== "running" || this.#definition === null) {
      return Promise.resolve({
        status: "paused",
        reason: this.#pausedReason ?? "inactive",
      });
    }
    const generation = this.#generation;
    const work = this.#tail.then(() => this.#evaluate(request, generation));
    this.#tail = work.then(() => undefined, () => undefined);
    return work;
  }

  async stop(at = 0): Promise<void> {
    const definition = this.#definition;
    this.#generation += 1;
    this.#status = "stopped";
    this.#pausedReason = null;
    this.#lifecycleTransition = true;
    try {
      await this.#dependencies.runtime.stop();
      if (definition !== null) await this.#audit(definition, "run-stopped", at, "stopped");
      if (this.#definition === definition) this.#definition = null;
    } finally {
      this.#lifecycleTransition = false;
    }
  }

  async latchEmergency(at: number): Promise<void> {
    const definition = this.#definition;
    if (definition === null) return;
    this.#generation += 1;
    this.#status = "paused";
    this.#pausedReason = "emergency-stop";
    this.#lifecycleTransition = true;
    try {
      await this.#dependencies.runtime.stop();
      await this.#audit(definition, "emergency-stop", at, "emergency-stop");
    } finally {
      this.#lifecycleTransition = false;
    }
  }

  async #evaluate(request: RunEvaluationRequest, generation: number): Promise<RunEvaluationResult> {
    const definition = this.#definition;
    if (!this.#isCurrent(definition, generation)) {
      return { status: "paused", reason: this.#pausedReason ?? "inactive" };
    }
    if (!this.#contextMatches(definition, request.context, request.now)) {
      return this.#pause("context-mismatch", request.now, definition, generation);
    }

    let quote;
    try {
      quote = this.#dependencies.market.requireFresh(
        definition.market,
        definition.symbol,
        request.now,
        60_000,
      );
    } catch {
      return this.#pause("market-data-stale", request.now, definition, generation);
    }
    if (!this.#inputMatches(definition, request.input, request.context, quote, request.now)) {
      return this.#pause("market-context-mismatch", request.now, definition, generation);
    }

    try {
      this.#dependencies.clock.requireFresh(request.now);
    } catch {
      return this.#pause("clock-unsynchronised", request.now, definition, generation);
    }
    if (definition.mode !== "paper") {
      const target = executionTargetFor(definition.market, definition.mode);
      if (target === null) return this.#pause("execution-target-invalid", request.now, definition, generation);
      try {
        this.#dependencies.connection.requireFresh(target as ExecutionTarget, request.now);
      } catch {
        return this.#pause("connection-unverified", request.now, definition, generation);
      }
    }

    let currentRules: Readonly<InstrumentRules>;
    try {
      currentRules = this.#dependencies.instruments.requireFresh(
        definition.market,
        definition.symbol,
        request.now,
      );
    } catch {
      return this.#pause("instrument-rules-stale", request.now, definition, generation);
    }
    if (!sameInstrument(currentRules, request.context.instrumentRules)) {
      return this.#pause("instrument-rules-mismatch", request.now, definition, generation);
    }
    if (!this.#dependencies.circuitBreaker.canSubmit(request.now)) {
      return this.#pause("circuit-breaker-open", request.now, definition, generation);
    }

    let reconciliation: Awaited<ReturnType<
      RunManagerDependencies["reconciliation"]["reconcileBeforeSubmit"]
    >>;
    try {
      reconciliation = await this.#dependencies.reconciliation.reconcileBeforeSubmit({
        deploymentId: definition.deployment.deploymentId,
        market: definition.market,
        mode: definition.mode,
        symbol: definition.symbol,
        now: request.now,
      });
    } catch {
      return this.#pause("reconciliation-failed", request.now, definition, generation);
    }
    if (!reconciliation.ready) {
      return this.#pause("reconciliation-required", request.now, definition, generation);
    }
    if (!this.#isCurrent(definition, generation)) {
      return { status: "paused", reason: this.#pausedReason ?? "inactive" };
    }

    let outcome: RuntimeEvaluationOutcome;
    try {
      outcome = await this.#dependencies.runtime.evaluate({
        input: request.input,
        now: request.now,
        randomSeed: request.randomSeed,
        context: request.context,
      });
    } catch {
      return this.#pause("runtime-fault", request.now, definition, generation);
    }
    if (!this.#isCurrent(definition, generation)) {
      return { status: "paused", reason: this.#pausedReason ?? "inactive" };
    }
    if (isAmbiguous(outcome)) {
      // The submit may have reached WEEX. Never evaluate/resubmit until a
      // query-by-client-id reconciliation has produced a definitive state.
      return this.#pause("ambiguous-order", request.now, definition, generation);
    }
    await this.#audit(
      definition,
      "evaluation-complete",
      request.now,
      outcome.status === "proposed" ? outcome.outcome.status : outcome.status,
    );
    return outcome;
  }

  #contextMatches(
    definition: Readonly<RunDefinition>,
    context: Readonly<ExecutionContext>,
    now: number,
  ): boolean {
    return context.deploymentId === definition.deployment.deploymentId &&
      context.configurationVersion === definition.deployment.configurationVersion &&
      context.mode === definition.mode && context.market === definition.market &&
      context.riskContext.market === definition.market &&
      context.riskContext.symbol === definition.symbol &&
      context.now === now && context.riskContext.now === now;
  }

  #inputMatches(
    definition: Readonly<RunDefinition>,
    input: Readonly<StrategyInput>,
    context: Readonly<ExecutionContext>,
    quote: ReturnType<RunManagerDependencies["market"]["requireFresh"]>,
    now: number,
  ): boolean {
    const interval = timeframeMs(input.timeframe);
    const latestCandle = input.candles.at(-1);
    const orderedCandles = input.candles.every((candle, index) => index === 0 || (
      candle.openTime > input.candles[index - 1]!.openTime &&
      candle.closeTime > input.candles[index - 1]!.closeTime
    ));
    const latestCandleClose = latestCandle?.closeTime ?? -1;
    return input.market === definition.market && input.symbol === definition.symbol &&
      input.now === now && quote.market === definition.market && quote.symbol === definition.symbol &&
      quote.exchangeTimestamp <= quote.receivedAt && quote.receivedAt <= now &&
      now - quote.exchangeTimestamp <= 60_000 &&
      context.riskContext.priceTimestamp === quote.exchangeTimestamp &&
      context.referencePrice === quote.last &&
      interval !== null && orderedCandles && latestCandle?.complete === true &&
      Number.isSafeInteger(latestCandleClose) && latestCandleClose >= 0 &&
      quote.exchangeTimestamp - latestCandleClose <= interval * 2 &&
      latestCandleClose <= quote.exchangeTimestamp && latestCandleClose <= now;
  }

  #isCurrent(definition: Readonly<RunDefinition> | null, generation: number): definition is Readonly<RunDefinition> {
    return definition !== null && this.#status === "running" &&
      this.#definition === definition && this.#generation === generation;
  }

  async #pause(
    reason: string,
    at: number,
    definition: Readonly<RunDefinition>,
    generation: number,
  ): Promise<RunEvaluationResult> {
    if (!this.#isCurrent(definition, generation)) {
      return { status: "paused", reason: this.#pausedReason ?? "inactive" };
    }
    this.#generation += 1;
    this.#status = "paused";
    this.#pausedReason = reason;
    this.#lifecycleTransition = true;
    try {
      await this.#dependencies.runtime.stop().catch(() => undefined);
      await this.#audit(definition, "run-paused", at, reason);
      return { status: "paused", reason };
    } finally {
      this.#lifecycleTransition = false;
    }
  }

  async #audit(
    definition: Readonly<RunDefinition>,
    type: RunAuditEvent["type"],
    at: number,
    reason: string,
  ): Promise<void> {
    try {
      await this.#dependencies.audit(Object.freeze({
        type,
        deploymentId: definition.deployment.deploymentId,
        at: isTimestamp(at) ? at : 0,
        reason: safeReason(reason, "redacted"),
        mode: definition.mode,
        market: definition.market,
      }));
    } catch {
      // Audit transport must not create a retry or bypass the fail-closed run state.
    }
  }
}
