import {
  WeexApiError,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from "@cryptobot-labs/weex-client";

const WEIGHT_WINDOW_MS = 10_000;
const ORDER_WINDOW_MS = 10_000;
const ORDER_MINUTE_MS = 60_000;

interface RateLimitSnapshot {
  readonly requestCount10s: number;
  readonly orderCount10s: number;
  readonly orderCount60s: number;
  readonly remainingWeight10s: number | null;
  readonly blockedUntil: number | null;
  readonly rateLimitEvents: number;
}

interface GovernorOptions {
  readonly now?: () => number;
  readonly scheduler?: (delayMs: number) => Promise<void>;
  readonly maximumWeight10s?: number;
  readonly maximumOrders10s?: number;
  readonly maximumOrders60s?: number;
}

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

const prune = (values: number[], minimum: number): void => {
  let count = 0;
  while (count < values.length && values[count]! <= minimum) count += 1;
  if (count > 0) values.splice(0, count);
};

const positiveLimit = (value: number | undefined, fallback: number, maximum: number): number => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new TypeError("Invalid WEEX rate limit");
  }
  return result;
};

export class AdaptiveWeexRateGovernor {
  readonly #now: () => number;
  readonly #scheduler: (delayMs: number) => Promise<void>;
  readonly #maximumWeight10s: number;
  readonly #maximumOrders10s: number;
  readonly #maximumOrders60s: number;
  readonly #requests: number[] = [];
  readonly #orders: number[] = [];
  #remainingWeight10s: number | null = null;
  #blockedUntil = 0;
  #rateLimitEvents = 0;
  #turn: Promise<void> = Promise.resolve();

  constructor(options: GovernorOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#scheduler = options.scheduler ?? sleep;
    // Keep headroom for account verification, operator actions and WEEX weight changes.
    this.#maximumWeight10s = positiveLimit(options.maximumWeight10s, 450, 500);
    this.#maximumOrders10s = positiveLimit(options.maximumOrders10s, 25, 30);
    this.#maximumOrders60s = positiveLimit(options.maximumOrders60s, 90, 100);
  }

  async acquire(order: boolean): Promise<void> {
    let release!: () => void;
    const previous = this.#turn;
    this.#turn = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      while (true) {
        const now = this.#now();
        prune(this.#requests, now - WEIGHT_WINDOW_MS);
        prune(this.#orders, now - ORDER_MINUTE_MS);
        const orders10s = this.#orders.filter((timestamp) => timestamp > now - ORDER_WINDOW_MS).length;
        const requestWait = this.#requests.length >= this.#maximumWeight10s
          ? this.#requests[0]! + WEIGHT_WINDOW_MS - now + 1 : 0;
        const order10sIndex = Math.max(0, this.#orders.length - orders10s);
        const order10sWait = order && orders10s >= this.#maximumOrders10s
          ? this.#orders[order10sIndex]! + ORDER_WINDOW_MS - now + 1 : 0;
        const order60sWait = order && this.#orders.length >= this.#maximumOrders60s
          ? this.#orders[0]! + ORDER_MINUTE_MS - now + 1 : 0;
        const waitMs = Math.max(0, this.#blockedUntil - now, requestWait, order10sWait, order60sWait);
        if (waitMs <= 0) {
          this.#requests.push(now);
          if (order) this.#orders.push(now);
          return;
        }
        await this.#scheduler(Math.min(waitMs, WEIGHT_WINDOW_MS));
      }
    } finally {
      release();
    }
  }

  observe(headers: Readonly<Record<string, string>>): void {
    const candidate = headers["x-remaining-weight-10s"];
    if (candidate !== undefined && /^\d+$/.test(candidate)) {
      this.#remainingWeight10s = Number(candidate);
      if (this.#remainingWeight10s <= 20) {
        this.#blockedUntil = Math.max(this.#blockedUntil, this.#now() + 1_000);
      }
    }
  }

  trip(error: unknown): void {
    if (!(error instanceof WeexApiError) || error.category !== "rate-limit") return;
    this.#rateLimitEvents += 1;
    this.#blockedUntil = Math.max(this.#blockedUntil, this.#now() + WEIGHT_WINDOW_MS);
  }

  snapshot(): RateLimitSnapshot {
    const now = this.#now();
    prune(this.#requests, now - WEIGHT_WINDOW_MS);
    prune(this.#orders, now - ORDER_MINUTE_MS);
    return Object.freeze({
      requestCount10s: this.#requests.length,
      orderCount10s: this.#orders.filter((timestamp) => timestamp > now - ORDER_WINDOW_MS).length,
      orderCount60s: this.#orders.length,
      remainingWeight10s: this.#remainingWeight10s,
      blockedUntil: this.#blockedUntil > now ? this.#blockedUntil : null,
      rateLimitEvents: this.#rateLimitEvents,
    });
  }
}

const isOrderRequest = (request: HttpRequest): boolean => {
  if (request.method !== "POST") return false;
  try {
    return /\/(?:api\/v3\/|capi\/v3\/(?:sim\/)?)order$/.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
};

export class RateLimitedWeexTransport implements HttpTransport {
  constructor(
    private readonly transport: HttpTransport,
    readonly governor = new AdaptiveWeexRateGovernor(),
  ) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    await this.governor.acquire(isOrderRequest(request));
    try {
      const response = await this.transport.send(request);
      this.governor.observe(response.headers);
      return response;
    } catch (error) {
      this.governor.trip(error);
      throw error;
    }
  }
}
