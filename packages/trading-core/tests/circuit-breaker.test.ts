import { describe, expect, it, vi } from "vitest";

import {
  CircuitBreaker,
  MAX_IN_FLIGHT_ACQUISITIONS,
  type CircuitBreakerFailureCategory,
} from "../src/reliability";

const policy = { failureThreshold: 3, windowMs: 1_000, cooldownMs: 1_000 };

function acquireToken(breaker: CircuitBreaker, now: number): string {
  const acquisition = breaker.tryAcquire(now);
  expect(acquisition.allowed).toBe(true);
  if (!acquisition.allowed) throw new Error("Expected acquisition token");
  return acquisition.token;
}

function fail(
  breaker: CircuitBreaker,
  category: CircuitBreakerFailureCategory,
  now: number,
): boolean {
  const token = acquireToken(breaker, now);
  return breaker.recordFailure(token, category, now);
}

describe("CircuitBreaker", () => {
  it("opens at the retryable threshold within the rolling window", () => {
    const breaker = new CircuitBreaker(policy);
    expect(fail(breaker, "network", 0)).toBe(true);
    expect(fail(breaker, "rate-limit", 100)).toBe(true);
    expect(fail(breaker, "server", 200)).toBe(true);
    expect(breaker.state).toBe("open");
    expect(breaker.tryAcquire(201)).toEqual({ allowed: false, reason: "cooldown" });
  });

  it("counts the exact rolling-window boundary and prunes older failures", () => {
    const atBoundary = new CircuitBreaker(policy);
    fail(atBoundary, "network", 0);
    fail(atBoundary, "network", 999);
    fail(atBoundary, "network", 1_000);
    expect(atBoundary.state).toBe("open");

    const outside = new CircuitBreaker(policy);
    fail(outside, "network", 0);
    fail(outside, "network", 1_001);
    fail(outside, "network", 1_002);
    expect(outside.state).toBe("closed");
    expect(outside.snapshot.retryableFailureCount).toBe(2);
  });

  it("does not clear rolling failures on ordinary closed-state successes", () => {
    const breaker = new CircuitBreaker(policy);
    fail(breaker, "network", 0);
    expect(breaker.recordSuccess(acquireToken(breaker, 1), 1)).toBe(true);
    fail(breaker, "network", 2);
    expect(breaker.recordSuccess(acquireToken(breaker, 3), 3)).toBe(true);
    fail(breaker, "network", 4);
    expect(breaker.state).toBe("open");
  });

  it.each([
    "authentication",
    "permission",
    "clock",
    "schema",
    "sandbox",
    "unknown",
  ] as const)("opens immediately for %s", (category) => {
    const breaker = new CircuitBreaker(policy);
    fail(breaker, category, 0);
    expect(breaker.state).toBe("open");
  });

  it("allows exactly one half-open probe at the cooldown boundary", () => {
    const breaker = new CircuitBreaker(policy);
    fail(breaker, "authentication", 0);
    expect(breaker.tryAcquire(999)).toEqual({ allowed: false, reason: "cooldown" });
    const probe = breaker.tryAcquire(1_000);
    expect(probe.allowed).toBe(true);
    expect(breaker.state).toBe("half-open");
    expect(breaker.tryAcquire(1_000)).toEqual({
      allowed: false,
      reason: "probe-in-flight",
    });
  });

  it("only closes after a successful half-open probe", () => {
    const breaker = new CircuitBreaker(policy);
    fail(breaker, "authentication", 0);
    const probe = acquireToken(breaker, 1_000);
    expect(breaker.recordSuccess(probe, 1_001)).toBe(true);
    expect(breaker.snapshot).toEqual({
      state: "closed",
      openedAt: null,
      probeAcquired: false,
      retryableFailureCount: 0,
    });
  });

  it("reopens and restarts cooldown after a half-open probe failure", () => {
    const breaker = new CircuitBreaker(policy);
    fail(breaker, "authentication", 0);
    const probe = acquireToken(breaker, 1_000);
    expect(breaker.recordFailure(probe, "network", 1_001)).toBe(true);
    expect(breaker.tryAcquire(2_000)).toEqual({ allowed: false, reason: "cooldown" });
    expect(breaker.tryAcquire(2_001).allowed).toBe(true);
  });

  it("ignores stale success after a concurrent fatal trip", () => {
    const breaker = new CircuitBreaker(policy);
    const older = acquireToken(breaker, 0);
    const fatal = acquireToken(breaker, 0);
    expect(breaker.recordFailure(fatal, "authentication", 1)).toBe(true);
    expect(breaker.recordSuccess(older, 2)).toBe(false);
    expect(breaker.state).toBe("open");
  });

  it("ignores stale out-of-order failures from an earlier generation", () => {
    const breaker = new CircuitBreaker(policy);
    const stale = acquireToken(breaker, 0);
    fail(breaker, "authentication", 1);
    const probe = acquireToken(breaker, 1_001);
    breaker.recordSuccess(probe, 1_002);
    expect(breaker.recordFailure(stale, "authentication", 1_003)).toBe(false);
    expect(breaker.state).toBe("closed");
  });

  it("rejects duplicate settlement of the same acquisition token", () => {
    const breaker = new CircuitBreaker(policy);
    const token = acquireToken(breaker, 0);
    expect(breaker.recordSuccess(token, 0)).toBe(true);
    expect(breaker.recordFailure(token, "authentication", 0)).toBe(false);
    expect(breaker.state).toBe("closed");
  });

  it("bounds in-flight acquisitions and reuses capacity without token collision", () => {
    expect(MAX_IN_FLIGHT_ACQUISITIONS).toBe(1_024);
    const breaker = new CircuitBreaker(policy);
    const tokens = new Set<string>();
    for (let index = 0; index < MAX_IN_FLIGHT_ACQUISITIONS; index += 1) {
      tokens.add(acquireToken(breaker, 0));
    }
    expect(tokens.size).toBe(MAX_IN_FLIGHT_ACQUISITIONS);
    expect(breaker.tryAcquire(0)).toEqual({
      allowed: false,
      reason: "too-many-in-flight",
    });
    expect(breaker.state).toBe("closed");

    const [settled] = tokens;
    expect(settled).toBeDefined();
    expect(breaker.recordSuccess(settled!, 0)).toBe(true);
    const replacement = acquireToken(breaker, 0);
    expect(tokens.has(replacement)).toBe(false);
  });

  it("keeps canSubmit observational and returns false on timestamp regression", () => {
    const breaker = new CircuitBreaker(policy);
    const token = acquireToken(breaker, 10);
    expect(breaker.canSubmit(9)).toBe(false);
    expect(breaker.state).toBe("closed");
    expect(breaker.recordSuccess(token, 10)).toBe(true);

    const fresh = new CircuitBreaker(policy);
    expect(fresh.canSubmit(10)).toBe(true);
    expect(acquireToken(fresh, 0)).toBeTypeOf("string");
  });

  it("keeps canSubmit false in open and half-open states without consuming a probe", () => {
    const breaker = new CircuitBreaker(policy);
    fail(breaker, "authentication", 0);
    expect(breaker.canSubmit(1_000)).toBe(false);
    const probe = breaker.tryAcquire(1_000);
    expect(probe.allowed).toBe(true);
    expect(breaker.canSubmit(1_000)).toBe(false);
  });

  it("returns an immutable detached snapshot", () => {
    const breaker = new CircuitBreaker(policy);
    const snapshot = breaker.snapshot;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => Object.assign(snapshot, { state: "open" })).toThrow(TypeError);
    fail(breaker, "network", 0);
    expect(snapshot.retryableFailureCount).toBe(0);
    expect(breaker.snapshot.retryableFailureCount).toBe(1);
  });

  it.each([
    { failureThreshold: 0, windowMs: 1_000, cooldownMs: 1_000 },
    { failureThreshold: 101, windowMs: 1_000, cooldownMs: 1_000 },
    { failureThreshold: 1, windowMs: 999, cooldownMs: 1_000 },
    { failureThreshold: 1, windowMs: 3_600_001, cooldownMs: 1_000 },
    { failureThreshold: 1, windowMs: 1_000, cooldownMs: 999 },
    { failureThreshold: 1, windowMs: 1_000, cooldownMs: 3_600_001 },
  ])("rejects out-of-bounds policy", (badPolicy) => {
    expect(() => new CircuitBreaker(badPolicy)).toThrow(TypeError);
  });

  it("accepts inclusive policy bounds", () => {
    expect(() =>
      new CircuitBreaker({ failureThreshold: 1, windowMs: 1_000, cooldownMs: 1_000 })
    ).not.toThrow();
    expect(() =>
      new CircuitBreaker({
        failureThreshold: 100,
        windowMs: 3_600_000,
        cooldownMs: 3_600_000,
      })
    ).not.toThrow();
  });

  it("caps retained retryable failure storage at the threshold", () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 100,
      windowMs: 1_000,
      cooldownMs: 1_000,
    });
    for (let index = 0; index < 100; index += 1) {
      fail(breaker, "network", index);
    }
    expect(breaker.snapshot.retryableFailureCount).toBe(100);
    expect(breaker.state).toBe("open");
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects malformed mutating timestamp %s and fails closed",
    (now) => {
      const breaker = new CircuitBreaker(policy);
      expect(() => breaker.tryAcquire(now)).toThrow(TypeError);
      expect(breaker.state).toBe("open");
    },
  );

  it("fails closed on timestamp regression in a mutating path", () => {
    const breaker = new CircuitBreaker(policy);
    acquireToken(breaker, 10);
    expect(() => breaker.tryAcquire(9)).toThrow(/backward/u);
    expect(breaker.state).toBe("open");
  });

  it("fails closed for a malformed runtime failure category", () => {
    const breaker = new CircuitBreaker(policy);
    const token = acquireToken(breaker, 0);
    breaker.recordFailure(token, "not-a-category" as CircuitBreakerFailureCategory, 0);
    expect(breaker.state).toBe("open");
  });

  it("never reads the wall clock", () => {
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("wall clock accessed");
    });
    try {
      const breaker = new CircuitBreaker(policy);
      const token = acquireToken(breaker, 0);
      breaker.recordFailure(token, "network", 1);
      expect(breaker.canSubmit(2)).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
