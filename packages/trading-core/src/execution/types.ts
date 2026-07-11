import type { ExecutionMode, Market, StrategySignal } from "../contracts";
import type { InstrumentRules } from "../datasets";
import type { ExchangeExecutionPort, TrackedOrder } from "../orders";
import type {
  CircuitBreakerAcquisition,
  CircuitBreakerFailureCategory,
} from "../reliability";
import type {
  OrderIntent,
  RiskContext,
  RiskDecision,
  RiskPolicy,
} from "../risk";

export interface ExecutionContext {
  readonly deploymentId: string;
  readonly configurationVersion: string;
  readonly signalSequence: number;
  readonly market: Market;
  readonly mode: ExecutionMode;
  readonly riskPolicy: RiskPolicy;
  readonly riskContext: RiskContext;
  readonly instrumentRules: InstrumentRules;
  readonly now: number;
}

export interface IntentNormalizer {
  normalize(
    signal: Readonly<StrategySignal>,
    context: Readonly<ExecutionContext>,
  ): Promise<OrderIntent>;
}

export type RiskEvaluator = (
  policy: RiskPolicy,
  context: RiskContext,
  intent: OrderIntent,
  instrument: InstrumentRules,
) => RiskDecision;

export interface OrderRepository {
  getByClientOrderId(clientOrderId: string): Promise<TrackedOrder | null>;
  listActive(deploymentId: string, symbol?: string): Promise<readonly TrackedOrder[]>;
  save(order: TrackedOrder, expectedVersion: number | null): Promise<TrackedOrder>;
}

export interface CircuitBreakerPort {
  tryAcquire(now: number): CircuitBreakerAcquisition;
  recordSuccess(token: string, now: number): boolean;
  recordFailure(
    token: string,
    category: CircuitBreakerFailureCategory,
    now: number,
  ): boolean;
}

export interface ExecutionCoordinatorDependencies {
  readonly normalizer: IntentNormalizer;
  readonly riskEvaluator: RiskEvaluator;
  readonly repository: OrderRepository;
  readonly exchange: ExchangeExecutionPort;
  readonly circuitBreaker: CircuitBreakerPort;
  readonly failureClassifier: (failure: unknown) => CircuitBreakerFailureCategory;
}

export type ExecutionOutcome =
  | { readonly status: "submitted"; readonly order: TrackedOrder }
  | { readonly status: "idempotent"; readonly order: TrackedOrder }
  | { readonly status: "risk-rejected"; readonly order: TrackedOrder }
  | {
      readonly status: "blocked";
      readonly reason:
        | "emergency-stop"
        | "queue-full"
        | "active-order-conflict"
        | "circuit-breaker";
    };
