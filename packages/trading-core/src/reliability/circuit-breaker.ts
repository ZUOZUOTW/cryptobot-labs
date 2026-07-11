export type CircuitBreakerState = "closed" | "open" | "half-open";

export type CircuitBreakerFailureCategory =
  | "network"
  | "rate-limit"
  | "server"
  | "authentication"
  | "permission"
  | "clock"
  | "schema"
  | "sandbox"
  | "unknown";

export interface CircuitBreakerPolicy {
  readonly failureThreshold: number;
  readonly windowMs: number;
  readonly cooldownMs: number;
}

export interface CircuitBreakerSnapshot {
  readonly state: CircuitBreakerState;
  readonly openedAt: number | null;
  readonly probeAcquired: boolean;
  readonly retryableFailureCount: number;
}

const failureCategories = new Set<CircuitBreakerFailureCategory>([
  "network",
  "rate-limit",
  "server",
  "authentication",
  "permission",
  "clock",
  "schema",
  "sandbox",
  "unknown",
]);

const fatalCategories = new Set<CircuitBreakerFailureCategory>([
  "authentication",
  "permission",
  "clock",
  "schema",
  "sandbox",
]);

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function assertPolicy(policy: CircuitBreakerPolicy): void {
  if (policy === null || typeof policy !== "object") {
    throw new TypeError("Circuit breaker policy must be an object");
  }
  assertPositiveSafeInteger(policy.failureThreshold, "failureThreshold");
  assertPositiveSafeInteger(policy.windowMs, "windowMs");
  assertPositiveSafeInteger(policy.cooldownMs, "cooldownMs");
}

/**
 * A synchronous circuit breaker whose clock is supplied by its caller.
 * This keeps decisions deterministic and prevents hidden wall-clock access.
 */
export class CircuitBreaker {
  readonly #policy: Readonly<CircuitBreakerPolicy>;
  #state: CircuitBreakerState = "closed";
  #openedAt: number | null = null;
  #probeAcquired = false;
  #retryableFailures: number[] = [];
  #lastTimestamp: number | null = null;
  #permanentlyOpen = false;

  constructor(policy: CircuitBreakerPolicy) {
    assertPolicy(policy);
    this.#policy = Object.freeze({ ...policy });
  }

  get state(): CircuitBreakerState {
    return this.#state;
  }

  get snapshot(): Readonly<CircuitBreakerSnapshot> {
    return Object.freeze({
      state: this.#state,
      openedAt: this.#openedAt,
      probeAcquired: this.#probeAcquired,
      retryableFailureCount: this.#retryableFailures.length,
    });
  }

  canSubmit(now: number): boolean {
    this.#observeTimestamp(now);
    return this.#state === "closed";
  }

  tryAcquire(now: number): boolean {
    this.#observeTimestamp(now);

    if (this.#state === "closed") {
      return true;
    }
    if (
      this.#state === "half-open" ||
      this.#permanentlyOpen ||
      this.#openedAt === null ||
      now - this.#openedAt < this.#policy.cooldownMs
    ) {
      return false;
    }

    this.#state = "half-open";
    this.#probeAcquired = true;
    return true;
  }

  recordSuccess(now: number): void {
    this.#observeTimestamp(now);
    this.#state = "closed";
    this.#openedAt = null;
    this.#probeAcquired = false;
    this.#retryableFailures = [];
    this.#permanentlyOpen = false;
  }

  recordFailure(category: CircuitBreakerFailureCategory, now: number): void {
    this.#observeTimestamp(now);

    if (!failureCategories.has(category)) {
      this.#open(now);
      return;
    }

    if (this.#state === "half-open") {
      this.#open(now);
      return;
    }

    if (fatalCategories.has(category)) {
      this.#open(now);
      return;
    }

    if (this.#state === "open") {
      return;
    }

    const cutoff = now - this.#policy.windowMs;
    this.#retryableFailures = this.#retryableFailures.filter(
      (timestamp) => timestamp >= cutoff,
    );
    this.#retryableFailures.push(now);

    if (this.#retryableFailures.length >= this.#policy.failureThreshold) {
      this.#open(now);
    }
  }

  #open(now: number): void {
    this.#state = "open";
    this.#openedAt = now;
    this.#probeAcquired = false;
  }

  #observeTimestamp(now: number): void {
    if (!Number.isSafeInteger(now) || now < 0) {
      this.#failClosed();
      throw new TypeError("Timestamp must be a non-negative safe integer");
    }
    if (this.#lastTimestamp !== null && now < this.#lastTimestamp) {
      this.#failClosed();
      throw new RangeError("Timestamp moved backward");
    }
    this.#lastTimestamp = now;
  }

  #failClosed(): void {
    this.#state = "open";
    this.#openedAt = null;
    this.#probeAcquired = false;
    this.#permanentlyOpen = true;
  }
}
