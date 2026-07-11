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

  async claim(order: TrackedOrder): Promise<
    | { readonly claimed: true; readonly order: TrackedOrder }
    | { readonly claimed: false; readonly reason: "active-order-conflict" }
    | { readonly claimed: false; readonly reason: "client-order-id-exists"; readonly order: TrackedOrder }
  > {
    const current = this.orders.get(order.clientOrderId);
    if (current !== undefined) {
      return { claimed: false, reason: "client-order-id-exists", order: current };
    }
    const conflict = [...this.orders.values()].some((candidate) =>
      candidate.deploymentId === order.deploymentId &&
      candidate.approvedIntent.symbol === order.approvedIntent.symbol &&
      ["proposed", "submitting", "acknowledged", "partially-filled", "cancel-pending", "unknown"].includes(candidate.status));
    if (conflict) return { claimed: false, reason: "active-order-conflict" };
    this.orders.set(order.clientOrderId, order);
    return { claimed: true, order };
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
  mode: "live",
  riskPolicy: policy,
  riskContext,
  instrumentRules: instrument,
  now: 10_000,
};

const allowedRisk = {
  allowed: true as const,
  normalized: {
    notional: "100",
    projectedPositionNotional: "100",
    projectedTotalExposure: "100",
    dailyPnl: "0",
  },
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
    expect(exchange.submit).toHaveBeenCalledWith({
      target: { market: "spot", mode: "live" },
      clientOrderId: outcome.order.clientOrderId,
      intent: outcome.order.approvedIntent,
    });
    expect(outcome.order.executionTarget).toEqual({ market: "spot", mode: "live" });
    expect(breaker.state).toBe("closed");
  });

  it.each([
    [{ market: "futures" as const, mode: "live" as const }, { market: "futures", mode: "live" }],
    [{ market: "futures" as const, mode: "futures-demo" as const }, { market: "futures", mode: "futures-demo" }],
  ])("routes an explicit execution target for %o", async (contextTarget, expectedTarget) => {
    const { coordinator, exchange } = setup({
      riskEvaluator: vi.fn(() => allowedRisk),
    });
    const outcome = await coordinator.propose(signal, {
      ...executionContext,
      ...contextTarget,
      instrumentRules: { ...instrument, market: "futures" },
    });

    expect(outcome.status).toBe("submitted");
    expect(exchange.submit).toHaveBeenCalledWith(expect.objectContaining({ target: expectedTarget }));
  });

  it("rejects paper and unsupported spot-demo targets without touching the exchange", async () => {
    for (const context of [
      { ...executionContext, mode: "paper" as const },
      { ...executionContext, mode: "futures-demo" as const },
    ]) {
      const { coordinator, exchange, normalizer } = setup();
      await expect(coordinator.propose(signal, context)).rejects.toThrow(/execution target/i);
      expect(normalizer.normalize).not.toHaveBeenCalled();
      expect(exchange.submit).not.toHaveBeenCalled();
    }
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

  it("treats the persisted execution target as part of deterministic order identity", async () => {
    const { coordinator, exchange } = setup({
      riskEvaluator: vi.fn(() => allowedRisk),
    });
    const first = await coordinator.propose(signal, executionContext);
    const second = await coordinator.propose(signal, {
      ...executionContext,
      market: "futures",
      mode: "live",
      instrumentRules: { ...instrument, market: "futures" },
    });

    expect(first.status).toBe("submitted");
    expect(second).toEqual({ status: "blocked", reason: "client-order-id-collision" });
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
      executionTarget: { market: "spot", mode: "live" },
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
      executionTarget: { market: "spot", mode: "live" },
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

  it("preserves a persisted acknowledgement when breaker success settlement fails", async () => {
    const circuitBreaker = {
      tryAcquire: vi.fn(() => ({ allowed: true as const, token: "token" })),
      recordSuccess: vi.fn(() => false),
      recordFailure: vi.fn(() => true),
    };
    const { coordinator, repository } = setup({ circuitBreaker });
    const outcome = await coordinator.propose(signal, executionContext);
    expect(outcome.status).toBe("submitted");
    if (outcome.status !== "submitted") throw new Error("unexpected outcome");
    expect(outcome.order.status).toBe("acknowledged");
    expect(repository.orders.get(outcome.order.clientOrderId)?.status).toBe("acknowledged");
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

  it("does not reload after a create failure when emergency stop latched", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const repository = new MemoryOrderRepository();
    const get = vi.spyOn(repository, "getByClientOrderId");
    const createSave = vi.fn();
    vi.spyOn(repository, "claim").mockImplementation(async () => {
      createSave();
      await gate;
      throw new Error("create failed");
    });
    const { coordinator } = setup({ repository });
    const pending = coordinator.propose(signal, executionContext);
    await vi.waitFor(() => expect(createSave).toHaveBeenCalledOnce());
    coordinator.emergencyStop();
    release();
    await expect(pending).resolves.toEqual({ status: "blocked", reason: "emergency-stop" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("fails closed and latches stop when unknown cannot be persisted", async () => {
    const repository = new MemoryOrderRepository();
    vi.spyOn(repository, "save").mockImplementation(async (order, expectedVersion) => {
      if (order.status === "unknown") throw new Error("unknown save rejected");
      const current = repository.orders.get(order.clientOrderId);
      if ((current?.version ?? null) !== expectedVersion) throw new Error("optimistic conflict");
      repository.orders.set(order.clientOrderId, order);
      return order;
    });
    const exchange = {
      submit: vi.fn(async () => { throw new Error("network"); }),
      cancel: vi.fn(), findByClientOrderId: vi.fn(),
    };
    const circuitBreaker = {
      tryAcquire: vi.fn(() => ({ allowed: true as const, token: "token" })),
      recordSuccess: vi.fn(() => true),
      recordFailure: vi.fn(() => true),
    };
    const { coordinator } = setup({ repository, exchange, circuitBreaker });
    await expect(coordinator.propose(signal, executionContext)).resolves.toEqual({
      status: "persistence-failed",
      reason: "unknown-order-not-persisted",
    });
    expect(coordinator.stopped).toBe(true);
    expect(circuitBreaker.recordFailure).toHaveBeenCalledOnce();
  });

  it.each([
    [{ status: "acknowledged" as const, exchangeOrderId: "exchange-1" }, "acknowledged"],
    [{ status: "rejected" as const, reason: "exchange-denied" }, "rejected"],
  ])("preserves exchange result %s when stop latches during submit", async (result, status) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const exchange = {
      submit: vi.fn(async () => { await gate; return result; }),
      cancel: vi.fn(), findByClientOrderId: vi.fn(),
    };
    const { coordinator } = setup({ exchange });
    const pending = coordinator.propose(signal, executionContext);
    await vi.waitFor(() => expect(exchange.submit).toHaveBeenCalledOnce());
    coordinator.emergencyStop();
    release();
    const outcome = await pending;
    expect(outcome.status).toBe("submitted");
    if (outcome.status !== "submitted") throw new Error("unexpected outcome");
    expect(outcome.order.status).toBe(status);
  });

  it("preserves an acknowledgement when stop latches during terminal save", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const repository = new MemoryOrderRepository();
    const terminalSave = vi.fn();
    vi.spyOn(repository, "save").mockImplementation(async (order, expectedVersion) => {
      if (order.status === "acknowledged") {
        terminalSave();
        await gate;
      }
      const current = repository.orders.get(order.clientOrderId);
      if ((current?.version ?? null) !== expectedVersion) throw new Error("optimistic conflict");
      repository.orders.set(order.clientOrderId, order);
      return order;
    });
    const { coordinator } = setup({ repository });
    const pending = coordinator.propose(signal, executionContext);
    await vi.waitFor(() => expect(terminalSave).toHaveBeenCalledOnce());
    coordinator.emergencyStop();
    release();
    const outcome = await pending;
    expect(outcome.status).toBe("submitted");
    if (outcome.status !== "submitted") throw new Error("unexpected outcome");
    expect(outcome.order.status).toBe("acknowledged");
    expect(repository.orders.get(outcome.order.clientOrderId)?.status).toBe("acknowledged");
  });

  it("atomically prevents distinct ids from submitting the same deployment symbol", async () => {
    const repository = new MemoryOrderRepository();
    let lookups = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    repository.listActive = vi.fn(async () => {
      lookups += 1;
      if (lookups === 2) release();
      await gate;
      return [];
    });
    const exchange = {
      submit: vi.fn(async () => ({ status: "acknowledged" as const, exchangeOrderId: "exchange-1" })),
      cancel: vi.fn(), findByClientOrderId: vi.fn(),
    };
    const first = setup({ repository, exchange }).coordinator;
    const second = setup({ repository, exchange }).coordinator;
    const outcomes = await Promise.all([
      first.propose(signal, executionContext),
      second.propose({ ...signal, id: "signal-2" }, { ...executionContext, signalSequence: 2 }),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["blocked", "submitted"]);
    expect(exchange.submit).toHaveBeenCalledTimes(1);
  });

  it("resumes a durable proposal after breaker denial", async () => {
    const circuitBreaker = {
      tryAcquire: vi.fn()
        .mockReturnValueOnce({ allowed: false as const, reason: "cooldown" as const })
        .mockReturnValue({ allowed: true as const, token: "token" }),
      recordSuccess: vi.fn(() => true),
      recordFailure: vi.fn(() => true),
    };
    const { coordinator, repository, exchange } = setup({ circuitBreaker });
    await expect(coordinator.propose(signal, executionContext)).resolves.toEqual({
      status: "blocked", reason: "circuit-breaker",
    });
    expect([...repository.orders.values()][0]?.status).toBe("proposed");
    const retried = await coordinator.propose(signal, executionContext);
    expect(retried.status).toBe("submitted");
    expect(exchange.submit).toHaveBeenCalledOnce();
  });

  it("resumes a durable proposal after emergency stop and paper resume", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const riskEvaluator = vi.fn(async () => {
      await gate;
      return evaluateOrderRisk(policy, riskContext, {
        symbol: "BTCUSDT", side: "buy", quantity: "0.1", price: "1000",
        expectedSlippageBps: "25", reduceOnly: false,
      }, instrument);
    });
    const { coordinator, repository, exchange } = setup({ riskEvaluator });
    const first = coordinator.propose(signal, executionContext);
    await vi.waitFor(() => expect(riskEvaluator).toHaveBeenCalledOnce());
    coordinator.emergencyStop();
    release();
    await expect(first).resolves.toEqual({ status: "blocked", reason: "emergency-stop" });
    expect([...repository.orders.values()][0]?.status).toBe("proposed");
    expect(coordinator.resumePaper("paper")).toBe(true);
    const retried = await coordinator.propose(signal, executionContext);
    expect(retried.status).toBe("submitted");
    expect(exchange.submit).toHaveBeenCalledOnce();
  });

  it("re-evaluates a durable proposal after a transient risk failure", async () => {
    const riskEvaluator = vi.fn()
      .mockRejectedValueOnce(new Error("risk unavailable"))
      .mockImplementation(evaluateOrderRisk);
    const { coordinator, repository, exchange } = setup({ riskEvaluator });
    await expect(coordinator.propose(signal, executionContext)).rejects.toThrow("risk unavailable");
    expect([...repository.orders.values()][0]?.status).toBe("proposed");
    const retried = await coordinator.propose(signal, executionContext);
    expect(retried.status).toBe("submitted");
    expect(exchange.submit).toHaveBeenCalledOnce();
  });
});
