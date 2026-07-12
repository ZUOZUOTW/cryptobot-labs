import { describe, expect, it, vi } from "vitest";

import {
  CircuitBreaker,
  ExecutionCoordinator,
  type ExecutionContext,
  type ExecutionCoordinatorDependencies,
  type StrategySignal,
  evaluateOrderRisk,
} from "../src";
import { context as riskContext, instrument, policy } from "./fixtures/risk";

function unusedDependencies(): ExecutionCoordinatorDependencies {
  return {
    normalizer: { normalize: async () => { throw new Error("unused"); } },
    riskEvaluator: () => ({ allowed: false, reason: "invalid-market" }),
    repository: {
      getByClientOrderId: async () => null,
      listActive: async () => [],
      claim: async (order) => ({ claimed: true, order }),
      save: async (order) => order,
    },
    exchange: {
      submit: async () => { throw new Error("unused"); },
      cancel: async () => { throw new Error("unused"); },
      findByClientOrderId: async () => null,
    },
    circuitBreaker: {
      tryAcquire: () => ({ allowed: false, reason: "fail-closed" }),
      recordSuccess: () => false,
      recordFailure: () => false,
    },
    failureClassifier: () => "unknown",
  };
}

describe("ExecutionCoordinator emergency stop", () => {
  it("latches synchronously and only permits explicit paper resume", () => {
    const coordinator = new ExecutionCoordinator(unusedDependencies());
    expect(coordinator.stopped).toBe(false);
    coordinator.emergencyStop();
    expect(coordinator.stopped).toBe(true);
    expect(coordinator.resumePaper("live")).toBe(false);
    expect(coordinator.stopped).toBe(true);
    expect(coordinator.resumePaper("futures-demo")).toBe(false);
    expect(coordinator.resumePaper("paper")).toBe(true);
    expect(coordinator.stopped).toBe(false);
  });

  it("blocks at entry and when stop is latched while normalization is awaiting", async () => {
    let release!: (intent: {
      symbol: string; side: "buy"; quantity: string; price: string;
      expectedSlippageBps: string; reduceOnly: boolean;
    }) => void;
    const normalized = new Promise<{
      symbol: string; side: "buy"; quantity: string; price: string;
      expectedSlippageBps: string; reduceOnly: boolean;
    }>((resolve) => { release = resolve; });
    const exchange = { submit: vi.fn(), cancel: vi.fn(), findByClientOrderId: vi.fn() };
    const dependencies = unusedDependencies();
    const coordinator = new ExecutionCoordinator({
      ...dependencies,
      normalizer: { normalize: vi.fn(async () => normalized) },
      riskEvaluator: evaluateOrderRisk,
      repository: {
        getByClientOrderId: vi.fn(async () => null),
        listActive: vi.fn(async () => []),
        claim: vi.fn(async (order) => ({ claimed: true as const, order })),
        save: vi.fn(async (order) => order),
      },
      exchange,
      circuitBreaker: new CircuitBreaker({ failureThreshold: 3, windowMs: 1_000, cooldownMs: 1_000 }),
    });
    const signal: StrategySignal = { id: "signal-1", action: "buy", reason: "test", createdAt: 10_000 };
    const context: ExecutionContext = {
      deploymentId: "deployment-1", configurationVersion: "configuration-1", signalSequence: 1,
      market: "spot", mode: "live", riskPolicy: policy, riskContext,
      referencePrice: "1000",
      instrumentRules: instrument, now: 10_000,
    };

    const pending = coordinator.propose(signal, context);
    await vi.waitFor(() => expect(coordinator.pending).toBe(1));
    coordinator.emergencyStop();
    release({ symbol: "BTCUSDT", side: "buy", quantity: "0.1", price: "1000", expectedSlippageBps: "25", reduceOnly: false });
    expect(await pending).toEqual({ status: "blocked", reason: "emergency-stop" });
    expect(exchange.submit).not.toHaveBeenCalled();

    expect(await coordinator.propose(signal, context)).toEqual({ status: "blocked", reason: "emergency-stop" });
  });
});
