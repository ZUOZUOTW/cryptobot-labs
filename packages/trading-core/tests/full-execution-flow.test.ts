import { describe, expect, it, vi } from "vitest";

import {
  CircuitBreaker,
  ExecutionCoordinator,
  evaluateOrderRisk,
  type ExecutionContext,
  type OrderRepository,
  type TrackedOrder,
} from "../src";
import { context as riskContext, instrument, intent, policy } from "./fixtures/risk";

class MemoryRepository implements OrderRepository {
  readonly orders = new Map<string, TrackedOrder>();

  async getByClientOrderId(clientOrderId: string): Promise<TrackedOrder | null> {
    return this.orders.get(clientOrderId) ?? null;
  }

  async listActive(deploymentId: string): Promise<readonly TrackedOrder[]> {
    return [...this.orders.values()].filter((order) =>
      order.deploymentId === deploymentId &&
      ["proposed", "submitting", "acknowledged", "partially-filled", "unknown"].includes(order.status));
  }

  async claim(order: TrackedOrder) {
    const current = this.orders.get(order.clientOrderId);
    if (current) return { claimed: false as const, reason: "client-order-id-exists" as const, order: current };
    this.orders.set(order.clientOrderId, order);
    return { claimed: true as const, order };
  }

  async save(order: TrackedOrder, expectedVersion: number | null): Promise<TrackedOrder> {
    if ((this.orders.get(order.clientOrderId)?.version ?? null) !== expectedVersion) {
      throw new Error("optimistic conflict");
    }
    this.orders.set(order.clientOrderId, order);
    return order;
  }
}

describe("full trusted execution flow", () => {
  it("risk-checks paper orders, submits once, remains idempotent, and obeys local emergency stop", async () => {
    const repository = new MemoryRepository();
    const exchange = {
      submit: vi.fn(async () => ({ status: "acknowledged" as const, exchangeOrderId: "paper-order-1" })),
      findByClientOrderId: vi.fn(async () => null),
      cancel: vi.fn(async () => ({ status: "cancelled" as const })),
    };
    const coordinator = new ExecutionCoordinator({
      normalizer: { normalize: vi.fn(async () => intent) },
      riskEvaluator: evaluateOrderRisk,
      repository,
      exchange,
      circuitBreaker: new CircuitBreaker({ failureThreshold: 3, windowMs: 60_000, cooldownMs: 30_000 }),
      failureClassifier: () => "unknown",
    });
    const executionContext: ExecutionContext = {
      deploymentId: "paper-deployment",
      configurationVersion: "configuration-1",
      signalSequence: 1,
      market: "spot",
      mode: "paper",
      referencePrice: "1000",
      riskPolicy: policy,
      riskContext,
      instrumentRules: instrument,
      now: 10_000,
    };
    const signal = { id: "signal-1", action: "buy" as const, reason: "paper-entry", createdAt: 10_000 };

    const first = await coordinator.propose(signal, executionContext);
    const duplicate = await coordinator.propose(signal, executionContext);
    coordinator.emergencyStop();
    const stopped = await coordinator.propose(
      { ...signal, id: "signal-2", createdAt: 10_001 },
      { ...executionContext, signalSequence: 2, now: 10_001 },
    );

    expect(first.status).toBe("submitted");
    expect(duplicate.status).toBe("idempotent");
    expect(stopped).toEqual({ status: "blocked", reason: "emergency-stop" });
    expect(exchange.submit).toHaveBeenCalledOnce();
    expect(exchange.submit).toHaveBeenCalledWith(expect.objectContaining({
      target: { market: "spot", mode: "paper" },
    }));
  });
});
