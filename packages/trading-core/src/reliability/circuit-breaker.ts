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

export type CircuitBreakerDenialReason =
  | "cooldown"
  | "probe-in-flight"
  | "fail-closed";

export type CircuitBreakerAcquisition =
  | { readonly allowed: true; readonly token: string }
  | { readonly allowed: false; readonly reason: CircuitBreakerDenialReason };

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

type AcquisitionKind = "closed" | "half-open";

interface ActiveAcquisition {
  readonly generation: number;
  readonly kind: AcquisitionKind;
}

const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 3_600_000;
const MAX_FAILURE_THRESHOLD = 100;

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
  "unknown",
]);

function assertSafeIntegerInRange(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${name} must be a safe integer between ${minimum} and ${maximum}`,
    );
  }
}

function assertPolicy(policy: CircuitBreakerPolicy): void {
  if (policy === null || typeof policy !== "object") {
    throw new TypeError("Circuit breaker policy must be an object");
  }
  assertSafeIntegerInRange(
    policy.failureThreshold,
    "failureThreshold",
    1,
    MAX_FAILURE_THRESHOLD,
  );
  assertSafeIntegerInRange(policy.windowMs, "windowMs", MIN_DURATION_MS, MAX_DURATION_MS);
  assertSafeIntegerInRange(
    policy.cooldownMs,
    "cooldownMs",
    MIN_DURATION_MS,
    MAX_DURATION_MS,
  );
}

function assertTimestamp(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError("Timestamp must be a non-negative safe integer");
  }
}

/** A deterministic, generation-scoped circuit breaker with an injected clock. */
export class CircuitBreaker {
  readonly #policy: Readonly<CircuitBreakerPolicy>;
  #state: CircuitBreakerState = "closed";
  #openedAt: number | null = null;
  #probeAcquired = false;
  #retryableFailures: number[] = [];
  #lastTimestamp: number | null = null;
  #permanentlyOpen = false;
  #generation = 0;
  #nextTokenSequence = 0;
  readonly #activeAcquisitions = new Map<string, ActiveAcquisition>();

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
    assertTimestamp(now);
    if (this.#lastTimestamp !== null && now < this.#lastTimestamp) {
      return false;
    }
    return this.#state === "closed";
  }

  tryAcquire(now: number): CircuitBreakerAcquisition {
    this.#observeMutatingTimestamp(now);

    if (this.#state === "closed") {
      return this.#issueToken("closed");
    }
    if (this.#state === "half-open") {
      return { allowed: false, reason: "probe-in-flight" };
    }
    if (this.#permanentlyOpen || this.#openedAt === null) {
      return { allowed: false, reason: "fail-closed" };
    }
    if (now - this.#openedAt < this.#policy.cooldownMs) {
      return { allowed: false, reason: "cooldown" };
    }

    this.#state = "half-open";
    this.#probeAcquired = true;
    return this.#issueToken("half-open");
  }

  recordSuccess(token: string, now: number): boolean {
    const acquisition = this.#activeAcquisitions.get(token);
    if (acquisition === undefined || acquisition.generation !== this.#generation) {
      return false;
    }

    this.#observeMutatingTimestamp(now);
    this.#activeAcquisitions.delete(token);

    if (acquisition.kind === "half-open" && this.#state === "half-open") {
      this.#state = "closed";
      this.#openedAt = null;
      this.#probeAcquired = false;
      this.#retryableFailures = [];
      this.#permanentlyOpen = false;
    }
    return true;
  }

  recordFailure(
    token: string,
    category: CircuitBreakerFailureCategory,
    now: number,
  ): boolean {
    const acquisition = this.#activeAcquisitions.get(token);
    if (acquisition === undefined || acquisition.generation !== this.#generation) {
      return false;
    }

    this.#observeMutatingTimestamp(now);
    this.#activeAcquisitions.delete(token);

    if (!failureCategories.has(category)) {
      this.#open(now);
      return true;
    }
    if (acquisition.kind === "half-open" && this.#state === "half-open") {
      this.#open(now);
      return true;
    }
    if (fatalCategories.has(category)) {
      this.#open(now);
      return true;
    }
    if (this.#state !== "closed") {
      return false;
    }

    const cutoff = now - this.#policy.windowMs;
    this.#retryableFailures = this.#retryableFailures.filter(
      (timestamp) => timestamp >= cutoff,
    );
    this.#retryableFailures.push(now);
    if (this.#retryableFailures.length > this.#policy.failureThreshold) {
      this.#retryableFailures = this.#retryableFailures.slice(-this.#policy.failureThreshold);
    }

    if (this.#retryableFailures.length >= this.#policy.failureThreshold) {
      this.#open(now);
    }
    return true;
  }

  #issueToken(kind: AcquisitionKind): CircuitBreakerAcquisition {
    this.#nextTokenSequence += 1;
    const token = `cb:${this.#generation}:${this.#nextTokenSequence}`;
    this.#activeAcquisitions.set(token, { generation: this.#generation, kind });
    return { allowed: true, token };
  }

  #open(now: number): void {
    this.#generation += 1;
    this.#state = "open";
    this.#openedAt = now;
    this.#probeAcquired = false;
    this.#activeAcquisitions.clear();
  }

  #observeMutatingTimestamp(now: number): void {
    try {
      assertTimestamp(now);
    } catch (error) {
      this.#failClosed();
      throw error;
    }
    if (this.#lastTimestamp !== null && now < this.#lastTimestamp) {
      this.#failClosed();
      throw new RangeError("Timestamp moved backward");
    }
    this.#lastTimestamp = now;
  }

  #failClosed(): void {
    this.#generation += 1;
    this.#state = "open";
    this.#openedAt = null;
    this.#probeAcquired = false;
    this.#permanentlyOpen = true;
    this.#activeAcquisitions.clear();
  }
}
