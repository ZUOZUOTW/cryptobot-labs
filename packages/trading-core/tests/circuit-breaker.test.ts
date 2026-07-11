import { describe, expect, it, vi } from "vitest";

import {
  CircuitBreaker,
  type CircuitBreakerFailureCategory,
} from "../src/reliability";

const policy = { failureThreshold: 3, windowMs: 1_000, cooldownMs: 500 };

describe("CircuitBreaker", () => {
  it("opens when the retryable failure threshold is reached inside the rolling window", () => {
    const breaker = new CircuitBreaker(policy);
    breaker.recordFailure("network", 0);
    breaker.recordFailure("rate-limit", 100);
    expect(breaker.canSubmit(199)).toBe(true);
    breaker.recordFailure("server", 200);
    expect(breaker.state).toBe("open");
    expect(breaker.tryAcquire(201)).toBe(false);
  });

  it("counts a failure exactly at the rolling-window boundary", () => {
    const breaker = new CircuitBreaker(policy);
    breaker.recordFailure("network", 0);
    breaker.recordFailure("unknown", 999);
    breaker.recordFailure("server", 1_000);
    expect(breaker.state).toBe("open");
  });

  it("prunes failures older than the rolling window", () => {
    const breaker = new CircuitBreaker(policy);
    breaker.recordFailure("network", 0);
    breaker.recordFailure("unknown", 1_001);
    breaker.recordFailure("network", 1_002);
    expect(breaker.state).toBe("closed");
    expect(breaker.snapshot.retryableFailureCount).toBe(2);
  });

  it("opens immediately for fatal failure categories", () => {
    const categories = [
      "authentication",
      "permission",
      "clock",
      "schema",
      "sandbox",
    ] as const satisfies readonly CircuitBreakerFailureCategory[];

    for (const category of categories) {
      const breaker = new CircuitBreaker(policy);
      breaker.recordFailure(category, 0);
      expect(breaker.state).toBe("open");
    }
  });

  it("treats unknown as retryable rather than immediately fatal", () => {
    const breaker = new CircuitBreaker(policy);
    breaker.recordFailure("unknown", 0);
    expect(breaker.state).toBe("closed");
  });

  it("keeps canSubmit read-only even when cooldown has elapsed", () => {
    const breaker = new CircuitBreaker(policy);
    breaker.recordFailure("authentication", 0);
    expect(breaker.canSubmit(500)).toBe(false);
    expect(breaker.state).toBe("open");
    expect(breaker.snapshot.probeAcquired).toBe(false);
  });

  it("allows exactly one half-open probe at the cooldown boundary", () => {
    const breaker = new CircuitBreaker(policy);
    breaker.recordFailure("authentication", 0);
    expect(breaker.tryAcquire(499)).toBe(false);
    expect(breaker.tryAcquire(500)).toBe(true);
    expect(breaker.state).toBe("half-open");
    expect(breaker.tryAcquire(500)).toBe(false);
    expect(breaker.canSubmit(500)).toBe(false);
  });

  it("closes and resets after a successful half-open probe", () => {
    const breaker = new CircuitBreaker(policy);
    breaker.recordFailure("network", 0);
    breaker.recordFailure("network", 1);
    breaker.recordFailure("network", 2);
    expect(breaker.tryAcquire(502)).toBe(true);
    breaker.recordSuccess(503);
    expect(breaker.snapshot).toEqual({
      state: "closed",
      openedAt: null,
      probeAcquired: false,
      retryableFailureCount: 0,
    });
    expect(breaker.tryAcquire(503)).toBe(true);
  });

  it("reopens and restarts cooldown when a half-open probe fails", () => {
    const breaker = new CircuitBreaker(policy);
    breaker.recordFailure("authentication", 0);
    expect(breaker.tryAcquire(500)).toBe(true);
    breaker.recordFailure("network", 501);
    expect(breaker.state).toBe("open");
    expect(breaker.tryAcquire(1_000)).toBe(false);
    expect(breaker.tryAcquire(1_001)).toBe(true);
  });

  it("returns an immutable detached snapshot", () => {
    const breaker = new CircuitBreaker(policy);
    const snapshot = breaker.snapshot;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => Object.assign(snapshot, { state: "open" })).toThrow(TypeError);
    breaker.recordFailure("network", 0);
    expect(snapshot.retryableFailureCount).toBe(0);
    expect(breaker.snapshot.retryableFailureCount).toBe(1);
  });

  it.each([
    { failureThreshold: 0, windowMs: 1, cooldownMs: 1 },
    { failureThreshold: 1.5, windowMs: 1, cooldownMs: 1 },
    { failureThreshold: 1, windowMs: Number.NaN, cooldownMs: 1 },
    { failureThreshold: 1, windowMs: 1, cooldownMs: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects malformed policy $failureThreshold/$windowMs/$cooldownMs", (badPolicy) => {
    expect(() => new CircuitBreaker(badPolicy)).toThrow(TypeError);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects malformed timestamp %s",
    (now) => {
      const breaker = new CircuitBreaker(policy);
      expect(() => breaker.tryAcquire(now)).toThrow(TypeError);
    },
  );

  it("rejects timestamp regression across calls", () => {
    const breaker = new CircuitBreaker(policy);
    breaker.canSubmit(10);
    expect(() => breaker.tryAcquire(9)).toThrow(/backward/u);
  });

  it("fails closed for a malformed runtime failure category", () => {
    const breaker = new CircuitBreaker(policy);
    breaker.recordFailure("not-a-category" as CircuitBreakerFailureCategory, 0);
    expect(breaker.state).toBe("open");
  });

  it("never reads the wall clock", () => {
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("wall clock accessed");
    });
    try {
      const breaker = new CircuitBreaker(policy);
      expect(breaker.canSubmit(0)).toBe(true);
      breaker.recordFailure("network", 1);
      breaker.recordSuccess(2);
      expect(breaker.tryAcquire(3)).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
