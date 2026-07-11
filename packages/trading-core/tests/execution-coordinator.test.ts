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

  it("checks emergency stop before parsing and normalizes before deriving an id", async () => {
    const stopped = setup();
    stopped.coordinator.emergencyStop();
    await expect(stopped.coordinator.propose(
      { ...signal, surprise: true } as StrategySignal,
      executionContext,
    )).resolves.toEqual({ status: "blocked", reason: "emergency-stop" });

    const normalizer = { normalize: vi.fn(async () => { throw new Error("normalized-first"); }) };
    const ordered = setup({ normalizer });
    await expect(ordered.coordinator.propose(signal, {
      ...executionContext,
      deploymentId: "",
    })).rejects.toThrow("normalized-first");
  });

  it("checks active conflicts before persisting a proposal", async () => {
    const conflict = setup();
    conflict.repository.orders.set("other", {
      deploymentId: executionContext.deploymentId,
      clientOrderId: "other",
      approvedIntent: { symbol: "BTCUSDT", side: "buy", quantity: "0.1", price: "1000", expectedSlippageBps: "25", reduceOnly: false },
      status: "unknown", createdAt: 1, updatedAt: 1, cumulativeFilledQuantity: "0", version: 0,
    });
    expect(await conflict.coordinator.propose(signal, executionContext)).toEqual({
      status: "blocked",
      reason: "active-order-conflict",
    });
    expect(conflict.repository.orders.size).toBe(1);
  });

  it("lets emergency stop win when active-order lookup is awaiting", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const repository = new MemoryOrderRepository();
    const listActive = vi.fn(async () => {
      await gate;
      return [{ status: "unknown" }] as unknown as readonly TrackedOrder[];
    });
    repository.listActive = listActive;
    const save = vi.spyOn(repository, "save");
    const { coordinator } = setup({ repository });
    const pending = coordinator.propose(signal, executionContext);
    await vi.waitFor(() => expect(listActive).toHaveBeenCalledOnce());
    coordinator.emergencyStop();
    release();
    await expect(pending).resolves.toEqual({ status: "blocked", reason: "emergency-stop" });
    expect(save).not.toHaveBeenCalled();
  });

  it("counts duplicate waiters toward the bounded pending limit", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const normalizer = {
      normalize: vi.fn(async () => {
        await gate;
        return { symbol: "BTCUSDT", side: "buy" as const, quantity: "0.1", price: "1000", expectedSlippageBps: "25", reduceOnly: false };
      }),
    };
    const { coordinator } = setup({ normalizer });
    const pending = Array.from({ length: MAX_PENDING }, () => coordinator.propose(signal, executionContext));
    expect(coordinator.pending).toBe(MAX_PENDING);
    await expect(coordinator.propose(signal, executionContext)).resolves.toEqual({
      status: "blocked",
      reason: "queue-full",
    });
    release();
    await Promise.all(pending);
    expect(coordinator.pending).toBe(0);
  });

  it("resolves an optimistic create race across coordinators as idempotent", async () => {
    const repository = new MemoryOrderRepository();
    const exchange = {
      submit: vi.fn(async () => ({ status: "acknowledged" as const, exchangeOrderId: "exchange-1" })),
      cancel: vi.fn(), findByClientOrderId: vi.fn(),
    };
    const first = setup({ repository, exchange }).coordinator;
    const second = setup({ repository, exchange }).coordinator;
    const outcomes = await Promise.all([
      first.propose(signal, executionContext),
      second.propose(signal, executionContext),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["idempotent", "submitted"]);
    expect(exchange.submit).toHaveBeenCalledTimes(1);
  });

  it("persists unknown when breaker success settlement fails after submission", async () => {
    const circuitBreaker = {
      tryAcquire: vi.fn(() => ({ allowed: true as const, token: "token" })),
      recordSuccess: vi.fn(() => false),
      recordFailure: vi.fn(() => true),
    };
    const { coordinator, repository } = setup({ circuitBreaker });
    const outcome = await coordinator.propose(signal, executionContext);
    expect(outcome.status).toBe("submitted");
    if (outcome.status !== "submitted") throw new Error("unexpected outcome");
    expect(outcome.order.status).toBe("unknown");
    expect(repository.orders.get(outcome.order.clientOrderId)?.status).toBe("unknown");
    expect(circuitBreaker.recordSuccess).toHaveBeenCalledOnce();
    expect(circuitBreaker.recordFailure).not.toHaveBeenCalled();
  });

  it("settles failure without submitting when the submitting-state save fails", async () => {
    const repository = new MemoryOrderRepository();
    const save = vi.spyOn(repository, "save").mockImplementation(async (order, expectedVersion) => {
      if (order.status === "submitting") throw new Error("submitting save failed");
      const current = repository.orders.get(order.clientOrderId);
      if ((current?.version ?? null) !== expectedVersion) throw new Error("optimistic conflict");
      repository.orders.set(order.clientOrderId, order);
      return order;
    });
    const circuitBreaker = {
      tryAcquire: vi.fn(() => ({ allowed: true as const, token: "token" })),
      recordSuccess: vi.fn(() => true),
      recordFailure: vi.fn(() => true),
    };
    const { coordinator, exchange } = setup({ repository, circuitBreaker });
    await expect(coordinator.propose(signal, executionContext)).rejects.toThrow("submitting save failed");
    expect(exchange.submit).not.toHaveBeenCalled();
    expect(circuitBreaker.recordFailure).toHaveBeenCalledOnce();
    expect(circuitBreaker.recordSuccess).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("persists unknown and settles failure when the terminal save fails", async () => {
    const repository = new MemoryOrderRepository();
    let failTerminalSave = true;
    vi.spyOn(repository, "save").mockImplementation(async (order, expectedVersion) => {
      if (order.status === "acknowledged" && failTerminalSave) {
        failTerminalSave = false;
        throw new Error("terminal save failed");
      }
      const current = repository.orders.get(order.clientOrderId);
      if ((current?.version ?? null) !== expectedVersion) throw new Error("optimistic conflict");
      repository.orders.set(order.clientOrderId, order);
      return order;
    });
    const circuitBreaker = {
      tryAcquire: vi.fn(() => ({ allowed: true as const, token: "token" })),
      recordSuccess: vi.fn(() => true),
      recordFailure: vi.fn(() => true),
    };
    const { coordinator } = setup({ repository, circuitBreaker });
    const outcome = await coordinator.propose(signal, executionContext);
    expect(outcome.status).toBe("submitted");
    if (outcome.status !== "submitted") throw new Error("unexpected outcome");
    expect(outcome.order.status).toBe("unknown");
    expect(repository.orders.get(outcome.order.clientOrderId)?.status).toBe("unknown");
    expect(circuitBreaker.recordFailure).toHaveBeenCalledOnce();
    expect(circuitBreaker.recordSuccess).not.toHaveBeenCalled();
  });
});
