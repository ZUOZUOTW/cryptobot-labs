import { describe, expect, it, vi } from "vitest";

import {
  CircuitBreaker,
  ExecutionCoordinator,
  MAX_PENDING,
  type ExecutionContext,
  type OrderRepository,
  type StrategySignal,
  type TrackedOrder,
  evaluateOrderRisk,
} from "../src";
import { context as riskContext, instrument, policy } from "./fixtures/risk";

class MemoryOrderRepository implements OrderRepository {
  readonly orders = new Map<string, TrackedOrder>();

  async getByClientOrderId(clientOrderId: string): Promise<TrackedOrder | null> {
    return this.orders.get(clientOrderId) ?? null;
  }

  async listActive(deploymentId: string, symbol?: string): Promise<readonly TrackedOrder[]> {
    return [...this.orders.values()].filter((order) =>
      order.deploymentId === deploymentId &&
      (symbol === undefined || order.approvedIntent.symbol === symbol) &&
      ["submitting", "acknowledged", "partially-filled", "cancel-pending", "unknown"].includes(order.status));
  }

  async save(order: TrackedOrder, expectedVersion: number | null): Promise<TrackedOrder> {
    const current = this.orders.get(order.clientOrderId);
    if ((current?.version ?? null) !== expectedVersion) throw new Error("optimistic conflict");
    this.orders.set(order.clientOrderId, order);
    return order;
  }
}

const signal: StrategySignal = {
  id: "signal-1",
  action: "buy",
  reason: "test",
  createdAt: 10_000,
};

const executionContext: ExecutionContext = {
  deploymentId: "deployment-1",
  configurationVersion: "configuration-1",
  signalSequence: 1,
  market: "spot",
  mode: "paper",
  riskPolicy: policy,
  riskContext,
  instrumentRules: instrument,
  now: 10_000,
};

function setup(overrides: Partial<ConstructorParameters<typeof ExecutionCoordinator>[0]> = {}) {
  const repository = new MemoryOrderRepository();
  const normalizer = {
    normalize: vi.fn(async () => ({
      symbol: "BTCUSDT",
      side: "buy" as const,
      quantity: "0.1",
      price: "1000",
      expectedSlippageBps: "25",
      reduceOnly: false,
    })),
  };
  const exchange = {
    submit: vi.fn(async () => ({ status: "acknowledged" as const, exchangeOrderId: "exchange-1" })),
    cancel: vi.fn(async () => ({ status: "cancelled" as const })),
    findByClientOrderId: vi.fn(async () => null),
  };
  const breaker = new CircuitBreaker({ failureThreshold: 3, windowMs: 1_000, cooldownMs: 1_000 });
  const coordinator = new ExecutionCoordinator({
    normalizer,
    riskEvaluator: evaluateOrderRisk,
    repository,
    exchange,
    circuitBreaker: breaker,
    failureClassifier: () => "unknown",
    ...overrides,
  });
  return { coordinator, repository, normalizer, exchange, breaker };
}

describe("ExecutionCoordinator", () => {
  it("persists, evaluates risk, submits exactly once and records an acknowledgement", async () => {
    const { coordinator, repository, normalizer, exchange, breaker } = setup();
    const outcome = await coordinator.propose(signal, executionContext);

    expect(outcome.status).toBe("submitted");
    if (outcome.status !== "submitted") throw new Error("expected submission");
    expect(outcome.order).toMatchObject({ status: "acknowledged", exchangeOrderId: "exchange-1" });
    expect(repository.orders.get(outcome.order.clientOrderId)).toBe(outcome.order);
    expect(normalizer.normalize).toHaveBeenCalledTimes(1);
    expect(exchange.submit).toHaveBeenCalledTimes(1);
    expect(breaker.state).toBe("closed");
  });

  it("returns the immutable existing order for the same deterministic signal", async () => {
    const { coordinator, repository, exchange } = setup();
    const first = await coordinator.propose(signal, executionContext);
    const second = await coordinator.propose(signal, executionContext);

    expect(first.status).toBe("submitted");
    expect(second.status).toBe("idempotent");
    if (first.status !== "submitted" || second.status !== "idempotent") throw new Error("unexpected outcome");
    expect(second.order).toBe(repository.orders.get(first.order.clientOrderId));
    expect(exchange.submit).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent duplicate signals so only one submit occurs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const exchange = {
      submit: vi.fn(async () => { await gate; return { status: "acknowledged" as const, exchangeOrderId: "exchange-1" }; }),
      cancel: vi.fn(),
      findByClientOrderId: vi.fn(),
    };
    const { coordinator } = setup({ exchange });

    const first = coordinator.propose(signal, executionContext);
    const second = coordinator.propose(signal, executionContext);
    await vi.waitFor(() => expect(exchange.submit).toHaveBeenCalledTimes(1));
    release();
    const outcomes = await Promise.all([first, second]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["submitted", "idempotent"]);
    expect(exchange.submit).toHaveBeenCalledTimes(1);
  });

  it("persists risk rejection and never calls the exchange", async () => {
    const riskEvaluator = vi.fn(() => ({ allowed: false as const, reason: "maximum-order-notional-exceeded" as const }));
    const { coordinator, exchange } = setup({ riskEvaluator });
    const outcome = await coordinator.propose(signal, executionContext);
    expect(outcome.status).toBe("risk-rejected");
    if (outcome.status !== "risk-rejected") throw new Error("unexpected outcome");
    expect(outcome.order.status).toBe("risk-rejected");
    expect(exchange.submit).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "rejected" as const, reason: "exchange-denied" }, "rejected"],
    [{ status: "unknown" as const, reason: "timed-out" }, "unknown"],
  ])("maps exchange %s without retry", async (submitOutcome, expectedStatus) => {
    const exchange = {
      submit: vi.fn(async () => submitOutcome), cancel: vi.fn(), findByClientOrderId: vi.fn(),
    };
    const { coordinator } = setup({ exchange });
    const outcome = await coordinator.propose(signal, executionContext);
    expect(outcome.status).toBe("submitted");
    if (outcome.status !== "submitted") throw new Error("unexpected outcome");
    expect(outcome.order.status).toBe(expectedStatus);
    expect(exchange.submit).toHaveBeenCalledTimes(1);
  });

  it("records thrown and malformed submit results as unknown and settles failure once", async () => {
    for (const implementation of [
      async () => { throw new Error("network"); },
      async () => ({ status: "acknowledged" as const, exchangeOrderId: "" }),
    ]) {
      const exchange = { submit: vi.fn(implementation), cancel: vi.fn(), findByClientOrderId: vi.fn() };
      const circuitBreaker = {
        tryAcquire: vi.fn(() => ({ allowed: true as const, token: "token" })),
        recordSuccess: vi.fn(() => true),
        recordFailure: vi.fn(() => true),
      };
      const { coordinator } = setup({ exchange, circuitBreaker });
      const outcome = await coordinator.propose(signal, executionContext);
      expect(outcome.status).toBe("submitted");
      if (outcome.status !== "submitted") throw new Error("unexpected outcome");
      expect(outcome.order.status).toBe("unknown");
      expect(exchange.submit).toHaveBeenCalledTimes(1);
      expect(circuitBreaker.recordSuccess).not.toHaveBeenCalled();
      expect(circuitBreaker.recordFailure).toHaveBeenCalledTimes(1);
    }
  });

  it("blocks on breaker denial and an active order conflict", async () => {
    const deniedBreaker = {
      tryAcquire: vi.fn(() => ({ allowed: false as const, reason: "cooldown" as const })),
      recordSuccess: vi.fn(), recordFailure: vi.fn(),
    };
    const denied = setup({ circuitBreaker: deniedBreaker });
    expect((await denied.coordinator.propose(signal, executionContext)).status).toBe("blocked");
    expect(denied.exchange.submit).not.toHaveBeenCalled();

    const conflict = setup();
    conflict.repository.orders.set("other", {
      deploymentId: executionContext.deploymentId,
      clientOrderId: "other",
      approvedIntent: { symbol: "BTCUSDT", side: "buy", quantity: "0.1", price: "1000", expectedSlippageBps: "25", reduceOnly: false },
      status: "unknown", createdAt: 1, updatedAt: 1, cumulativeFilledQuantity: "0", version: 0,
    });
    expect((await conflict.coordinator.propose(signal, executionContext)).status).toBe("blocked");
    expect(conflict.exchange.submit).not.toHaveBeenCalled();
  });

  it("fails closed on malformed signals and bounded queue overflow", async () => {
    const { coordinator, normalizer } = setup();
    await expect(coordinator.propose({ ...signal, surprise: true } as StrategySignal, executionContext)).rejects.toThrow(TypeError);
    expect(normalizer.normalize).not.toHaveBeenCalled();
    expect(MAX_PENDING).toBe(1_024);
  });
});
