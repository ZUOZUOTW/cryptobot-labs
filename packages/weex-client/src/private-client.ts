import type {
  CancelOutcome,
  ExchangeOrderQuery,
  ExchangeOrderSnapshot,
  ExchangeSubmitRequest,
  ExecutionTarget,
  InstrumentRules,
  SubmitOutcome,
} from "@cryptobot-labs/trading-core";
import {
  isExecutionTarget,
  isValidInstrumentRules,
} from "@cryptobot-labs/trading-core";

import type { WeexClock } from "./clock";
import { WeexApiError, mapWeexError } from "./errors";
import {
  isBoundedIdentifier,
  isCanonicalPositiveDecimal,
  isFuturesClientOrderId,
  isPrivateSymbol,
  parseAcknowledgedOrder,
  parseCancellation,
  parseOrderCollection,
  parseOrderSnapshot,
  unwrapPrivateBody,
  type ExpectedOrderIdentity,
} from "./orders";
import {
  buildPrivateHeaders,
  buildSignaturePayload,
  canonicalJson,
  canonicalQuery,
  signWeexRequest,
  type QueryEntry,
} from "./signing";
import type { HttpMethod, HttpResponse, HttpTransport } from "./transport";

const ORIGIN = {
  spot: "https://api-spot.weex.com",
  futures: "https://api-contract.weex.com",
} as const;
const MAX_RULES_AGE_MS = 5 * 60_000;
const MAX_GET_ATTEMPTS = 3;
const MAX_ORDER_SEARCH_PAGES = 10;
const ORDER_SEARCH_PAGE_SIZE = 100;
const MAX_IDENTITY_CACHE = 1_024;

export interface PrivateClock {
  now(): number;
  assertPrivateRequestWindow(requestTimestampMs: number): void;
}

/** Secret container deliberately has no enumerable fields or JSON representation. */
export class WeexCredentials {
  readonly #apiKey: string;
  readonly #secretKey: string;
  readonly #passphrase: string;

  constructor(apiKey: string, secretKey: string, passphrase: string) {
    for (const [label, value] of [["API key", apiKey], ["secret key", secretKey], ["passphrase", passphrase]] as const) {
      if (typeof value !== "string" || value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new WeexApiError(`Invalid WEEX ${label}`, { category: "validation", retryable: false });
      }
    }
    this.#apiKey = apiKey;
    this.#secretKey = secretKey;
    this.#passphrase = passphrase;
    Object.freeze(this);
  }

  use<T>(operation: (secrets: Readonly<{ apiKey: string; secretKey: string; passphrase: string }>) => T): T {
    return operation({ apiKey: this.#apiKey, secretKey: this.#secretKey, passphrase: this.#passphrase });
  }
}

export interface InstrumentRulesSnapshot {
  readonly rules: InstrumentRules;
  readonly verifiedAt: number;
}

export type InstrumentRulesProvider = (
  target: ExecutionTarget,
  symbol: string,
) => Promise<InstrumentRulesSnapshot>;

export interface VerifiedAccountSummary {
  readonly market: "spot" | "futures";
  readonly mode: "live" | "futures-demo";
  readonly verifiedAt: number;
  readonly canTrade: boolean | "unknown";
  readonly readPermission: true;
  readonly withdrawalPermission: "absent" | "present" | "unknown";
  readonly positionMode: "hedge" | "one-way" | "unknown";
  readonly balanceAssetCount: number;
}

export interface WeexPrivateClientOptions {
  readonly transport: HttpTransport;
  readonly credentials: WeexCredentials;
  readonly clock: WeexClock | PrivateClock;
  readonly rulesProvider?: InstrumentRulesProvider;
  readonly scheduler?: (delayMs: number) => Promise<void>;
  readonly now?: () => number;
  readonly maximumGetAttempts?: number;
}

interface Route {
  readonly origin: string;
  readonly path: string;
}

function validation(message: string): WeexApiError {
  return new WeexApiError(message, { category: "validation", retryable: false });
}

function schema(message: string): WeexApiError {
  return new WeexApiError(message, { category: "schema", retryable: false });
}

function assertTarget(target: unknown): asserts target is ExecutionTarget {
  if (!isExecutionTarget(target)) throw validation("Invalid WEEX execution target");
}

function accountRoute(target: ExecutionTarget): Route {
  if (target.market === "spot") return { origin: ORIGIN.spot, path: "/api/v3/account" };
  return {
    origin: ORIGIN.futures,
    path: target.mode === "live" ? "/capi/v3/account/balance" : "/capi/v3/sim/balance",
  };
}

const FUTURES_ACCOUNT_CONFIG: Route = {
  origin: ORIGIN.futures,
  path: "/capi/v3/account/accountConfig",
};

function orderRoute(target: ExecutionTarget): Route {
  if (target.market === "spot") return { origin: ORIGIN.spot, path: "/api/v3/order" };
  return {
    origin: ORIGIN.futures,
    path: target.mode === "live" ? "/capi/v3/order" : "/capi/v3/sim/order",
  };
}

function futuresSearchRoutes(target: ExecutionTarget): readonly Route[] {
  if (target.market !== "futures") throw validation("Futures search requires a futures target");
  return target.mode === "live"
    ? [
        { origin: ORIGIN.futures, path: "/capi/v3/openOrders" },
        { origin: ORIGIN.futures, path: "/capi/v3/order/history" },
      ]
    : [{ origin: ORIGIN.futures, path: "/capi/v3/sim/order/history" }];
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function retryableGet(error: unknown): boolean {
  const cause = error instanceof DispatchedRequestError ? error.failure : error;
  return cause instanceof WeexApiError &&
    (cause.category === "network" || cause.category === "rate-limit" || cause.category === "server");
}

class DispatchedRequestError extends Error {
  constructor(readonly failure: unknown) {
    super("WEEX request failed after dispatch", { cause: failure });
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw schema(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function unwrapGet(body: unknown): unknown {
  const envelope = unwrapPrivateBody(body);
  if (!envelope.ok) throw mapWeexError(400, { code: "-1045", message: envelope.reason });
  return envelope.data;
}

const UNSIGNED_AMOUNT = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;
const SIGNED_AMOUNT = /^-?(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;

function validateBalanceCollection(value: unknown, market: "spot" | "futures"): number {
  if (!Array.isArray(value) || value.length > 500) throw schema("Invalid account balance collection");
  for (const item of value) {
    const balance = record(item, "account balance");
    const asset = balance.asset ?? balance.coin;
    if (typeof asset !== "string" || !/^[A-Z0-9]{1,16}$/.test(asset)) throw schema("Invalid account balance asset");
    const required = market === "spot"
      ? ["free", "locked"] as const
      : ["balance", "availableBalance", "unrealizePnl"] as const;
    for (const key of required) {
      const amount = balance[key];
      const pattern = key === "unrealizePnl" ? SIGNED_AMOUNT : UNSIGNED_AMOUNT;
      if (typeof amount !== "string" || !pattern.test(amount)) {
        throw schema(`Invalid account balance ${key}`);
      }
    }
  }
  return value.length;
}

function parseAccount(
  body: unknown,
  target: ExecutionTarget,
  verifiedAt: number,
  configBody?: unknown,
): VerifiedAccountSummary {
  const data = unwrapGet(body);
  if (target.market === "spot") {
    const account = record(data, "spot account");
    if (typeof account.canTrade !== "boolean" || typeof account.canWithdraw !== "boolean") {
      throw schema("Invalid spot account permissions");
    }
    const balanceAssetCount = validateBalanceCollection(account.balances, "spot");
    return {
      market: "spot", mode: "live", verifiedAt, canTrade: account.canTrade,
      readPermission: true,
      withdrawalPermission: account.canWithdraw ? "present" : "absent",
      positionMode: "unknown",
      balanceAssetCount,
    };
  }
  const collection = Array.isArray(data)
    ? data
    : (() => {
        const source = record(data, "futures account balance response");
        return source.balances ?? source.assets ?? source.list;
      })();
  const balanceAssetCount = validateBalanceCollection(collection, "futures");
  if (target.mode === "futures-demo") {
    return {
      market: "futures", mode: target.mode, verifiedAt, canTrade: "unknown",
      readPermission: true, withdrawalPermission: "unknown", positionMode: "unknown",
      balanceAssetCount,
    };
  }
  const config = record(unwrapGet(configBody), "futures account config");
  for (const key of ["canTrade", "canDeposit", "canWithdraw", "dualSidePosition"] as const) {
    if (typeof config[key] !== "boolean") throw schema(`Invalid futures account config ${key}`);
  }
  const updateTime = typeof config.updateTime === "string" && /^\d+$/.test(config.updateTime)
    ? Number(config.updateTime)
    : config.updateTime;
  if (!Number.isSafeInteger(updateTime) || (updateTime as number) < 0) throw schema("Invalid futures account config updateTime");
  return {
    market: "futures", mode: "live", verifiedAt, canTrade: config.canTrade as boolean,
    readPermission: true,
    withdrawalPermission: config.canWithdraw ? "present" : "absent",
    positionMode: config.dualSidePosition ? "hedge" : "one-way",
    balanceAssetCount,
  };
}

function decimalParts(value: string): readonly [bigint, number] {
  const [integer, fraction = ""] = value.split(".");
  return [BigInt(integer + fraction), fraction.length];
}

function isMultiple(value: string, step: string): boolean {
  const [valueInt, valueScale] = decimalParts(value);
  const [stepInt, stepScale] = decimalParts(step);
  const scale = Math.max(valueScale, stepScale);
  const adjustedValue = valueInt * BigInt(10) ** BigInt(scale - valueScale);
  const adjustedStep = stepInt * BigInt(10) ** BigInt(scale - stepScale);
  return adjustedStep > BigInt(0) && adjustedValue % adjustedStep === BigInt(0);
}

function compareDecimals(left: string, right: string): number {
  const [leftInt, leftScale] = decimalParts(left);
  const [rightInt, rightScale] = decimalParts(right);
  const scale = Math.max(leftScale, rightScale);
  const a = leftInt * BigInt(10) ** BigInt(scale - leftScale);
  const b = rightInt * BigInt(10) ** BigInt(scale - rightScale);
  return a === b ? 0 : a < b ? -1 : 1;
}

export class WeexPrivateClient {
  readonly #transport: HttpTransport;
  readonly #credentials: WeexCredentials;
  readonly #clock: PrivateClock;
  readonly #rulesProvider?: InstrumentRulesProvider;
  readonly #scheduler: (delayMs: number) => Promise<void>;
  readonly #now: () => number;
  readonly #maximumGetAttempts: number;
  readonly #identities = new Map<string, ExpectedOrderIdentity>();
  #verifiedFuturesLive: {
    readonly canTrade: boolean;
    readonly canWithdraw: boolean;
    readonly dualSidePosition: boolean;
    readonly verifiedAt: number;
  } | undefined;

  constructor(options: WeexPrivateClientOptions) {
    if (!options || typeof options.transport?.send !== "function" || !(options.credentials instanceof WeexCredentials) ||
        typeof options.clock?.now !== "function" || typeof options.clock?.assertPrivateRequestWindow !== "function") {
      throw validation("Invalid WEEX private client options");
    }
    const attempts = options.maximumGetAttempts ?? MAX_GET_ATTEMPTS;
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > MAX_GET_ATTEMPTS) {
      throw validation("Invalid maximum GET attempts");
    }
    this.#transport = options.transport;
    this.#credentials = options.credentials;
    this.#clock = options.clock;
    this.#rulesProvider = options.rulesProvider;
    this.#scheduler = options.scheduler ?? sleep;
    this.#now = options.now ?? (() => this.#clock.now());
    this.#maximumGetAttempts = attempts;
  }

  async #signedRequest(
    method: HttpMethod,
    route: Route,
    queryEntries: readonly QueryEntry[] = [],
    bodyValue?: unknown,
  ): Promise<HttpResponse> {
    const query = canonicalQuery(queryEntries);
    const body = bodyValue === undefined ? "" : canonicalJson(bodyValue);
    const rawTimestamp = this.#clock.now();
    if (!Number.isFinite(rawTimestamp) || rawTimestamp < 0) throw validation("Invalid private request timestamp");
    const requestTimestamp = Math.floor(rawTimestamp);
    this.#clock.assertPrivateRequestWindow(requestTimestamp);
    const timestamp = String(requestTimestamp);
    return this.#credentials.use(async ({ apiKey, secretKey, passphrase }) => {
      const payload = buildSignaturePayload({ timestamp, method, requestPath: route.path, query, body });
      const signature = await signWeexRequest(payload, secretKey);
      try {
        const response = await this.#transport.send({
          method,
          url: `${route.origin}${route.path}${query ? `?${query}` : ""}`,
          headers: buildPrivateHeaders({ apiKey, passphrase, timestamp, signature }),
          ...(body ? { body } : {}),
        });
        if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599) {
          throw schema("Invalid HTTP response status");
        }
        if (response.status >= 400) throw mapWeexError(response.status, response.body);
        return response;
      } catch (error) {
        throw new DispatchedRequestError(error);
      }
    });
  }

  async #safeGet(route: Route, queryEntries: readonly QueryEntry[] = []): Promise<HttpResponse> {
    for (let attempt = 1; attempt <= this.#maximumGetAttempts; attempt += 1) {
      try {
        const response = await this.#signedRequest("GET", route, queryEntries);
        const envelope = unwrapPrivateBody(response.body);
        if (!envelope.ok) throw mapWeexError(400, response.body);
        return response;
      } catch (error) {
        if (!retryableGet(error) || attempt === this.#maximumGetAttempts) {
          throw error instanceof DispatchedRequestError ? error.failure : error;
        }
        await this.#scheduler(100 * 2 ** (attempt - 1));
      }
    }
    throw new Error("unreachable");
  }

  async #validateOrder(request: ExchangeSubmitRequest): Promise<ExpectedOrderIdentity> {
    assertTarget(request?.target);
    if (!(request.target.market === "futures"
      ? isFuturesClientOrderId(request.clientOrderId)
      : isBoundedIdentifier(request.clientOrderId))) throw validation("Invalid client order id");
    const intent = request.intent;
    if (!intent || !isPrivateSymbol(intent.symbol) || (intent.side !== "buy" && intent.side !== "sell") ||
        !isCanonicalPositiveDecimal(intent.quantity) || !isCanonicalPositiveDecimal(intent.price) ||
        typeof intent.reduceOnly !== "boolean") {
      throw validation("Invalid approved order intent");
    }
    if (request.target.market === "spot" &&
        ((intent.side === "sell" && !intent.reduceOnly) || (intent.side === "buy" && intent.reduceOnly))) {
      throw validation("Unsafe spot order direction");
    }
    if (request.target.market === "futures" && request.target.mode === "live") {
      const verified = this.#verifiedFuturesLive;
      const now = this.#now();
      if (!verified || !verified.canTrade || verified.canWithdraw || !verified.dualSidePosition ||
          !Number.isSafeInteger(now) || now < verified.verifiedAt || now - verified.verifiedAt > MAX_RULES_AGE_MS) {
        throw validation("Verified futures hedge-mode trading permission is required");
      }
    }
    if (!this.#rulesProvider) throw validation("Current instrument rules are required before order submission");
    {
      const snapshot = await this.#rulesProvider(request.target, intent.symbol);
      const now = this.#now();
      if (!isValidInstrumentRules(snapshot?.rules) || snapshot.rules.market !== request.target.market ||
          snapshot.rules.symbol !== intent.symbol || !Number.isSafeInteger(snapshot.verifiedAt) ||
          !Number.isSafeInteger(now) || snapshot.verifiedAt > now || now - snapshot.verifiedAt > MAX_RULES_AGE_MS) {
        throw validation("Missing, stale, or mismatched instrument rules");
      }
      if (!isMultiple(intent.quantity, snapshot.rules.stepSize) ||
          !isMultiple(intent.price, snapshot.rules.tickSize) ||
          compareDecimals(intent.quantity, snapshot.rules.minimumQuantity) < 0) {
        throw validation("Order violates current instrument precision or minimums");
      }
    }
    return {
      clientOrderId: request.clientOrderId,
      symbol: intent.symbol,
      side: intent.side,
      quantity: intent.quantity,
    };
  }

  #rememberIdentity(key: string, identity: ExpectedOrderIdentity): void {
    this.#identities.delete(key);
    while (this.#identities.size >= MAX_IDENTITY_CACHE) {
      const oldest = this.#identities.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#identities.delete(oldest);
    }
    this.#identities.set(key, identity);
  }

  async verifyAccount(target: ExecutionTarget): Promise<VerifiedAccountSummary> {
    assertTarget(target);
    const response = await this.#safeGet(accountRoute(target));
    const configResponse = target.market === "futures" && target.mode === "live"
      ? await this.#safeGet(FUTURES_ACCOUNT_CONFIG)
      : undefined;
    const summary = parseAccount(response.body, target, Math.floor(this.#now()), configResponse?.body);
    if (target.market === "futures" && target.mode === "live") {
      this.#verifiedFuturesLive = {
        canTrade: summary.canTrade === true,
        canWithdraw: summary.withdrawalPermission === "present",
        dualSidePosition: summary.positionMode === "hedge",
        verifiedAt: summary.verifiedAt,
      };
    }
    return summary;
  }

  async submitOrder(request: ExchangeSubmitRequest): Promise<SubmitOutcome> {
    const identity = await this.#validateOrder(request);
    const { intent, target, clientOrderId } = request;
    const body = {
      symbol: intent.symbol,
      side: intent.side.toUpperCase(),
      type: "LIMIT",
      timeInForce: "GTC",
      quantity: intent.quantity,
      price: intent.price,
      newClientOrderId: clientOrderId,
      ...(target.market === "futures"
        ? { positionSide: intent.reduceOnly
            ? intent.side === "buy" ? "SHORT" : "LONG"
            : intent.side === "buy" ? "LONG" : "SHORT" }
        : {}),
    };
    const identityKey = `${target.market}:${target.mode}:${clientOrderId}`;
    this.#rememberIdentity(identityKey, identity);
    let responseReceived = false;
    try {
      const response = await this.#signedRequest("POST", orderRoute(target), [], body);
      responseReceived = true;
      const parsed = parseAcknowledgedOrder(response.body, clientOrderId);
      if (typeof parsed === "string") {
        this.#rememberIdentity(identityKey, { ...identity, exchangeOrderId: parsed });
        return { status: "acknowledged", exchangeOrderId: parsed };
      }
      this.#identities.delete(identityKey);
      return { status: "rejected", reason: parsed.rejected };
    } catch (error) {
      const failure = error instanceof DispatchedRequestError ? error.failure : error;
      if (responseReceived) return { status: "unknown", reason: "ambiguous-submit-outcome" };
      if (failure instanceof WeexApiError && error instanceof DispatchedRequestError &&
          (failure.category === "authentication" || failure.category === "permission" || failure.category === "validation" || failure.category === "not-found")) {
        return { status: "rejected", reason: failure.message };
      }
      if (!(error instanceof DispatchedRequestError)) throw failure;
      return { status: "unknown", reason: "ambiguous-submit-outcome" };
    }
  }

  async findOrderByClientOrderId(query: ExchangeOrderQuery): Promise<ExchangeOrderSnapshot | null> {
    assertTarget(query?.target);
    if (!isPrivateSymbol(query.symbol) || !(query.target.market === "futures"
          ? isFuturesClientOrderId(query.clientOrderId)
          : isBoundedIdentifier(query.clientOrderId)) ||
        (query.exchangeOrderId !== undefined && !isBoundedIdentifier(query.exchangeOrderId))) {
      throw validation("Invalid order lookup query");
    }
    const key = `${query.target.market}:${query.target.mode}:${query.clientOrderId}`;
    const cached = this.#identities.get(key);
    const expected = {
      ...(cached ?? { clientOrderId: query.clientOrderId, symbol: query.symbol }),
      ...(query.exchangeOrderId === undefined ? {} : { exchangeOrderId: query.exchangeOrderId }),
    };
    if (expected.symbol !== query.symbol) throw schema("Order lookup identity mismatch");
    if (query.target.market === "spot") {
      try {
        const response = await this.#safeGet(orderRoute(query.target), [query.exchangeOrderId
          ? ["orderId", query.exchangeOrderId]
          : ["origClientOrderId", query.clientOrderId]]);
        const data = unwrapGet(response.body);
        return parseOrderSnapshot(data, expected);
      } catch (error) {
        if (error instanceof WeexApiError && error.category === "not-found") return null;
        throw error;
      }
    }
    if (query.exchangeOrderId && query.target.mode === "live") {
      try {
        const response = await this.#safeGet(orderRoute(query.target), [["orderId", query.exchangeOrderId]]);
        return parseOrderSnapshot(unwrapGet(response.body), expected);
      } catch (error) {
        if (error instanceof WeexApiError && error.category === "not-found") return null;
        throw error;
      }
    }
    const matches: unknown[] = [];
    for (const route of futuresSearchRoutes(query.target)) {
      let routeComplete = false;
      for (let page = 1; page <= MAX_ORDER_SEARCH_PAGES; page += 1) {
        const response = await this.#safeGet(route, [
          ["symbol", query.symbol], ["page", String(page)], ["limit", String(ORDER_SEARCH_PAGE_SIZE)],
        ]);
        const orders = parseOrderCollection(response.body);
        for (const raw of orders) {
          if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw schema("Invalid order collection entry");
          const source = raw as Record<string, unknown>;
          if ((source.clientOrderId ?? source.origClientOrderId) === query.clientOrderId) matches.push(raw);
        }
        if (matches.length > 1) throw schema("Duplicate order client id");
        if (orders.length < ORDER_SEARCH_PAGE_SIZE) {
          routeComplete = true;
          break;
        }
      }
      if (!routeComplete) throw schema("Bounded order search page limit reached");
    }
    return matches.length === 0 ? null : parseOrderSnapshot(matches[0], expected);
  }

  async cancelOrder(query: ExchangeOrderQuery): Promise<CancelOutcome> {
    assertTarget(query?.target);
    if (!isPrivateSymbol(query.symbol) || !(query.target.market === "futures"
          ? isFuturesClientOrderId(query.clientOrderId)
          : isBoundedIdentifier(query.clientOrderId)) ||
        (query.exchangeOrderId !== undefined && !isBoundedIdentifier(query.exchangeOrderId))) {
      throw validation("Invalid order cancellation query");
    }
    if (query.target.mode === "futures-demo") {
      return { status: "rejected", reason: "unsupported-demo-cancel" };
    }
    const key = `${query.target.market}:${query.target.mode}:${query.clientOrderId}`;
    const cached = this.#identities.get(key);
    const expected = {
      ...(cached ?? { clientOrderId: query.clientOrderId, symbol: query.symbol }),
      ...(query.exchangeOrderId === undefined ? {} : { exchangeOrderId: query.exchangeOrderId }),
    };
    if (expected.symbol !== query.symbol) throw schema("Order cancellation identity mismatch");
    const entries: QueryEntry[] = query.target.market === "spot" ? [["symbol", query.symbol]] : [];
    if (query.exchangeOrderId) entries.push(["orderId", query.exchangeOrderId]);
    else entries.push(["origClientOrderId", query.clientOrderId]);
    let responseReceived = false;
    try {
      const response = await this.#signedRequest("DELETE", orderRoute(query.target), entries);
      responseReceived = true;
      const parsed = parseCancellation(response.body, expected, query.target.market === "spot");
      return "cancelled" in parsed
        ? { status: "cancelled" }
        : { status: "rejected", reason: parsed.rejected };
    } catch (error) {
      const failure = error instanceof DispatchedRequestError ? error.failure : error;
      if (responseReceived) return { status: "unknown", reason: "ambiguous-cancel-outcome" };
      if (failure instanceof WeexApiError && error instanceof DispatchedRequestError &&
          (failure.category === "authentication" || failure.category === "permission" || failure.category === "validation" || failure.category === "not-found")) {
        return { status: "rejected", reason: failure.message };
      }
      if (!(error instanceof DispatchedRequestError)) throw failure;
      return { status: "unknown", reason: "ambiguous-cancel-outcome" };
    }
  }
}

export function createPrivateClient(options: WeexPrivateClientOptions): WeexPrivateClient {
  return new WeexPrivateClient(options);
}
