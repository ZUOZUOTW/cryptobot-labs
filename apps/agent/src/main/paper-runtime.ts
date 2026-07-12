import {
  CircuitBreaker,
  ExecutionCoordinator,
  SignalIntentNormalizer,
  createVisualStrategyEvaluator,
  evaluateOrderRisk,
  reconcileOrder,
  type ExecutionContext,
  type ExecutionOutcome,
  type OrderRepository,
  type VisualBotConfig,
} from "@cryptobot-labs/trading-core";

import { VisualExecutionRuntime } from "../runtime/visual-execution-runtime";
import type { RuntimeAuditEvent } from "../runtime/execution-runtime";
import { PaperExchange, type PaperExchangeOptions } from "./paper-exchange";

export interface PaperRuntimeOptions {
  readonly config: VisualBotConfig;
  readonly repository: OrderRepository;
  readonly exchange?: PaperExchange;
  readonly fill?: PaperExchangeOptions;
  readonly audit: (event: RuntimeAuditEvent) => void | Promise<void>;
}

class PaperFillCoordinator {
  constructor(
    private readonly coordinator: Pick<ExecutionCoordinator, "propose">,
    private readonly repository: OrderRepository,
    private readonly exchange: PaperExchange,
  ) {}

  async propose(signal: Parameters<ExecutionCoordinator["propose"]>[0], context: ExecutionContext): Promise<ExecutionOutcome> {
    const outcome = await this.coordinator.propose(signal, context);
    if ((outcome.status !== "submitted" && outcome.status !== "idempotent") ||
        outcome.order.executionTarget.mode !== "paper" ||
        !["acknowledged", "partially-filled", "cancel-pending", "unknown", "reconciled"].includes(outcome.order.status)) return outcome;
    const snapshot = await this.exchange.findByClientOrderId({ target: outcome.order.executionTarget,
      symbol: outcome.order.approvedIntent.symbol, clientOrderId: outcome.order.clientOrderId,
      exchangeOrderId: outcome.order.exchangeOrderId });
    const reconciled = reconcileOrder({ local: outcome.order, snapshot, at: context.now });
    if (reconciled.resolution !== "resolved" || reconciled.state === outcome.order) return outcome;
    const order = await this.repository.save(reconciled.state, outcome.order.version);
    return { ...outcome, order };
  }
}

/** Complete trusted Paper composition used by RunManager. */
export function createPaperRuntime(options: PaperRuntimeOptions) {
  const exchange = options.exchange ?? new PaperExchange(options.fill ?? { slippageBps: "5", feeBps: "10" });
  const circuitBreaker = new CircuitBreaker({ failureThreshold: 3, windowMs: 60_000, cooldownMs: 30_000 });
  const coordinator = new ExecutionCoordinator({ normalizer: new SignalIntentNormalizer(), riskEvaluator: evaluateOrderRisk,
    repository: options.repository, exchange, circuitBreaker, failureClassifier: () => "unknown" });
  const fills = new PaperFillCoordinator(coordinator, options.repository, exchange);
  const runtime = new VisualExecutionRuntime({ evaluator: createVisualStrategyEvaluator(options.config),
    coordinator: fills, audit: options.audit });
  return Object.freeze({ runtime, coordinator, circuitBreaker, exchange });
}
