import { createHmac } from "node:crypto";

import type { ExchangeOrderSnapshot, ExecutionTarget } from "@cryptobot-labs/trading-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WeexCredentials,
  WeexPrivateStream,
  type PrivateSocket,
  type PrivateSocketEventMap,
  type PrivateSocketFactory,
} from "../src";

type Listener<K extends keyof PrivateSocketEventMap> = (event: PrivateSocketEventMap[K]) => void;

class MockSocket implements PrivateSocket {
  readonly sent: string[] = [];
  readonly listeners = new Map<keyof PrivateSocketEventMap, Set<(event: never) => void>>();
  readyState = 0;
  closeCalls: Array<readonly [number | undefined, string | undefined]> = [];

  addEventListener<K extends keyof PrivateSocketEventMap>(type: K, listener: Listener<K>): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener as (event: never) => void);
    this.listeners.set(type, listeners);
  }

  removeEventListener<K extends keyof PrivateSocketEventMap>(type: K, listener: Listener<K>): void {
    const listeners = this.listeners.get(type);
    listeners?.delete(listener as (event: never) => void);
    if (listeners?.size === 0) this.listeners.delete(type);
  }

  send(data: string): void { this.sent.push(data); }
  close(code?: number, reason?: string): void { this.closeCalls.push([code, reason]); this.readyState = 3; }

  emit<K extends keyof PrivateSocketEventMap>(type: K, event: PrivateSocketEventMap[K]): void {
    if (type === "open") this.readyState = 1;
    if (type === "close") this.readyState = 3;
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
}

const credentials = new WeexCredentials("api-key", "secret-key", "passphrase");
const spot = { market: "spot", mode: "live" } as const;
const futures = { market: "futures", mode: "live" } as const;

function snapshot(overrides: Partial<ExchangeOrderSnapshot> = {}): ExchangeOrderSnapshot {
  return {
    clientOrderId: "client-1",
    exchangeOrderId: "9001",
    symbol: "BTCUSDT",
    side: "buy",
    quantity: "2",
    status: "PARTIALLY_FILLED",
    cumulativeFilledQuantity: "1",
    averageFillPrice: "50000",
    fees: "1",
    ...overrides,
  };
}

function push(version = 1, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    e: "orders",
    E: 1_700_000_000_100,
    v: version,
    msgEvent: "OrderUpdate",
    d: [{
      id: "9001",
      symbol: "BTCUSDT",
      orderSide: "BUY",
      size: "2",
      clientOrderId: "client-1",
      status: "PARTIALLY_FILLED",
      cumFillSize: "1",
      cumFillFee: "1",
      latestFillPrice: "50000",
      updatedTime: "1700000000000",
      ...overrides,
    }],
  });
}

function setup(target: ExecutionTarget = spot, options: Record<string, unknown> = {}) {
  const sockets: MockSocket[] = [];
  const factory = vi.fn<PrivateSocketFactory>(() => {
    const socket = new MockSocket();
    sockets.push(socket);
    return socket;
  });
  const lookup = { findByClientOrderId: vi.fn(async () => snapshot()) };
  const clock = {
    now: () => 1_700_000_000_000,
    assertPrivateRequestWindow: vi.fn(),
  };
  const stream = new WeexPrivateStream({ target, credentials, factory, lookup, clock, ...options });
  return { stream, sockets, factory, lookup, clock };
}

async function connect(stream: WeexPrivateStream, sockets: MockSocket[]): Promise<MockSocket> {
  const promise = stream.connect();
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  sockets[0].emit("open", {});
  acknowledge(sockets[0]);
  await promise;
  return sockets[0];
}

function acknowledge(socket: MockSocket): void {
  socket.emit("message", { data: JSON.stringify({ id: 1, result: true }) });
}

describe("WEEX V3 private stream", () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each([
    [spot, "wss://ws-spot.weex.com/v3/ws/private"],
    [futures, "wss://ws-contract.weex.com/v3/ws/private"],
  ] as const)("uses the exact private URL and websocket signing payload for %o", async (target, url) => {
    const { stream, sockets, factory, clock } = setup(target);
    await connect(stream, sockets);
    const input = factory.mock.calls[0][0];
    expect(input.url).toBe(url);
    expect(input.headers).toEqual({
      "User-Agent": "CryptoBot-Labs-Agent/0.1",
      "ACCESS-KEY": "api-key",
      "ACCESS-PASSPHRASE": "passphrase",
      "ACCESS-TIMESTAMP": "1700000000000",
      "ACCESS-SIGN": createHmac("sha256", "secret-key")
        .update("1700000000000/v3/ws/private")
        .digest("base64"),
    });
    expect(clock.assertPrivateRequestWindow).toHaveBeenCalledWith(1_700_000_000_000);
    expect(JSON.stringify(credentials)).toBe("{}");
  });

  it("fails closed for an undocumented demo stream without invoking the factory", async () => {
    const { stream, factory } = setup({ market: "futures", mode: "futures-demo" });
    await expect(stream.connect()).rejects.toMatchObject({ category: "validation" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("connects idempotently, subscribes exactly once, and validates heartbeat", async () => {
    const { stream, sockets } = setup();
    const events: ExchangeOrderSnapshot[] = [];
    stream.subscribeOrders((event) => events.push(event.snapshot));
    const first = stream.connect();
    const second = stream.connect();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].emit("open", {});
    acknowledge(sockets[0]);
    await first;
    expect(sockets[0].sent).toEqual([JSON.stringify({ method: "SUBSCRIBE", params: ["orders"], id: 1 })]);
    sockets[0].emit("message", { data: JSON.stringify({ type: "ping", time: "1700000000000" }) });
    expect(sockets[0].sent.at(-1)).toBe('{"method":"PONG","id":1}');
    expect(events).toEqual([]);
  });

  it("treats pushes as hints and emits only exact REST-authoritative snapshots", async () => {
    const { stream, sockets, lookup } = setup();
    const listener = vi.fn();
    stream.subscribeOrders(listener);
    const socket = await connect(stream, sockets);
    socket.emit("message", { data: push() });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(lookup.findByClientOrderId).toHaveBeenCalledWith({
      target: spot,
      symbol: "BTCUSDT",
      clientOrderId: "client-1",
      exchangeOrderId: "9001",
    });
    expect(listener).toHaveBeenCalledWith({
      target: spot,
      accountVersion: 1,
      eventTime: 1_700_000_000_100,
      snapshot: snapshot(),
    });
    expect(listener.mock.calls[0][0]).not.toHaveProperty("raw");
  });

  it("requires a strict subscription acknowledgement before processing pushes", async () => {
    const { stream, sockets, lookup } = setup();
    stream.subscribeOrders(vi.fn());
    const connection = stream.connect();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0];
    socket.emit("open", {});
    socket.emit("message", { data: push() });
    await Promise.resolve();
    expect(lookup.findByClientOrderId).not.toHaveBeenCalled();
    socket.emit("message", { data: JSON.stringify({ id: 1, result: "ok" }) });
    await expect(connection).rejects.toMatchObject({ category: "schema" });
    expect(stream.state).toBe("error");
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("rejects an acknowledgement carrying conflicting authentication fields", async () => {
    const { stream, sockets } = setup();
    const connection = stream.connect();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].emit("open", {});
    sockets[0].emit("message", {
      data: JSON.stringify({ id: 1, result: true, code: "AUTH_FAILED" }),
    });
    await expect(connection).rejects.toMatchObject({ category: "schema" });
    expect(stream.state).toBe("error");
  });

  it("validates private ping time against the synchronized clock window", async () => {
    const { stream, sockets, clock } = setup();
    const socket = await connect(stream, sockets);
    clock.assertPrivateRequestWindow.mockImplementationOnce(() => {
      throw new Error("stale ping");
    });
    socket.emit("message", { data: JSON.stringify({ type: "ping", time: "1700000000000" }) });
    expect(stream.state).toBe("error");
    expect(socket.sent).not.toContain('{"method":"PONG","id":1}');
  });

  it("rejects malformed events and REST identity mismatches without reaching listeners", async () => {
    const { stream, sockets, lookup } = setup();
    const listener = vi.fn();
    stream.subscribeOrders(listener);
    const socket = await connect(stream, sockets);
    lookup.findByClientOrderId.mockResolvedValueOnce(snapshot({ exchangeOrderId: "other" }));
    socket.emit("message", { data: push() });
    await vi.waitFor(() => expect(stream.state).toBe("error"));
    expect(listener).not.toHaveBeenCalled();
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("never emits malformed or mutable REST snapshots", async () => {
    const { stream, sockets, lookup } = setup();
    const listener = vi.fn();
    stream.subscribeOrders(listener);
    const socket = await connect(stream, sockets);
    lookup.findByClientOrderId.mockResolvedValueOnce({
      ...snapshot(),
      status: "FILLED",
      cumulativeFilledQuantity: "1",
    });
    socket.emit("message", { data: push() });
    await vi.waitFor(() => expect(stream.state).toBe("error"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores duplicate and out-of-order account versions", async () => {
    const { stream, sockets, lookup } = setup();
    const listener = vi.fn();
    stream.subscribeOrders(listener);
    const socket = await connect(stream, sockets);
    socket.emit("message", { data: push(2) });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    socket.emit("message", { data: push(2) });
    socket.emit("message", { data: push(1) });
    await Promise.resolve();
    expect(lookup.findByClientOrderId).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("never emits a regressing authoritative cumulative fill", async () => {
    const { stream, sockets, lookup } = setup();
    const listener = vi.fn();
    lookup.findByClientOrderId
      .mockResolvedValueOnce(snapshot({ cumulativeFilledQuantity: "1.5" }))
      .mockResolvedValueOnce(snapshot({ cumulativeFilledQuantity: "1" }));
    stream.subscribeOrders(listener);
    const socket = await connect(stream, sockets);
    socket.emit("message", { data: push(1) });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    socket.emit("message", { data: push(2) });
    await vi.waitFor(() => expect(lookup.findByClientOrderId).toHaveBeenCalledTimes(2));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fails closed when its bounded work queue would overflow", async () => {
    let release!: () => void;
    const blocked = new Promise<ExchangeOrderSnapshot>((resolve) => { release = () => resolve(snapshot()); });
    const { stream, sockets, lookup } = setup(spot, { maximumQueueSize: 1 });
    lookup.findByClientOrderId.mockReturnValue(blocked);
    stream.subscribeOrders(vi.fn());
    const socket = await connect(stream, sockets);
    socket.emit("message", { data: push(1) });
    socket.emit("message", { data: push(2) });
    expect(stream.state).toBe("error");
    expect(socket.closeCalls).toHaveLength(1);
    release();
  });

  it("accepts documented string timestamps and a zero-sized spot market hint", async () => {
    const { stream, sockets, lookup } = setup();
    const listener = vi.fn();
    stream.subscribeOrders(listener);
    const socket = await connect(stream, sockets);
    socket.emit("message", { data: push(1, { size: "0", updatedTime: "1700000000000" }) });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(lookup.findByClientOrderId).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the official subscription acknowledgement times out", async () => {
    let releaseTimeout!: () => void;
    const acknowledgementScheduler = vi.fn(() => new Promise<void>((resolve) => { releaseTimeout = resolve; }));
    const { stream, sockets } = setup(spot, { acknowledgementScheduler, acknowledgementTimeoutMs: 100 });
    const connection = stream.connect();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].emit("open", {});
    expect(stream.state).toBe("subscribing");
    releaseTimeout();
    await expect(connection).rejects.toMatchObject({ category: "network" });
    expect(stream.state).toBe("error");
    expect(sockets[0].closeCalls).toHaveLength(1);
  });

  it("bounds reconnects, resubscribes, and never reconnects after explicit close", async () => {
    const scheduled: Array<() => void> = [];
    const scheduler = vi.fn((delay: number) => {
      void delay;
      return new Promise<void>((resolve) => scheduled.push(resolve));
    });
    const { stream, sockets, factory } = setup(spot, { scheduler, maximumReconnectAttempts: 2 });
    stream.subscribeOrders(vi.fn());
    const first = await connect(stream, sockets);
    first.emit("close", { code: 1006, reason: "network", wasClean: false });
    expect(scheduler).toHaveBeenCalledWith(250);
    scheduled.shift()?.();
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1].emit("open", {});
    await vi.waitFor(() => expect(sockets[1].sent).toHaveLength(1));
    expect(sockets[1].sent[0]).toContain("SUBSCRIBE");
    sockets[1].emit("close", { code: 1006, reason: "network", wasClean: false });
    scheduled.shift()?.();
    await vi.waitFor(() => expect(sockets).toHaveLength(3));
    sockets[2].emit("open", {});
    sockets[2].emit("close", { code: 1006, reason: "network", wasClean: false });
    await Promise.resolve();
    expect(factory).toHaveBeenCalledTimes(3);
    expect(stream.state).toBe("error");
    await expect(stream.connect()).rejects.toMatchObject({ category: "network" });
    stream.close();
    expect(stream.state).toBe("closed");
    expect(sockets[2].listeners.size).toBe(0);
  });

  it("never reconnects authentication or policy close codes", async () => {
    const scheduler = vi.fn(async () => {});
    const { stream, sockets, factory } = setup(spot, { scheduler });
    const socket = await connect(stream, sockets);
    socket.emit("close", { code: 1008, reason: "authentication rejected", wasClean: false });
    expect(stream.state).toBe("error");
    expect(scheduler).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(1);
    await expect(stream.connect()).rejects.toMatchObject({ category: "network" });
  });

  it("propagates reconnect factory failures instead of reporting success", async () => {
    const scheduled: Array<() => void> = [];
    const scheduler = vi.fn(() => new Promise<void>((resolve) => scheduled.push(resolve)));
    const { stream, sockets, factory } = setup(spot, { scheduler, maximumReconnectAttempts: 1 });
    const socket = await connect(stream, sockets);
    factory.mockImplementationOnce(() => { throw new Error("factory unavailable"); });
    socket.emit("close", { code: 1006, reason: "network", wasClean: false });
    const reconnect = stream.connect();
    scheduled.shift()?.();
    await expect(reconnect).rejects.toMatchObject({ category: "network" });
    expect(stream.state).toBe("error");
    await expect(stream.connect()).rejects.toMatchObject({ category: "network" });
  });

  it("rejects and closes an errored socket before acknowledgement, then reconnects boundedly", async () => {
    const scheduled: Array<() => void> = [];
    const scheduler = vi.fn(() => new Promise<void>((resolve) => scheduled.push(resolve)));
    const { stream, sockets } = setup(spot, { scheduler, maximumReconnectAttempts: 1 });
    const connection = stream.connect();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].emit("open", {});
    sockets[0].emit("error", {});
    await expect(connection).rejects.toMatchObject({ category: "network" });
    expect(sockets[0].closeCalls).toEqual([[1011, "socket-error"]]);
    expect(stream.state).toBe("reconnecting");
    const duringReconnect = stream.connect();
    expect(stream.connect()).toBe(duringReconnect);
    scheduled.shift()?.();
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1].emit("open", {});
    acknowledge(sockets[1]);
    await duringReconnect;
    await stream.connect();
    expect(sockets).toHaveLength(2);
    stream.close();
  });

  it("closes an errored subscribed socket before scheduling reconnect", async () => {
    const scheduler = vi.fn(() => new Promise<void>(() => {}));
    const { stream, sockets } = setup(spot, { scheduler });
    const socket = await connect(stream, sockets);
    socket.emit("error", {});
    expect(socket.closeCalls).toEqual([[1011, "socket-error"]]);
    expect(stream.state).toBe("reconnecting");
    expect(scheduler).toHaveBeenCalledWith(250);
    stream.close();
  });

  it("does not use ambient WebSocket or fetch", async () => {
    const ambientSocket = vi.fn();
    const ambientFetch = vi.fn();
    vi.stubGlobal("WebSocket", ambientSocket);
    vi.stubGlobal("fetch", ambientFetch);
    const { stream, sockets } = setup();
    await connect(stream, sockets);
    expect(ambientSocket).not.toHaveBeenCalled();
    expect(ambientFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
