import type {
  ExchangeOrderQuery,
  ExchangeOrderSnapshot,
  ExecutionTarget,
} from "@cryptobot-labs/trading-core";
import { isExecutionTarget } from "@cryptobot-labs/trading-core";

import { WeexApiError } from "./errors";
import { isBoundedIdentifier, isCanonicalNonnegativeDecimal, isCanonicalPositiveDecimal, isPrivateSymbol } from "./orders";
import { WeexCredentials } from "./private-client";
import { signWeexRequest } from "./signing";

const PRIVATE_PATH = "/v3/ws/private";
const DEFAULT_USER_AGENT = "CryptoBot-Labs-Agent/0.1";
const DEFAULT_MAX_QUEUE_SIZE = 256;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_PUSH_ENTRIES = 100;
const MAX_LISTENERS = 1024;
const MAX_TRACKED_FILLS = 4096;
const NON_RETRYABLE_CLOSE_CODES = new Set([1002, 1003, 1007, 1008, 4001, 4003]);

export interface PrivateSocketEventMap {
  readonly open: Record<string, never>;
  readonly message: { readonly data: string };
  readonly close: { readonly code: number; readonly reason: string; readonly wasClean: boolean };
  readonly error: Record<string, never>;
}

export interface PrivateSocket {
  readonly readyState: number;
  addEventListener<K extends keyof PrivateSocketEventMap>(
    type: K,
    listener: (event: PrivateSocketEventMap[K]) => void,
  ): void;
  removeEventListener<K extends keyof PrivateSocketEventMap>(
    type: K,
    listener: (event: PrivateSocketEventMap[K]) => void,
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface PrivateSocketFactoryInput {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type PrivateSocketFactory = (input: PrivateSocketFactoryInput) => PrivateSocket;

export interface PrivateOrderLookup {
  findByClientOrderId(query: ExchangeOrderQuery): Promise<ExchangeOrderSnapshot | null>;
}

export interface PrivateStreamClock {
  now(): number;
  assertPrivateRequestWindow(requestTimestampMs: number): void;
}

export interface PrivateOrderEvent {
  readonly target: ExecutionTarget;
  readonly accountVersion: number;
  readonly eventTime: number;
  readonly snapshot: ExchangeOrderSnapshot;
}

export type PrivateOrderListener = (event: PrivateOrderEvent) => void;
export type PrivateStreamState = "idle" | "connecting" | "subscribing" | "open" | "reconnecting" | "error" | "closed";

export interface WeexPrivateStreamOptions {
  readonly target: ExecutionTarget;
  readonly credentials: WeexCredentials;
  readonly factory: PrivateSocketFactory;
  readonly lookup: PrivateOrderLookup;
  readonly clock: PrivateStreamClock;
  readonly scheduler?: (delayMs: number) => Promise<void>;
  readonly maximumQueueSize?: number;
  readonly maximumReconnectAttempts?: number;
  readonly acknowledgementTimeoutMs?: number;
  readonly acknowledgementScheduler?: (delayMs: number) => Promise<void>;
  readonly userAgent?: string;
}

interface OrderHint {
  readonly exchangeOrderId: string;
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly quantity: string;
}

interface OrderPush {
  readonly accountVersion: number;
  readonly eventTime: number;
  readonly hints: readonly OrderHint[];
}

interface TrackedFill {
  readonly quantity: string;
  readonly terminal: boolean;
}

interface SocketListeners {
  readonly open: (event: PrivateSocketEventMap["open"]) => void;
  readonly message: (event: PrivateSocketEventMap["message"]) => void;
  readonly close: (event: PrivateSocketEventMap["close"]) => void;
  readonly error: (event: PrivateSocketEventMap["error"]) => void;
}

function validation(message: string): WeexApiError {
  return new WeexApiError(message, { category: "validation", retryable: false });
}

function schema(message: string): WeexApiError {
  return new WeexApiError(message, { category: "schema", retryable: false });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw schema(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function safeTimestamp(value: unknown, label: string): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d{1,16}$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw schema(`Invalid ${label}`);
  return parsed;
}

function compareDecimals(left: string, right: string): number {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(leftInteger + leftFraction.padEnd(scale, "0"));
  const rightValue = BigInt(rightInteger + rightFraction.padEnd(scale, "0"));
  return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
}

function hasExactKeys(source: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(source).sort();
  return keys.length === expected.length && expected.slice().sort().every((key, index) => keys[index] === key);
}

function validateSnapshot(value: unknown, hint: OrderHint): Readonly<ExchangeOrderSnapshot> {
  const source = record(value, "authoritative REST order snapshot");
  if (source.clientOrderId !== hint.clientOrderId || source.exchangeOrderId !== hint.exchangeOrderId ||
      source.symbol !== hint.symbol || source.side !== hint.side ||
      typeof source.quantity !== "string" || !isCanonicalPositiveDecimal(source.quantity) ||
      (hint.quantity !== "0" && source.quantity !== hint.quantity) ||
      typeof source.cumulativeFilledQuantity !== "string" ||
      !isCanonicalNonnegativeDecimal(source.cumulativeFilledQuantity)) {
    throw schema("REST order identity mismatch");
  }
  const statuses = new Set(["NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED"]);
  if (typeof source.status !== "string" || !statuses.has(source.status)) throw schema("Invalid REST order status");
  if (source.averageFillPrice !== undefined && !isCanonicalPositiveDecimal(source.averageFillPrice)) {
    throw schema("Invalid REST average fill price");
  }
  if (source.fees !== undefined && !isCanonicalNonnegativeDecimal(source.fees)) throw schema("Invalid REST fees");
  const fillComparison = compareDecimals(source.cumulativeFilledQuantity, source.quantity);
  if (fillComparison > 0 ||
      (source.status === "NEW" && source.cumulativeFilledQuantity !== "0") ||
      (source.status === "PARTIALLY_FILLED" &&
        (source.cumulativeFilledQuantity === "0" || fillComparison >= 0)) ||
      (source.status === "FILLED" && fillComparison !== 0) ||
      (source.status === "REJECTED" && source.cumulativeFilledQuantity !== "0")) {
    throw schema("Inconsistent REST order fill state");
  }
  return Object.freeze({
    clientOrderId: source.clientOrderId,
    exchangeOrderId: source.exchangeOrderId,
    symbol: source.symbol,
    side: source.side,
    quantity: source.quantity,
    status: source.status,
    cumulativeFilledQuantity: source.cumulativeFilledQuantity,
    ...(source.averageFillPrice === undefined ? {} : { averageFillPrice: source.averageFillPrice }),
    ...(source.fees === undefined ? {} : { fees: source.fees }),
  } as ExchangeOrderSnapshot);
}

function socketUrl(target: ExecutionTarget): string {
  if (target.market === "spot") return `wss://ws-spot.weex.com${PRIVATE_PATH}`;
  if (target.mode === "live") return `wss://ws-contract.weex.com${PRIVATE_PATH}`;
  throw validation("WEEX futures demo has no documented private stream");
}

function parseHint(value: unknown): OrderHint {
  const source = record(value, "private order hint");
  const exchangeOrderId = source.id;
  const clientOrderId = source.clientOrderId;
  const symbol = source.symbol;
  const side = source.orderSide;
  const quantity = source.size;
  if (!isBoundedIdentifier(exchangeOrderId) || !isBoundedIdentifier(clientOrderId) ||
      !isPrivateSymbol(symbol) || (side !== "BUY" && side !== "SELL") ||
      !isCanonicalNonnegativeDecimal(quantity)) {
    throw schema("Invalid private order identity");
  }
  if (typeof source.status !== "string" || source.status.length < 1 || source.status.length > 32 ||
      !isCanonicalNonnegativeDecimal(source.cumFillSize) ||
      !isCanonicalNonnegativeDecimal(source.cumFillFee) ||
      !isCanonicalNonnegativeDecimal(source.latestFillPrice)) {
    throw schema("Invalid private order state");
  }
  safeTimestamp(source.updatedTime, "private order update time");
  return {
    exchangeOrderId,
    clientOrderId,
    symbol,
    side: side === "BUY" ? "buy" : "sell",
    quantity,
  };
}

function parsePush(value: unknown): OrderPush | null {
  const source = record(value, "private websocket message");
  if (source.e !== "orders") return null;
  if (source.msgEvent !== "OrderUpdate") throw schema("Invalid private order event name");
  const accountVersion = source.v;
  if (!Number.isSafeInteger(accountVersion) || (accountVersion as number) < 0) {
    throw schema("Invalid private account version");
  }
  const entries = source.d;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_PUSH_ENTRIES) {
    throw schema("Invalid private order collection");
  }
  return {
    accountVersion: accountVersion as number,
    eventTime: safeTimestamp(source.E, "private event time"),
    hints: entries.map(parseHint),
  };
}

export class WeexPrivateStream {
  readonly #target: ExecutionTarget;
  readonly #credentials: WeexCredentials;
  readonly #factory: PrivateSocketFactory;
  readonly #lookup: PrivateOrderLookup;
  readonly #clock: PrivateStreamClock;
  readonly #scheduler: (delayMs: number) => Promise<void>;
  readonly #maximumQueueSize: number;
  readonly #maximumReconnectAttempts: number;
  readonly #acknowledgementTimeoutMs: number;
  readonly #acknowledgementScheduler: (delayMs: number) => Promise<void>;
  readonly #userAgent: string;
  readonly #listeners = new Set<PrivateOrderListener>();
  readonly #lastFills = new Map<string, TrackedFill>();

  #state: PrivateStreamState = "idle";
  #socket: PrivateSocket | null = null;
  #socketListeners: SocketListeners | null = null;
  #connectPromise: Promise<void> | null = null;
  #explicitlyClosed = false;
  #subscribed = false;
  #lastAccountVersion = -1;
  #pendingJobs = 0;
  #workTail: Promise<void> = Promise.resolve();
  #reconnectAttempts = 0;

  constructor(options: WeexPrivateStreamOptions) {
    if (!options || !isExecutionTarget(options.target) || !(options.credentials instanceof WeexCredentials) ||
        typeof options.factory !== "function" || typeof options.lookup?.findByClientOrderId !== "function" ||
        typeof options.clock?.now !== "function" || typeof options.clock?.assertPrivateRequestWindow !== "function") {
      throw validation("Invalid WEEX private stream options");
    }
    const maximumQueueSize = options.maximumQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    const maximumReconnectAttempts = options.maximumReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    const acknowledgementTimeoutMs = options.acknowledgementTimeoutMs ?? DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS;
    if (!Number.isSafeInteger(maximumQueueSize) || maximumQueueSize < 1 || maximumQueueSize > 4096 ||
        !Number.isSafeInteger(maximumReconnectAttempts) || maximumReconnectAttempts < 0 || maximumReconnectAttempts > 10 ||
        !Number.isSafeInteger(acknowledgementTimeoutMs) || acknowledgementTimeoutMs < 100 || acknowledgementTimeoutMs > 30_000) {
      throw validation("Invalid WEEX private stream limits");
    }
    const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    if (typeof userAgent !== "string" || userAgent.length < 1 || userAgent.length > 128 || /[\r\n]/u.test(userAgent)) {
      throw validation("Invalid WEEX websocket user agent");
    }
    this.#target = Object.freeze({ ...options.target });
    this.#credentials = options.credentials;
    this.#factory = options.factory;
    this.#lookup = options.lookup;
    this.#clock = options.clock;
    this.#scheduler = options.scheduler ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
    this.#maximumQueueSize = maximumQueueSize;
    this.#maximumReconnectAttempts = maximumReconnectAttempts;
    this.#acknowledgementTimeoutMs = acknowledgementTimeoutMs;
    this.#acknowledgementScheduler = options.acknowledgementScheduler ?? ((delay) => new Promise((resolve) => {
      const timer = setTimeout(resolve, delay);
      (timer as unknown as { unref?: () => void }).unref?.();
    }));
    this.#userAgent = userAgent;
  }

  get state(): PrivateStreamState {
    return this.#state;
  }

  subscribeOrders(listener: PrivateOrderListener): () => void {
    if (typeof listener !== "function") throw validation("Invalid private order listener");
    if (!this.#listeners.has(listener) && this.#listeners.size >= MAX_LISTENERS) {
      throw validation("Private order listener limit exceeded");
    }
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  connect(): Promise<void> {
    if (this.#connectPromise !== null) return this.#connectPromise;
    if (this.#state === "closed") return Promise.reject(validation("Private stream is closed"));
    this.#explicitlyClosed = false;
    this.#state = "connecting";
    const promise = this.#openSocket();
    this.#connectPromise = promise;
    promise.catch(() => {
      if (this.#connectPromise === promise) this.#connectPromise = null;
      if (!this.#explicitlyClosed) this.#state = "error";
    });
    return promise;
  }

  close(): void {
    this.#explicitlyClosed = true;
    this.#state = "closed";
    this.#listeners.clear();
    this.#detachSocket(true);
    this.#connectPromise = null;
  }

  async #openSocket(): Promise<void> {
    const url = socketUrl(this.#target);
    const rawTimestamp = this.#clock.now();
    if (!Number.isFinite(rawTimestamp) || rawTimestamp < 0) throw validation("Invalid websocket timestamp");
    const requestTimestamp = Math.floor(rawTimestamp);
    this.#clock.assertPrivateRequestWindow(requestTimestamp);
    const timestamp = String(requestTimestamp);
    const headers = await this.#credentials.use(async ({ apiKey, secretKey, passphrase }) => ({
      "User-Agent": this.#userAgent,
      "ACCESS-KEY": apiKey,
      "ACCESS-PASSPHRASE": passphrase,
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-SIGN": await signWeexRequest(`${timestamp}${PRIVATE_PATH}`, secretKey),
    }));
    if (this.#explicitlyClosed) throw validation("Private stream is closed");

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settleResolve = (): void => {
        if (!settled) { settled = true; resolve(); }
      };
      const settleReject = (failure: unknown): void => {
        if (!settled) { settled = true; reject(failure); }
      };
      let socket: PrivateSocket;
      try {
        socket = this.#factory({ url, headers });
      } catch (cause) {
        settleReject(new WeexApiError("WEEX websocket factory failed", { category: "network", retryable: true, cause }));
        return;
      }
      if (!socket || typeof socket.addEventListener !== "function" || typeof socket.send !== "function" ||
          typeof socket.removeEventListener !== "function" || typeof socket.close !== "function") {
        settleReject(validation("Invalid private websocket"));
        return;
      }
      this.#socket = socket;
      this.#subscribed = false;
      let opened = false;
      const listeners: SocketListeners = {
        open: () => {
          if (opened || this.#explicitlyClosed || this.#socket !== socket) return;
          opened = true;
          this.#state = "subscribing";
          try {
            socket.send(JSON.stringify({ method: "SUBSCRIBE", params: ["orders"], id: 1 }));
            void this.#acknowledgementScheduler(this.#acknowledgementTimeoutMs).then(() => {
              if (this.#socket === socket && !this.#subscribed && !this.#explicitlyClosed) {
                settleReject(new WeexApiError("WEEX websocket subscription acknowledgement timed out", {
                  category: "network", retryable: true,
                }));
                this.#fatal("subscription-timeout");
              }
            });
          } catch (cause) {
            settleReject(new WeexApiError("WEEX websocket subscribe failed", { category: "network", retryable: true, cause }));
            this.#fatal("subscribe-failed");
          }
        },
        message: (event) => {
          if (this.#onMessage(event.data)) settleResolve();
          else if (this.#state === "error") settleReject(schema("Invalid websocket subscription acknowledgement"));
        },
        close: (event) => {
          if (!this.#subscribed) settleReject(new WeexApiError("WEEX websocket closed before subscription", {
            category: "network", retryable: true,
          }));
          this.#onClose(socket, event);
        },
        error: () => {
          if (!opened) {
            settleReject(new WeexApiError("WEEX websocket connection failed", {
              category: "network", retryable: true,
            }));
            this.#fatal("connection-error");
          } else {
            this.#onClose(socket, { code: 1006, reason: "socket-error", wasClean: false });
          }
        },
      };
      this.#socketListeners = listeners;
      for (const type of Object.keys(listeners) as (keyof PrivateSocketEventMap)[]) {
        socket.addEventListener(type, listeners[type] as never);
      }
    });
  }

  #onMessage(data: string): boolean {
    if ((this.#state !== "open" && this.#state !== "subscribing") ||
        typeof data !== "string" || data.length < 2 || data.length > MAX_MESSAGE_BYTES) {
      if (this.#state === "open" || this.#state === "subscribing") this.#fatal("invalid-message");
      return false;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
      const source = record(parsed, "private websocket message");
      if (source.type === "ping") {
        if (!hasExactKeys(source, ["time", "type"])) throw schema("Invalid private ping schema");
        const pingTime = safeTimestamp(source.time, "private ping time");
        this.#clock.assertPrivateRequestWindow(pingTime);
        this.#socket?.send('{"method":"PONG","id":1}');
        return false;
      }
      if (source.id === 1 && Object.hasOwn(source, "result")) {
        if (!hasExactKeys(source, ["id", "result"]) || this.#subscribed || source.result !== true) {
          this.#fatal("invalid-subscription-ack");
          return false;
        }
        this.#subscribed = true;
        this.#state = "open";
        this.#reconnectAttempts = 0;
        return true;
      }
      const push = parsePush(source);
      if (push === null || !this.#subscribed || push.accountVersion <= this.#lastAccountVersion) return false;
      this.#lastAccountVersion = push.accountVersion;
      this.#enqueue(push);
      return false;
    } catch {
      this.#fatal("invalid-message");
      return false;
    }
  }

  #enqueue(push: OrderPush): void {
    if (this.#pendingJobs >= this.#maximumQueueSize) {
      this.#fatal("queue-overflow");
      return;
    }
    this.#pendingJobs += 1;
    this.#workTail = this.#workTail
      .then(() => this.#processPush(push))
      .catch(() => { this.#fatal("reconciliation-failed"); })
      .finally(() => { this.#pendingJobs -= 1; });
  }

  async #processPush(push: OrderPush): Promise<void> {
    if (this.#state !== "open") return;
    for (const hint of push.hints) {
      const rawSnapshot = await this.#lookup.findByClientOrderId({
        target: this.#target,
        symbol: hint.symbol,
        clientOrderId: hint.clientOrderId,
        exchangeOrderId: hint.exchangeOrderId,
      });
      if (this.#state !== "open" || rawSnapshot === null) continue;
      const snapshot = validateSnapshot(rawSnapshot, hint);
      const key = `${this.#target.market}:${this.#target.mode}:${snapshot.clientOrderId}`;
      const previousFill = this.#lastFills.get(key);
      if (previousFill !== undefined && compareDecimals(snapshot.cumulativeFilledQuantity, previousFill.quantity) < 0) continue;
      if (previousFill === undefined && this.#lastFills.size >= MAX_TRACKED_FILLS) {
        const terminalKey = this.#lastFills.entries().find(([, tracked]) => tracked.terminal)?.[0];
        if (terminalKey === undefined) throw schema("Private fill tracker capacity exceeded");
        this.#lastFills.delete(terminalKey);
      }
      const terminal = snapshot.status === "FILLED" || snapshot.status === "CANCELED" || snapshot.status === "REJECTED";
      this.#lastFills.delete(key);
      this.#lastFills.set(key, { quantity: snapshot.cumulativeFilledQuantity, terminal });
      const event: PrivateOrderEvent = Object.freeze({
        target: this.#target,
        accountVersion: push.accountVersion,
        eventTime: push.eventTime,
        snapshot,
      });
      for (const listener of this.#listeners) {
        try { listener(event); } catch { /* isolate consumer failures from the trading stream */ }
      }
    }
  }

  #onClose(socket: PrivateSocket, event: PrivateSocketEventMap["close"]): void {
    if (this.#socket !== socket) return;
    this.#detachSocket(false);
    if (this.#explicitlyClosed || this.#state === "error" || this.#state === "closed") return;
    if (NON_RETRYABLE_CLOSE_CODES.has(event.code)) {
      this.#state = "error";
      return;
    }
    if (this.#reconnectAttempts >= this.#maximumReconnectAttempts) {
      this.#state = "error";
      return;
    }
    const attempt = this.#reconnectAttempts;
    this.#reconnectAttempts += 1;
    this.#state = "reconnecting";
    void this.#scheduler(250 * 2 ** attempt)
      .then(async () => {
        if (this.#explicitlyClosed || this.#state !== "reconnecting") return;
        const generation = this.#reconnectAttempts;
        try {
          await this.#openSocket();
        } catch {
          if (!this.#explicitlyClosed && this.#state === "reconnecting" &&
              this.#reconnectAttempts === generation) this.#state = "error";
        }
      })
      .catch(() => { if (!this.#explicitlyClosed) this.#state = "error"; });
  }

  #fatal(reason: string): void {
    if (this.#state === "closed" || this.#state === "error") return;
    this.#state = "error";
    this.#detachSocket(false, 1008, reason);
  }

  #detachSocket(close: boolean, code?: number, reason?: string): void {
    const socket = this.#socket;
    const listeners = this.#socketListeners;
    this.#socket = null;
    this.#socketListeners = null;
    this.#subscribed = false;
    if (socket && listeners) {
      for (const type of Object.keys(listeners) as (keyof PrivateSocketEventMap)[]) {
        try { socket.removeEventListener(type, listeners[type] as never); } catch { /* continue cleanup */ }
      }
    }
    if (socket && (close || code !== undefined)) {
      try { socket.close(code, reason); } catch { /* best-effort close */ }
    }
  }
}
