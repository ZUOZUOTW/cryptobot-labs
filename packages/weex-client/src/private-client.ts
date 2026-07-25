import type {
  CancelOutcome,
  ExchangeOrderQuery,
  ExchangeOrderSnapshot,
  ExchangeFillSnapshot,
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

export interface WeexAccountBalance {
  readonly asset: string;
  readonly total: string;
  readonly available: string;
  readonly frozen: string;
  readonly unrealizedPnl: string;
}

export interface WeexAccountPosition {
  readonly asset: string;
  readonly symbol: string;
  readonly side: "long" | "short";
  readonly leverage: string;
  readonly size: string;
  readonly openValue: string;
  readonly unrealizedPnl: string;
  readonly openedAt: number | null;
  readonly updatedAt: number;
}

export interface WeexAccountSnapshot {
  readonly target: {
    readonly market: "spot" | "futures";
    readonly mode: "live" | "futures-demo";
  };
  readonly observedAt: number;
  readonly balances: readonly WeexAccountBalance[];
  readonly positions: readonly WeexAccountPosition[];
}

export interface WeexAccountIdentity {
  readonly uid: string;
  readonly observedAt: number;
}

export interface WeexRealizedTrade {
  readonly exchangeTradeId: string;
  readonly symbol: string;
  readonly realizedPnl: string;
  readonly commission: string;
  readonly commissionAsset: string;
  readonly tradedAt: number;
}

export interface WeexFuturesTradeHistoryQuery {
  readonly startTime: number;
  readonly endTime: number;
  readonly limit?: number;
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

interface AuthorizationSnapshot {
  readonly target: ExecutionTarget;
  readonly generation: number;
}

function validation(message: string): WeexApiError {
  return new WeexApiError(message, { category: "validation", retryable: false });
}

function schema(message: string): WeexApiError {
  return new WeexApiError(message, { category: "schema", retryable: false });
}

function assertTarget(target: unknown): asserts target is ExecutionTarget {
  if (!isExecutionTarget(target) || target.mode === "paper") {
    throw validation("Paper execution is local and cannot use the WEEX private API");
  }
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
function futuresPositionsRoute(target: ExecutionTarget): Route {
  return {
    origin: ORIGIN.futures,
    path: target.mode === "live"
      ? "/capi/v3/account/position/allPosition"
      : "/capi/v3/sim/position/allPosition",
  };
}

function orderRoute(target: ExecutionTarget): Route {
  if (target.market === "spot") return { origin: ORIGIN.spot, path: "/api/v3/order" };
  return {
    origin: ORIGIN.futures,
    path: target.mode === "live" ? "/capi/v3/order" : "/capi/v3/sim/order",
  };
}

function tradeRoute(target: ExecutionTarget): Route {
  if (target.market === "spot") return { origin: ORIGIN.spot, path: "/api/v3/myTrades" };
  if (target.mode !== "live") throw validation("Demo trade-fee reconciliation is unsupported");
  return { origin: ORIGIN.futures, path: "/capi/v3/userTrades" };
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

function canonicalSum(left: string, right: string): string {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const sum = BigInt(leftWhole + leftFraction.padEnd(scale, "0")) + BigInt(rightWhole + rightFraction.padEnd(scale, "0"));
  const digits = sum.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -scale)}.${fraction}` : digits.slice(0, -scale);
}

function parseBalanceCollection(value: unknown, market: "spot" | "futures"): readonly WeexAccountBalance[] {
  if (!Array.isArray(value) || value.length > 500) throw schema("Invalid account balance collection");
  return Object.freeze(value.map((item) => {
    const balance = record(item, "account balance");
    const asset = balance.asset ?? balance.coin;
    if (typeof asset !== "string" || !/^[A-Z0-9]{1,16}$/.test(asset)) throw schema("Invalid account balance asset");
    const required = market === "spot"
      ? ["free", "locked"] as const
      : ["balance", "availableBalance", "frozen", "unrealizePnl"] as const;
    for (const key of required) {
      const amount = balance[key];
      const pattern = key === "unrealizePnl" ? SIGNED_AMOUNT : UNSIGNED_AMOUNT;
      if (typeof amount !== "string" || !pattern.test(amount)) {
        throw schema(`Invalid account balance ${key}`);
      }
    }
    const available = (market === "spot" ? balance.free : balance.availableBalance) as string;
    const frozen = (market === "spot" ? balance.locked : balance.frozen) as string;
    return Object.freeze({ asset, total: market === "spot" ? canonicalSum(available, frozen) : balance.balance as string,
      available, frozen, unrealizedPnl: market === "spot" ? "0" : balance.unrealizePnl as string });
  }));
}

function parsePositions(value: unknown): readonly WeexAccountPosition[] {
  const data = unwrapGet(value);
  if (!Array.isArray(data) || data.length > 500) throw schema("Invalid account position collection");
  const positions = data.map((item) => {
    const position = record(item, "account position");
    const rawId = position.id;
    const validId = (typeof rawId === "number" && Number.isFinite(rawId) && Number.isInteger(rawId) && rawId >= 0)
      || (typeof rawId === "string" && /^\d{1,32}$/.test(rawId));
    const side = position.side === "LONG" ? "long" : position.side === "SHORT" ? "short" : null;
    const updatedAt = typeof position.updatedTime === "string" && /^\d+$/.test(position.updatedTime)
      ? Number(position.updatedTime) : position.updatedTime;
    const openedAt = position.createdTime === undefined || position.createdTime === null
      ? null
      : typeof position.createdTime === "string" && /^\d+$/.test(position.createdTime)
        ? Number(position.createdTime)
        : position.createdTime;
    if (!validId || typeof position.asset !== "string" || !/^[A-Z0-9]{1,16}$/.test(position.asset)
      || typeof position.symbol !== "string" || !isPrivateSymbol(position.symbol) || side === null
      || typeof position.leverage !== "string" || !UNSIGNED_AMOUNT.test(position.leverage) || !/[1-9]/.test(position.leverage)
      || typeof position.size !== "string" || !UNSIGNED_AMOUNT.test(position.size)
      || typeof position.openValue !== "string" || !UNSIGNED_AMOUNT.test(position.openValue)
      || typeof position.unrealizePnl !== "string" || !SIGNED_AMOUNT.test(position.unrealizePnl)
      || (openedAt !== null && (!Number.isSafeInteger(openedAt) || (openedAt as number) < 0))
      || !Number.isSafeInteger(updatedAt) || (updatedAt as number) < 0) throw schema("Invalid account position");
    return Object.freeze({ asset: position.asset, symbol: position.symbol, side,
      leverage: position.leverage, size: position.size, openValue: position.openValue,
      unrealizedPnl: position.unrealizePnl, openedAt: openedAt as number | null, updatedAt: updatedAt as number });
  }).filter((position) => /[1-9]/.test(position.size));
  return Object.freeze(positions);
}

function parseTradeFills(body: unknown, target: ExecutionTarget, snapshot: ExchangeOrderSnapshot, feeCurrency: string): {
  readonly fees: string;
  readonly fills: readonly ExchangeFillSnapshot[];
} {
  const data = unwrapGet(body);
  if (!Array.isArray(data) || data.length < 1 || data.length >= 100) throw schema("Invalid or truncated account trade collection");
  let fees = "0"; let quantity = "0";
  const fills = data.map((item) => {
    const trade = record(item, "account trade");
    const rawId = trade.id; const rawOrderId = trade.orderId;
    const exchangeFillId = typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId >= 0 ? String(rawId)
      : typeof rawId === "string" && /^\d{1,32}$/.test(rawId) ? rawId : null;
    const orderId = typeof rawOrderId === "number" && Number.isSafeInteger(rawOrderId) && rawOrderId >= 0 ? String(rawOrderId)
      : typeof rawOrderId === "string" && /^\d{1,32}$/.test(rawOrderId) ? rawOrderId : null;
    const filledAt = typeof trade.time === "string" && /^\d+$/.test(trade.time) ? Number(trade.time) : trade.time;
    const realizedPnl = trade.realizedPnl;
    if (!exchangeFillId || orderId !== snapshot.exchangeOrderId || trade.symbol !== snapshot.symbol
      || typeof trade.price !== "string" || !UNSIGNED_AMOUNT.test(trade.price) || !/[1-9]/.test(trade.price)
      || typeof trade.qty !== "string" || !UNSIGNED_AMOUNT.test(trade.qty) || !/[1-9]/.test(trade.qty)
      || typeof trade.commission !== "string" || !UNSIGNED_AMOUNT.test(trade.commission)
      || trade.commissionAsset !== feeCurrency
      || (target.market === "futures" && (typeof realizedPnl !== "string" || !SIGNED_AMOUNT.test(realizedPnl)))
      || !Number.isSafeInteger(filledAt) || (filledAt as number) < 0) throw schema("Invalid account trade fill");
    fees = canonicalSum(fees, trade.commission); quantity = canonicalSum(quantity, trade.qty);
    return Object.freeze({ exchangeFillId, price: trade.price, quantity: trade.qty, fee: trade.commission,
      feeCurrency: trade.commissionAsset, ...(target.market === "futures" ? { realizedPnl: realizedPnl as string } : {}),
      filledAt: filledAt as number });
  });
  if (new Set(fills.map(({ exchangeFillId }) => exchangeFillId)).size !== fills.length
    || quantity !== canonicalSum("0", snapshot.cumulativeFilledQuantity)) throw schema("Account trade fills do not match the order");
  return Object.freeze({ fees, fills: Object.freeze(fills) });
}

function parseAccountIdentity(body: unknown, observedAt: number): WeexAccountIdentity {
  const account = record(unwrapGet(body), "spot account");
  const rawUid = account.uid;
  const uid = typeof rawUid === "string" && /^\d{1,32}$/.test(rawUid)
    ? rawUid
    : typeof rawUid === "number" && Number.isSafeInteger(rawUid) && rawUid >= 0
      ? String(rawUid)
      : null;
  if (!uid) throw schema("Invalid spot account uid");
  return Object.freeze({ uid, observedAt });
}

function parseRealizedTrades(body: unknown, maximum: number): readonly WeexRealizedTrade[] {
  const data = unwrapGet(body);
  if (!Array.isArray(data) || data.length > maximum) throw schema("Invalid futures trade history collection");
  const trades = data.map((item) => {
    const trade = record(item, "futures trade history item");
    const rawId = trade.id;
    const exchangeTradeId = typeof rawId === "string" && /^\d{1,32}$/.test(rawId)
      ? rawId
      : typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId >= 0
        ? String(rawId)
        : null;
    const tradedAt = typeof trade.time === "string" && /^\d+$/.test(trade.time)
      ? Number(trade.time)
      : trade.time;
    if (!exchangeTradeId || typeof trade.symbol !== "string" || !isPrivateSymbol(trade.symbol)
      || typeof trade.realizedPnl !== "string" || !SIGNED_AMOUNT.test(trade.realizedPnl)
      || typeof trade.commission !== "string" || !UNSIGNED_AMOUNT.test(trade.commission)
      || typeof trade.commissionAsset !== "string" || !/^[A-Z0-9]{1,16}$/.test(trade.commissionAsset)
      || !Number.isSafeInteger(tradedAt) || (tradedAt as number) < 0) {
      throw schema("Invalid futures trade history item");
    }
    return Object.freeze({
      exchangeTradeId,
      symbol: trade.symbol,
      realizedPnl: trade.realizedPnl,
      commission: trade.commission,
      commissionAsset: trade.commissionAsset,
      tradedAt: tradedAt as number,
    });
  });
  if (new Set(trades.map(({ exchangeTradeId }) => exchangeTradeId)).size !== trades.length) {
    throw schema("Duplicate futures trade history item");
  }
  return Object.freeze(trades.sort((left, right) =>
    left.tradedAt - right.tradedAt || left.exchangeTradeId.localeCompare(right.exchangeTradeId)));
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
    const balanceAssetCount = parseBalanceCollection(account.balances, "spot").length;
    return {
      market: "spot", mode: "live", verifiedAt, canTrade: account.canTrade,
      readPermission: true,
      // WEEX documents API-key scopes as Readonly / Spot / Futures. The
      // account-level canWithdraw flag describes the user's WEEX account, not
      // a withdrawal capability granted to this API key.
      withdrawalPermission: "absent",
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
  const balanceAssetCount = parseBalanceCollection(collection, "futures").length;
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
    // accountConfig.canWithdraw is an account setting (the official example
    // is true), not an API-key permission. This client exposes no withdrawal
    // endpoint, so the credential's withdrawal capability is absent.
    withdrawalPermission: "absent",
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
  readonly #submissionClaims = new Map<string, {
    readonly identity: ExpectedOrderIdentity;
    promise?: Promise<SubmitOutcome>;
    outcome?: SubmitOutcome;
  }>();
  #spotVerificationGeneration = 0;
  #futuresVerificationGeneration = 0;
  #verifiedSpotLive: { readonly verifiedAt: number; readonly generation: number } | undefined;
  #verifiedFuturesLive: {
    readonly canTrade: boolean;
    readonly dualSidePosition: boolean;
    readonly verifiedAt: number;
    readonly generation: number;
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
    preDispatch?: () => void,
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
      preDispatch?.();
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

  #authorizationSnapshot(target: ExecutionTarget): AuthorizationSnapshot | undefined {
    const now = this.#now();
    if (!Number.isSafeInteger(now)) throw validation("Invalid authorization time");
    if (target.market === "spot") {
      const verified = this.#verifiedSpotLive;
      if (!verified || now < verified.verifiedAt || now - verified.verifiedAt > MAX_RULES_AGE_MS) {
        throw validation("Fresh verified spot trading permission is required");
      }
      return { target, generation: verified.generation };
    }
    if (target.mode === "live") {
      const verified = this.#verifiedFuturesLive;
      if (!verified || !verified.canTrade || !verified.dualSidePosition ||
          now < verified.verifiedAt || now - verified.verifiedAt > MAX_RULES_AGE_MS) {
        throw validation("Verified futures hedge-mode trading permission is required");
      }
      return { target, generation: verified.generation };
    }
    return undefined;
  }

  #assertAuthorization(snapshot: AuthorizationSnapshot | undefined): void {
    if (!snapshot) return;
    const current = this.#authorizationSnapshot(snapshot.target);
    if (!current || current.generation !== snapshot.generation ||
        (snapshot.target.market === "spot"
          ? this.#spotVerificationGeneration !== snapshot.generation
          : this.#futuresVerificationGeneration !== snapshot.generation)) {
      throw validation("Account verification changed during order preflight");
    }
  }

  async #validateOrder(request: ExchangeSubmitRequest): Promise<{
    readonly identity: ExpectedOrderIdentity;
    readonly authorization: AuthorizationSnapshot | undefined;
  }> {
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
    const authorization = this.#authorizationSnapshot(request.target);
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
    this.#assertAuthorization(authorization);
    return {
      authorization,
      identity: {
        clientOrderId: request.clientOrderId,
        symbol: intent.symbol,
        side: intent.side,
        quantity: intent.quantity,
        price: intent.price,
        reduceOnly: intent.reduceOnly,
      },
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

  #sameIdentity(left: ExpectedOrderIdentity, right: ExpectedOrderIdentity): boolean {
    return left.clientOrderId === right.clientOrderId && left.symbol === right.symbol &&
      left.side === right.side && left.quantity === right.quantity && left.price === right.price &&
      left.reduceOnly === right.reduceOnly;
  }

  #claimSubmission(key: string, identity: ExpectedOrderIdentity):
    | { readonly existing: Promise<SubmitOutcome> | SubmitOutcome }
    | { readonly claim: { identity: ExpectedOrderIdentity; promise?: Promise<SubmitOutcome>; outcome?: SubmitOutcome } } {
    const existing = this.#submissionClaims.get(key);
    if (existing) {
      if (!this.#sameIdentity(existing.identity, identity)) throw validation("Client order id identity collision");
      const result = existing.promise ?? existing.outcome;
      if (result) return { existing: result };
      throw validation("Client order id is already claimed");
    }
    if (this.#submissionClaims.size >= MAX_IDENTITY_CACHE) {
      throw validation("Submission identity registry is full");
    }
    const claim = { identity };
    this.#submissionClaims.set(key, claim);
    return { claim };
  }

  async verifyAccount(target: ExecutionTarget): Promise<VerifiedAccountSummary> {
    assertTarget(target);
    let verificationGeneration: number | undefined;
    if (target.market === "spot") {
      this.#spotVerificationGeneration += 1;
      verificationGeneration = this.#spotVerificationGeneration;
      this.#verifiedSpotLive = undefined;
    }
    if (target.market === "futures" && target.mode === "live") {
      this.#futuresVerificationGeneration += 1;
      verificationGeneration = this.#futuresVerificationGeneration;
      this.#verifiedFuturesLive = undefined;
    }
    const response = await this.#safeGet(accountRoute(target));
    const configResponse = target.market === "futures" && target.mode === "live"
      ? await this.#safeGet(FUTURES_ACCOUNT_CONFIG)
      : undefined;
    const summary = parseAccount(response.body, target, Math.floor(this.#now()), configResponse?.body);
    if (target.market === "spot" && verificationGeneration === this.#spotVerificationGeneration &&
        summary.canTrade === true && summary.withdrawalPermission === "absent") {
      this.#verifiedSpotLive = {
        verifiedAt: summary.verifiedAt,
        generation: verificationGeneration,
      };
    }
    if (target.market === "futures" && target.mode === "live" &&
        verificationGeneration === this.#futuresVerificationGeneration) {
      this.#verifiedFuturesLive = {
        canTrade: summary.canTrade === true,
        dualSidePosition: summary.positionMode === "hedge",
        verifiedAt: summary.verifiedAt,
        generation: verificationGeneration,
      };
    }
    return summary;
  }

  async getAccountSnapshot(target: ExecutionTarget): Promise<WeexAccountSnapshot> {
    assertTarget(target);
    if (target.mode !== "live" && !(target.market === "futures" && target.mode === "futures-demo")) {
      throw validation("Account snapshots require a supported WEEX private target");
    }
    const authorization = this.#authorizationSnapshot(target);
    const accountResponse = await this.#safeGet(accountRoute(target));
    let balances: readonly WeexAccountBalance[];
    if (target.market === "spot") {
      const account = record(unwrapGet(accountResponse.body), "spot account");
      if (account.canTrade !== true || typeof account.canWithdraw !== "boolean") {
        this.#verifiedSpotLive = undefined;
        throw validation("Spot account permissions changed after verification");
      }
      balances = parseBalanceCollection(account.balances, "spot");
    } else {
      const data = unwrapGet(accountResponse.body);
      const collection = Array.isArray(data) ? data : (() => {
        const source = record(data, "futures account balance response");
        return source.balances ?? source.assets ?? source.list;
      })();
      balances = parseBalanceCollection(collection, "futures");
    }
    const positions = target.market === "futures"
      ? parsePositions((await this.#safeGet(futuresPositionsRoute(target))).body)
      : Object.freeze([]) as readonly WeexAccountPosition[];
    this.#assertAuthorization(authorization);
    const observedAt = Math.floor(this.#now());
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw validation("Invalid account snapshot time");
    return Object.freeze({ target: Object.freeze({ market: target.market, mode: target.mode }), observedAt,
      balances, positions });
  }

  /**
   * Read-only account monitoring is intentionally independent from the stricter
   * trading authorization cache. Order submission still requires verifyAccount().
   */
  async getReadOnlyAccountSnapshot(target: ExecutionTarget): Promise<WeexAccountSnapshot> {
    assertTarget(target);
    if (target.mode !== "live" && !(target.market === "futures" && target.mode === "futures-demo")) {
      throw validation("Account snapshots require a supported WEEX private target");
    }
    const accountResponse = await this.#safeGet(accountRoute(target));
    let balances: readonly WeexAccountBalance[];
    if (target.market === "spot") {
      const account = record(unwrapGet(accountResponse.body), "spot account");
      balances = parseBalanceCollection(account.balances, "spot");
    } else {
      const data = unwrapGet(accountResponse.body);
      const collection = Array.isArray(data) ? data : (() => {
        const source = record(data, "futures account balance response");
        return source.balances ?? source.assets ?? source.list;
      })();
      balances = parseBalanceCollection(collection, "futures");
    }
    const positions = target.market === "futures"
      ? parsePositions((await this.#safeGet(futuresPositionsRoute(target))).body)
      : Object.freeze([]) as readonly WeexAccountPosition[];
    const observedAt = Math.floor(this.#now());
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw validation("Invalid account snapshot time");
    return Object.freeze({
      target: Object.freeze({ market: target.market, mode: target.mode }),
      observedAt,
      balances,
      positions,
    });
  }

  async getAccountIdentity(): Promise<WeexAccountIdentity> {
    const response = await this.#safeGet(accountRoute({ market: "spot", mode: "live" }));
    const observedAt = Math.floor(this.#now());
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw validation("Invalid account identity time");
    return parseAccountIdentity(response.body, observedAt);
  }

  async getFuturesTradeHistory(query: WeexFuturesTradeHistoryQuery): Promise<readonly WeexRealizedTrade[]> {
    const limit = query?.limit ?? 100;
    if (!Number.isSafeInteger(query?.startTime) || !Number.isSafeInteger(query?.endTime)
      || query.startTime < 0 || query.endTime < query.startTime
      || query.endTime - query.startTime > 7 * 24 * 60 * 60_000
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw validation("Invalid futures trade history window");
    }
    const response = await this.#safeGet(tradeRoute({ market: "futures", mode: "live" }), [
      ["startTime", String(query.startTime)],
      ["endTime", String(query.endTime)],
      ["limit", String(limit)],
    ]);
    return parseRealizedTrades(response.body, limit);
  }

  async submitOrder(request: ExchangeSubmitRequest): Promise<SubmitOutcome> {
    const { identity, authorization } = await this.#validateOrder(request);
    const { intent, target, clientOrderId } = request;
    const commonBody = {
      symbol: intent.symbol,
      side: intent.side.toUpperCase(),
      quantity: intent.quantity,
      newClientOrderId: clientOrderId,
      ...(target.market === "futures"
        ? { positionSide: intent.reduceOnly
            ? intent.side === "buy" ? "SHORT" : "LONG"
            : intent.side === "buy" ? "LONG" : "SHORT" }
        : {}),
    };
    const body = target.mode === "futures-demo"
      ? { ...commonBody, type: "MARKET" }
      : { ...commonBody, type: "LIMIT", timeInForce: "GTC", price: intent.price };
    const identityKey = `${target.market}:${target.mode}:${clientOrderId}`;
    const claimed = this.#claimSubmission(identityKey, identity);
    if ("existing" in claimed) return await claimed.existing;
    const submission = this.#performSubmit(target, clientOrderId, body, identityKey, identity, authorization);
    claimed.claim.promise = submission;
    try {
      const outcome = await submission;
      claimed.claim.promise = undefined;
      claimed.claim.outcome = outcome;
      return outcome;
    } catch (error) {
      this.#submissionClaims.delete(identityKey);
      this.#identities.delete(identityKey);
      throw error;
    }
  }

  async #performSubmit(
    target: ExecutionTarget,
    clientOrderId: string,
    body: Readonly<Record<string, unknown>>,
    identityKey: string,
    identity: ExpectedOrderIdentity,
    authorization: AuthorizationSnapshot | undefined,
  ): Promise<SubmitOutcome> {
    this.#rememberIdentity(identityKey, identity);
    let responseReceived = false;
    try {
      const response = await this.#signedRequest(
        "POST",
        orderRoute(target),
        [],
        body,
        () => this.#assertAuthorization(authorization),
      );
      responseReceived = true;
      const parsed = parseAcknowledgedOrder(response.body, clientOrderId);
      if (typeof parsed === "string") {
        this.#rememberIdentity(identityKey, { ...identity, exchangeOrderId: parsed });
        return { status: "acknowledged", exchangeOrderId: parsed };
      }
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

  #acceptAuthoritativeSnapshot(
    key: string,
    snapshot: ExchangeOrderSnapshot,
  ): ExchangeOrderSnapshot {
    if (snapshot.status === "FILLED" || snapshot.status === "CANCELED" || snapshot.status === "REJECTED") {
      this.#submissionClaims.delete(key);
      this.#identities.delete(key);
    }
    return snapshot;
  }

  async #attachTradeFees(target: ExecutionTarget, snapshot: ExchangeOrderSnapshot): Promise<ExchangeOrderSnapshot> {
    if (snapshot.cumulativeFilledQuantity === "0") return snapshot;
    if (target.mode === "futures-demo") return Object.freeze({ ...snapshot, fees: "0" });
    let feeCurrency = "USDT";
    if (target.market === "spot") {
      if (!this.#rulesProvider) throw validation("Current instrument rules are required for spot fill reconciliation");
      const rules = await this.#rulesProvider(target, snapshot.symbol);
      const now = this.#now();
      if (!isValidInstrumentRules(rules?.rules) || rules.rules.market !== "spot" || rules.rules.symbol !== snapshot.symbol
        || !Number.isSafeInteger(rules.verifiedAt) || rules.verifiedAt > now || now - rules.verifiedAt > MAX_RULES_AGE_MS) {
        throw validation("Current spot instrument rules are unavailable for fill reconciliation");
      }
      feeCurrency = rules.rules.quoteAsset;
    }
    const response = await this.#safeGet(tradeRoute(target), [
      ["symbol", snapshot.symbol], ["orderId", snapshot.exchangeOrderId], ["limit", "100"],
    ]);
    const evidence = parseTradeFills(response.body, target, snapshot, feeCurrency);
    return Object.freeze({ ...snapshot, ...evidence });
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
        return this.#acceptAuthoritativeSnapshot(key, await this.#attachTradeFees(query.target, parseOrderSnapshot(data, expected)));
      } catch (error) {
        if (error instanceof WeexApiError && error.category === "not-found") return null;
        throw error;
      }
    }
    if (query.exchangeOrderId && query.target.mode === "live") {
      try {
        const response = await this.#safeGet(orderRoute(query.target), [["orderId", query.exchangeOrderId]]);
        return this.#acceptAuthoritativeSnapshot(key,
          await this.#attachTradeFees(query.target, parseOrderSnapshot(unwrapGet(response.body), expected)));
      } catch (error) {
        if (error instanceof WeexApiError && error.category === "not-found") return null;
        throw error;
      }
    }
    const matches: unknown[] = [];
    for (const route of futuresSearchRoutes(query.target)) {
      let routeComplete = false;
      for (let page = 0; page < MAX_ORDER_SEARCH_PAGES; page += 1) {
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
    return matches.length === 0
      ? null
      : this.#acceptAuthoritativeSnapshot(key,
        await this.#attachTradeFees(query.target, parseOrderSnapshot(matches[0], expected)));
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
      const parsed = parseCancellation(
        response.body,
        expected,
        query.target.market === "spot",
        query.exchangeOrderId
          ? { kind: "orderId", value: query.exchangeOrderId }
          : { kind: "origClientOrderId", value: query.clientOrderId },
      );
      if ("cancelled" in parsed) {
        this.#submissionClaims.delete(key);
        this.#identities.delete(key);
        return { status: "cancelled" };
      }
      return { status: "rejected", reason: parsed.rejected };
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
