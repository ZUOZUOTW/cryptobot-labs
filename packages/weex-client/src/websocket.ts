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
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_PUSH_ENTRIES = 100;

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
export type PrivateStreamState = "idle" | "connecting" | "open" | "reconnecting" | "error" | "closed";

export interface WeexPrivateStreamOptions {
  readonly target: ExecutionTarget;
  readonly credentials: WeexCredentials;
  readonly factory: PrivateSocketFactory;
  readonly lookup: PrivateOrderLookup;
  readonly clock: PrivateStreamClock;
  readonly scheduler?: (delayMs: number) => Promise<void>;
  readonly maximumQueueSize?: number;
  readonly maximumReconnectAttempts?: number;
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
      !isCanonicalPositiveDecimal(quantity)) {
    throw schema("Invalid private order identity");
  }
  if (typeof source.status !== "string" || source.status.length < 1 || source.status.length > 32 ||
      !isCanonicalNonnegativeDecimal(source.cumFillSize) ||
      !isCanonicalNonnegativeDecimal(source.cumFillFee) ||
      !isCanonicalNonnegativeDecimal(source.latestFillPrice) ||
      !Number.isSafeInteger(source.updatedTime) || (source.updatedTime as number) < 0) {
    throw schema("Invalid private order state");
  }
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
  readonly #userAgent: string;
  readonly #listeners = new Set<PrivateOrderListener>();
  readonly #lastFills = new Map<string, string>();

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
    if (!Number.isSafeInteger(maximumQueueSize) || maximumQueueSize < 1 || maximumQueueSize > 4096 ||
        !Number.isSafeInteger(maximumReconnectAttempts) || maximumReconnectAttempts < 0 || maximumReconnectAttempts > 10) {
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
    this.#userAgent = userAgent;
  }

  get state(): PrivateStreamState {
    return this.#state;
  }

  subscribeOrders(listener: PrivateOrderListener): () => void {
    if (typeof listener !== "function") throw validation("Invalid private order listener");
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
      let socket: PrivateSocket;
      try {
        socket = this.#factory({ url, headers });
      } catch (cause) {
        reject(new WeexApiError("WEEX websocket factory failed", { category: "network", retryable: true, cause }));
        return;
      }
      if (!socket || typeof socket.addEventListener !== "function" || typeof socket.send !== "function" ||
          typeof socket.close !== "function") {
        reject(validation("Invalid private websocket"));
        return;
      }
      this.#socket = socket;
      this.#subscribed = false;
      let opened = false;
      const listeners: SocketListeners = {
        open: () => {
          if (opened || this.#explicitlyClosed || this.#socket !== socket) return;
          opened = true;
          this.#state = "open";
          try {
            socket.send(JSON.stringify({ method: "SUBSCRIBE", params: ["orders"], id: 1 }));
            resolve();
          } catch (cause) {
            reject(new WeexApiError("WEEX websocket subscribe failed", { category: "network", retryable: true, cause }));
            this.#fatal("subscribe-failed");
          }
        },
        message: (event) => { this.#onMessage(event.data); },
        close: (event) => {
          if (!opened) reject(new WeexApiError("WEEX websocket closed before open", {
            category: "network", retryable: true,
          }));
          this.#onClose(socket, event);
        },
        error: () => {
          if (!opened) reject(new WeexApiError("WEEX websocket connection failed", {
            category: "network", retryable: true,
          }));
        },
      };
      this.#socketListeners = listeners;
      for (const type of Object.keys(listeners) as (keyof PrivateSocketEventMap)[]) {
        socket.addEventListener(type, listeners[type] as never);
      }
    });
  }

  #onMessage(data: string): void {
    if (this.#state !== "open" || typeof data !== "string" || data.length < 2 || data.length > MAX_MESSAGE_BYTES) {
      if (this.#state === "open") this.#fatal("invalid-message");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
      const source = record(parsed, "private websocket message");
      if (source.type === "ping") {
        safeTimestamp(source.time, "private ping time");
        this.#socket?.send('{"method":"PONG","id":1}');
        return;
      }
      if (source.id === 1 && Object.hasOwn(source, "result")) {
        if (this.#subscribed || (source.result !== null && source.result !== true)) {
          this.#fatal("invalid-subscription-ack");
          return;
        }
        this.#subscribed = true;
        this.#reconnectAttempts = 0;
        return;
      }
      const push = parsePush(source);
      if (push === null || !this.#subscribed || push.accountVersion <= this.#lastAccountVersion) return;
      this.#lastAccountVersion = push.accountVersion;
      this.#enqueue(push);
    } catch {
      this.#fatal("invalid-message");
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
      const snapshot = await this.#lookup.findByClientOrderId({
        target: this.#target,
        symbol: hint.symbol,
        clientOrderId: hint.clientOrderId,
        exchangeOrderId: hint.exchangeOrderId,
      });
      if (this.#state !== "open" || snapshot === null) continue;
      if (snapshot.clientOrderId !== hint.clientOrderId || snapshot.exchangeOrderId !== hint.exchangeOrderId ||
          snapshot.symbol !== hint.symbol || snapshot.side !== hint.side || snapshot.quantity !== hint.quantity ||
          !isCanonicalNonnegativeDecimal(snapshot.cumulativeFilledQuantity)) {
        throw schema("REST order identity mismatch");
      }
      const key = `${this.#target.market}:${this.#target.mode}:${snapshot.clientOrderId}`;
      const previousFill = this.#lastFills.get(key);
      if (previousFill !== undefined && compareDecimals(snapshot.cumulativeFilledQuantity, previousFill) < 0) continue;
      this.#lastFills.set(key, snapshot.cumulativeFilledQuantity);
      const event: PrivateOrderEvent = Object.freeze({
        target: this.#target,
        accountVersion: push.accountVersion,
        eventTime: push.eventTime,
        snapshot,
      });
      for (const listener of this.#listeners) listener(event);
    }
  }

  #onClose(socket: PrivateSocket): void {
    if (this.#socket !== socket) return;
    this.#detachSocket(false);
    if (this.#explicitlyClosed || this.#state === "error" || this.#state === "closed") return;
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
        await this.#openSocket();
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
        socket.removeEventListener(type, listeners[type] as never);
      }
    }
    if (socket && (close || code !== undefined)) {
      try { socket.close(code, reason); } catch { /* best-effort close */ }
    }
  }
}
