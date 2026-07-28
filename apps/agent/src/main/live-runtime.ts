import {
  CircuitBreaker,
  ExecutionCoordinator,
  SignalIntentNormalizer,
  createVisualStrategyEvaluator,
  evaluateOrderRisk,
  type OrderRepository,
  type VisualBotConfig,
} from "@cryptobot-labs/trading-core";
import { WeexExecutionAdapter, type WeexExecutionClient } from "@cryptobot-labs/weex-client";

import { ExecutionRuntime, type RuntimeAuditEvent } from "../runtime/execution-runtime";
import { StrategyWorker } from "../runtime/strategy-worker";
import { VisualExecutionRuntime } from "../runtime/visual-execution-runtime";

export interface LiveRuntimeOptions {
  readonly brokerId: string;
  readonly config: VisualBotConfig;
  readonly source?: string | null;
  readonly worker?: StrategyWorker;
  readonly repository: OrderRepository;
  readonly client: WeexExecutionClient;
  readonly audit: (event: RuntimeAuditEvent) => void | Promise<void>;
}

/** Trusted live composition. The sandbox never receives the WEEX execution adapter. */
export function createLiveRuntime(options: LiveRuntimeOptions) {
  const exchange = new WeexExecutionAdapter(options.client);
  const circuitBreaker = new CircuitBreaker({ failureThreshold: 3, windowMs: 60_000, cooldownMs: 30_000 });
  const coordinator = new ExecutionCoordinator({ normalizer: new SignalIntentNormalizer(), riskEvaluator: evaluateOrderRisk,
    repository: options.repository, exchange, circuitBreaker, brokerId: options.brokerId,
    failureClassifier: () => "unknown" });
  const runtime = options.source === undefined || options.source === null
    ? new VisualExecutionRuntime({ evaluator: createVisualStrategyEvaluator(options.config), coordinator, audit: options.audit })
    : new ExecutionRuntime({
      worker: options.worker ?? new StrategyWorker(),
      coordinator,
      audit: options.audit,
      tradeDirection: options.config.tradeDirection,
    });
  return Object.freeze({ runtime, coordinator, circuitBreaker, exchange });
}
