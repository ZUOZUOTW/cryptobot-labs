import { describe, expect, it, vi } from "vitest";

import {
  CircuitBreaker,
  ExecutionCoordinator,
  createTrackedOrder,
  transitionOrder,
  type ExecutionCoordinatorDependencies,
  type OrderRepository,
  type TrackedOrder,
} from "../src";

class MemoryOrderRepository implements OrderRepository {
  readonly orders = new Map<string, TrackedOrder>();

  async getByClientOrderId(clientOrderId: string): Promise<TrackedOrder | null> {
    return this.orders.get(clientOrderId) ?? null;
  }

  async listActive(deploymentId: string): Promise<readonly TrackedOrder[]> {
    return [...this.orders.values()].filter((order) => order.deploymentId === deploymentId);
  }

  async claim(order: TrackedOrder) {
    this.orders.set(order.clientOrderId, order);
    return { claimed: true as const, order };
  }

  async save(order: TrackedOrder, expectedVersion: number | null): Promise<TrackedOrder> {
    const current = this.orders.get(order.clientOrderId);
    if ((current?.version ?? null) !== expectedVersion) throw new Error("optimistic conflict");
    this.orders.set(order.clientOrderId, order);
    return order;
  }
}

function orderAt(
  clientOrderId: string,
  status: "acknowledged" | "partially-filled" | "cancel-pending" | "unknown" | "filled",
): TrackedOrder {
  let order = createTrackedOrder({
    deploymentId: "deployment-1",
    clientOrderId,
    approvedIntent: {
      symbol: "BTCUSDT",
      side: "buy",
      quantity: "2",
      price: "1000",
      expectedSlippageBps: "25",
      reduceOnly: false,
    },
    at: 1,
  });
  order = transitionOrder(order, { type: "submit-start", at: 2 });
  order = transitionOrder(order, {
    type: "submit-acknowledged",
    exchangeOrderId: `exchange-${clientOrderId}`,
    at: 3,
  });
  if (status === "partially-filled" || status === "filled") {
    order = transitionOrder(order, {
      type: "fill-snapshot",
      cumulativeFilledQuantity: status === "filled" ? "2" : "1",
      averageFillPrice: "1001",
      fees: "0.1",
      at: 4,
    });
  }
  if (status === "cancel-pending") {
    order = transitionOrder(order, { type: "cancel-request", at: 4 });
  }
  if (status === "unknown") {
    order = {
      ...order,
      status: "unknown",
      reason: "submit-timeout",
      version: order.version + 1,
      updatedAt: 4,
    };
  }
  return order;
}

type CancelMock = ReturnType<typeof vi.fn<(...args: never[]) => Promise<unknown>>>;

function setup(
  repository = new MemoryOrderRepository(),
  cancel: CancelMock = vi.fn(async () => ({ status: "cancelled" as const })),
) {
  const exchange = {
    submit: vi.fn(),
    cancel,
    findByClientOrderId: vi.fn(),
  };
  const dependencies: ExecutionCoordinatorDependencies = {
    normalizer: { normalize: vi.fn() },
    riskEvaluator: vi.fn(),
    repository,
    exchange: exchange as ExecutionCoordinatorDependencies["exchange"],
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, windowMs: 1_000, cooldownMs: 1_000 }),
    failureClassifier: () => "unknown",
  };
  return { coordinator: new ExecutionCoordinator(dependencies), repository, exchange };
}

describe("ExecutionCoordinator cancellation", () => {
  it("claims acknowledged and partially-filled orders before cancelling each exactly once", async () => {
    const { coordinator, repository, exchange } = setup();
    repository.orders.set("ack", orderAt("ack", "acknowledged"));
    repository.orders.set("partial", orderAt("partial", "partially-filled"));

    const result = await coordinator.cancelOpenOrders("deployment-1", 10);

    expect(result).toMatchObject({ cancelled: 2, rejected: 0, unresolved: 0, skipped: 0 });
    expect(exchange.cancel).toHaveBeenCalledTimes(2);
    expect(repository.orders.get("ack")?.status).toBe("cancelled");
    expect(repository.orders.get("partial")?.status).toBe("cancelled");
    expect(exchange.submit).not.toHaveBeenCalled();
  });

  it("skips cancel-pending, unknown, and terminal orders without exchange side effects", async () => {
    const { coordinator, repository, exchange } = setup();
    repository.orders.set("pending", orderAt("pending", "cancel-pending"));
    repository.orders.set("unknown", orderAt("unknown", "unknown"));
    repository.orders.set("filled", orderAt("filled", "filled"));
    const proposed = createTrackedOrder({
      deploymentId: "deployment-1",
      clientOrderId: "proposed",
      approvedIntent: {
        symbol: "BTCUSDT", side: "buy", quantity: "2", price: "1000",
        expectedSlippageBps: "25", reduceOnly: false,
      },
      at: 1,
    });
    repository.orders.set("proposed", proposed);
    repository.orders.set("submitting", transitionOrder({ ...proposed, clientOrderId: "submitting" }, {
      type: "submit-start",
      at: 2,
    }));

    const result = await coordinator.cancelOpenOrders("deployment-1", 10);

    expect(result).toMatchObject({ cancelled: 0, rejected: 0, unresolved: 0, skipped: 5 });
    expect(exchange.cancel).not.toHaveBeenCalled();
    expect(exchange.submit).not.toHaveBeenCalled();
  });

  it("serializes concurrent claims across coordinators so only one cancel is sent", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const cancel = vi.fn(async () => {
      await gate;
      return { status: "cancelled" as const };
    });
    const repository = new MemoryOrderRepository();
    repository.orders.set("ack", orderAt("ack", "acknowledged"));
    const first = setup(repository, cancel).coordinator;
    const second = setup(repository, cancel).coordinator;

    const firstRun = first.cancelOpenOrders("deployment-1", 10);
    const secondRun = second.cancelOpenOrders("deployment-1", 10);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    release();
    const results = await Promise.all([firstRun, secondRun]);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(results.reduce((sum, result) => sum + result.cancelled, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.skipped, 0)).toBe(1);
  });

  it("keeps thrown, malformed, and explicit unknown cancellations unresolved and never retries", async () => {
    for (const implementation of [
      async () => { throw new Error("timeout after send"); },
      async () => ({ status: "unknown" as const, reason: "timeout" }),
      async () => ({ status: "cancelled" as const, surprise: true }),
    ]) {
      const cancel = vi.fn(implementation);
      const { coordinator, repository } = setup(new MemoryOrderRepository(), cancel);
      repository.orders.set("ack", orderAt("ack", "acknowledged"));

      const first = await coordinator.cancelOpenOrders("deployment-1", 10);
      const second = await coordinator.cancelOpenOrders("deployment-1", 11);

      expect(first).toMatchObject({ unresolved: 1 });
      expect(second).toMatchObject({ skipped: 1 });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(repository.orders.get("ack")?.status).toBe("cancel-pending");
    }
  });

  it("maps a rejection back to the legal pre-cancel state", async () => {
    const cancel = vi.fn(async () => ({ status: "rejected" as const, reason: "already closed" }));
    const { coordinator, repository } = setup(new MemoryOrderRepository(), cancel);
    repository.orders.set("partial", orderAt("partial", "partially-filled"));

    const result = await coordinator.cancelOpenOrders("deployment-1", 10);

    expect(result).toMatchObject({ rejected: 1, unresolved: 0 });
    expect(repository.orders.get("partial")?.status).toBe("partially-filled");
  });

  it("persists a known cancellation across a concurrent partial-fill conflict without resending", async () => {
    const repository = new MemoryOrderRepository();
    repository.orders.set("ack", orderAt("ack", "acknowledged"));
    let injectFill = true;
    vi.spyOn(repository, "save").mockImplementation(async (order, expectedVersion) => {
      const current = repository.orders.get(order.clientOrderId);
      if (order.status === "cancelled" && injectFill && current !== undefined) {
        injectFill = false;
        repository.orders.set(order.clientOrderId, transitionOrder(current, {
          type: "fill-snapshot",
          cumulativeFilledQuantity: "1",
          averageFillPrice: "1001",
          fees: "0.1",
          at: 11,
        }));
        throw new Error("optimistic conflict");
      }
      if ((current?.version ?? null) !== expectedVersion) throw new Error("optimistic conflict");
      repository.orders.set(order.clientOrderId, order);
      return order;
    });
    const { coordinator, exchange } = setup(repository);

    const result = await coordinator.cancelOpenOrders("deployment-1", 10);

    expect(result.cancelled).toBe(1);
    expect(exchange.cancel).toHaveBeenCalledOnce();
    expect(repository.orders.get("ack")?.status).toBe("cancelled");
    expect(repository.orders.get("ack")?.cumulativeFilledQuantity).toBe("1");
  });
});
