import Decimal from "decimal.js";
import { createHash } from "node:crypto";

import type { Market, StrategyPositionSnapshot, TrackedOrder } from "@cryptobot-labs/trading-core";

import type { AsyncSafeStorage, VaultFileStore } from "./vault";

const Exact = Decimal.clone({ precision: 96 });
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const ID = /^[A-Za-z0-9_.:@/+\-]{1,128}$/;
const PROCESSED = /^[A-Za-z0-9_.:@/+\-]{1,256}$/;
const MAX_BYTES = 512 * 1024;
const MAX_PROCESSED = 1_024;

interface State {
  schemaVersion: 1;
  recordVersion: number;
  deploymentId: string;
  market: Market;
  symbol: string;
  dayStartEquity: string;
  utcDay: string;
  position: StrategyPositionSnapshot | null;
  lastMarkPrice: string;
  lastMarkAt: number;
  lastSignalAt: number | null;
  realizedDailyPnl: string;
  consecutiveFailures: number;
  signalSequence: number;
  lastEvaluatedCloseTime: number | null;
  processedOrderIds: string[];
  updatedAt: number;
}

export interface LiveLocalSnapshot {
  readonly dayStartEquity: string;
  readonly utcDay: string;
  readonly position?: Readonly<StrategyPositionSnapshot>;
  readonly lastSignalAt: number | null;
  readonly realizedDailyPnl: string;
  readonly consecutiveFailures: number;
  readonly nextSignalSequence: number;
  readonly lastEvaluatedCloseTime: number | null;
}

const decimal = (value: unknown, positive = false): string => {
  if (typeof value !== "string" || !DECIMAL.test(value) || (positive && !new Exact(value).isPositive())) {
    throw new Error("Live state is corrupt");
  }
  return value;
};
const integer = (value: unknown, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error("Live state is corrupt");
  return value as number;
};
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

function position(value: unknown): StrategyPositionSnapshot | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Live state is corrupt");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join() !== ["side","quantity","entryPrice","peakPrice","troughPrice","usedMargin","layerCount"].sort().join()
    || (item.side !== "long" && item.side !== "short")) throw new Error("Live state is corrupt");
  return Object.freeze({ side: item.side, quantity: decimal(item.quantity, true), entryPrice: decimal(item.entryPrice, true),
    peakPrice: decimal(item.peakPrice, true), troughPrice: decimal(item.troughPrice, true),
    usedMargin: decimal(item.usedMargin), layerCount: integer(item.layerCount, 1) });
}

function parse(raw: string): State {
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) throw new Error("Live state is corrupt");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Live state is corrupt"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Live state is corrupt");
  const item = value as Record<string, unknown>;
  const keys = ["schemaVersion","recordVersion","deploymentId","market","symbol","dayStartEquity","utcDay","position",
    "lastMarkPrice","lastMarkAt","lastSignalAt","realizedDailyPnl","consecutiveFailures","signalSequence",
    "lastEvaluatedCloseTime","processedOrderIds","updatedAt"];
  if (Object.keys(item).sort().join() !== keys.sort().join() || item.schemaVersion !== 1 || !ID.test(String(item.deploymentId))
    || (item.market !== "spot" && item.market !== "futures") || typeof item.symbol !== "string"
    || !/^[A-Z0-9]{4,34}$/.test(item.symbol) || typeof item.utcDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.utcDay)
    || !Array.isArray(item.processedOrderIds) || item.processedOrderIds.length > MAX_PROCESSED
    || item.processedOrderIds.some((id) => typeof id !== "string" || !PROCESSED.test(id))
    || new Set(item.processedOrderIds).size !== item.processedOrderIds.length) throw new Error("Live state is corrupt");
  return { schemaVersion: 1, recordVersion: integer(item.recordVersion, 1), deploymentId: String(item.deploymentId), market: item.market,
    symbol: item.symbol, dayStartEquity: decimal(item.dayStartEquity, true), utcDay: item.utcDay,
    position: position(item.position), lastMarkPrice: decimal(item.lastMarkPrice, true), lastMarkAt: integer(item.lastMarkAt),
    lastSignalAt: item.lastSignalAt === null ? null : integer(item.lastSignalAt),
    realizedDailyPnl: decimal(item.realizedDailyPnl), consecutiveFailures: integer(item.consecutiveFailures),
    signalSequence: integer(item.signalSequence),
    lastEvaluatedCloseTime: item.lastEvaluatedCloseTime === null ? null : integer(item.lastEvaluatedCloseTime),
    processedOrderIds: [...item.processedOrderIds] as string[], updatedAt: integer(item.updatedAt) };
}

async function decrypt(storage: AsyncSafeStorage, file: VaultFileStore): Promise<State | null> {
  if (!(await storage.isAsyncEncryptionAvailable())) throw new Error("OS-backed live state encryption is unavailable");
  const bytes = await file.read();
  if (!bytes) return null;
  const operation = storage.decryptStringAsync ?? storage.decryptString;
  if (!operation) throw new Error("Live state decryption is unavailable");
  const copy = Uint8Array.from(bytes);
  try { return parse(await operation.call(storage, copy)); } finally { copy.fill(0); }
}

async function encrypt(storage: AsyncSafeStorage, file: VaultFileStore, state: State): Promise<void> {
  const operation = storage.encryptStringAsync ?? storage.encryptString;
  if (!(await storage.isAsyncEncryptionAvailable()) || !operation) throw new Error("OS-backed live state encryption is unavailable");
  const plain = Buffer.from(JSON.stringify(state));
  if (plain.byteLength > MAX_BYTES) { plain.fill(0); throw new Error("Live state exceeds size limit"); }
  let bytes: Uint8Array | undefined;
  try {
    bytes = Uint8Array.from(await operation.call(storage, plain.toString("utf8")));
    if (!bytes.length) throw new Error("Live state encryption failed");
    await file.writeAtomically(bytes, 0o600);
  } finally { plain.fill(0); bytes?.fill(0); }
}

/** Encrypted local ownership and exactly-once candle cursor for live execution. */
export class DurableLiveState {
  readonly #storage: AsyncSafeStorage;
  readonly #file: VaultFileStore;
  #tail: Promise<void> = Promise.resolve();

  constructor(storage: AsyncSafeStorage, file: VaultFileStore) { this.#storage = storage; this.#file = file; }
  #exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(work, work); this.#tail = result.then(() => undefined, () => undefined); return result;
  }

  initialize(input: { deploymentId: string; market: Market; symbol: string; dayStartEquity: string; now: number }): Promise<void> {
    return this.#exclusive(async () => {
      const existing = await decrypt(this.#storage, this.#file);
      if (existing) {
        if (existing.deploymentId !== input.deploymentId || existing.market !== input.market || existing.symbol !== input.symbol) {
          throw new Error("Live state deployment fence failed");
        }
        return;
      }
      const now = integer(input.now);
      await encrypt(this.#storage, this.#file, { schemaVersion: 1, recordVersion: 1, deploymentId: input.deploymentId,
        market: input.market, symbol: input.symbol, dayStartEquity: decimal(input.dayStartEquity, true), utcDay: day(now),
        position: null, lastMarkPrice: "1", lastMarkAt: now, lastSignalAt: null, realizedDailyPnl: "0",
        consecutiveFailures: 0, signalSequence: 0, lastEvaluatedCloseTime: null, processedOrderIds: [], updatedAt: now });
    });
  }

  snapshot(): Promise<LiveLocalSnapshot | null> {
    return this.#exclusive(async () => {
      const state = await decrypt(this.#storage, this.#file);
      return state ? Object.freeze({ dayStartEquity: state.dayStartEquity, utcDay: state.utcDay,
        ...(state.position ? { position: Object.freeze({ ...state.position }) } : {}), lastSignalAt: state.lastSignalAt,
        realizedDailyPnl: state.realizedDailyPnl, consecutiveFailures: state.consecutiveFailures,
        nextSignalSequence: state.signalSequence + 1, lastEvaluatedCloseTime: state.lastEvaluatedCloseTime }) : null;
    });
  }

  mark(priceValue: string, atValue: number): Promise<void> {
    return this.#exclusive(async () => {
      const state = await this.#required(); const price = decimal(priceValue, true); const at = integer(atValue);
      if (at < state.lastMarkAt) throw new Error("Live mark moved backward");
      if (state.position) { state.position = Object.freeze({ ...state.position,
        peakPrice: Exact.max(state.position.peakPrice, price).toFixed(),
        troughPrice: Exact.min(state.position.troughPrice, price).toFixed() }); }
      state.lastMarkPrice = price; state.lastMarkAt = at; state.updatedAt = at; state.recordVersion += 1;
      await encrypt(this.#storage, this.#file, state);
    });
  }

  rollDay(equityValue: string, atValue: number): Promise<void> {
    return this.#exclusive(async () => {
      const state = await this.#required(); const at = integer(atValue); const next = day(at);
      if (next === state.utcDay) return;
      if (at < state.updatedAt) throw new Error("Live day moved backward");
      state.utcDay = next; state.dayStartEquity = decimal(equityValue, true); state.realizedDailyPnl = "0";
      state.updatedAt = at; state.recordVersion += 1; await encrypt(this.#storage, this.#file, state);
    });
  }

  applyFill(order: TrackedOrder, atValue: number): Promise<void> {
    return this.#exclusive(async () => {
      const state = await this.#required(); const at = integer(atValue);
      if (order.deploymentId !== state.deploymentId || order.executionTarget.mode !== "live"
        || order.executionTarget.market !== state.market || order.approvedIntent.symbol !== state.symbol
        || (order.status !== "filled" && order.status !== "cancelled") || order.cumulativeFilledQuantity === "0"
        || !order.averageFillPrice || order.fees === undefined) throw new Error("Invalid live fill");
      const fingerprint = `${order.clientOrderId}:${createHash("sha256").update(JSON.stringify({ exchangeOrderId: order.exchangeOrderId,
        quantity: order.cumulativeFilledQuantity, price: order.averageFillPrice, fees: order.fees })).digest("hex")}`;
      const replay = state.processedOrderIds.find((value) => value.startsWith(`${order.clientOrderId}:`));
      if (replay) { if (replay === fingerprint) return; throw new Error("Live fill replay conflict"); }
      if (state.processedOrderIds.length >= MAX_PROCESSED || at < state.updatedAt) throw new Error("Live fill cannot be applied");
      const price = new Exact(decimal(order.averageFillPrice, true));
      const quantity = new Exact(decimal(order.cumulativeFilledQuantity, true));
      const fees = new Exact(decimal(order.fees));
      const direction = order.approvedIntent.side === "buy" ? "long" : "short";
      let realized = fees.neg(); const current = state.position;
      if (!current) {
        if (order.approvedIntent.reduceOnly || (state.market === "spot" && direction === "short")) throw new Error("Invalid live opening fill");
        state.position = Object.freeze({ side: direction, quantity: quantity.toFixed(), entryPrice: price.toFixed(),
          peakPrice: price.toFixed(), troughPrice: price.toFixed(), usedMargin: "0", layerCount: 1 });
      } else if (current.side === direction) {
        if (order.approvedIntent.reduceOnly) throw new Error("Invalid live add fill");
        const old = new Exact(current.quantity); const total = old.add(quantity);
        state.position = Object.freeze({ ...current, quantity: total.toFixed(),
          entryPrice: new Exact(current.entryPrice).mul(old).add(price.mul(quantity)).div(total).toFixed(),
          peakPrice: Exact.max(current.peakPrice, price).toFixed(), troughPrice: Exact.min(current.troughPrice, price).toFixed(),
          layerCount: current.layerCount + 1 });
      } else {
        if (!order.approvedIntent.reduceOnly || quantity.gt(current.quantity)) throw new Error("Invalid live reduction fill");
        const pnl = current.side === "long" ? price.sub(current.entryPrice) : new Exact(current.entryPrice).sub(price);
        realized = realized.add(pnl.mul(quantity)); const remaining = new Exact(current.quantity).sub(quantity);
        state.position = remaining.isZero() ? null : Object.freeze({ ...current, quantity: remaining.toFixed() });
      }
      state.realizedDailyPnl = new Exact(state.realizedDailyPnl).add(realized).toFixed();
      state.processedOrderIds.push(fingerprint); state.lastMarkPrice = price.toFixed(); state.lastMarkAt = Math.max(state.lastMarkAt, at);
      state.updatedAt = at; state.recordVersion += 1; await encrypt(this.#storage, this.#file, state);
    });
  }

  completeEvaluation(input: { closeTime: number; at: number; signaled: boolean; failed: boolean }): Promise<void> {
    return this.#exclusive(async () => {
      const state = await this.#required(); const closeTime = integer(input.closeTime); const at = integer(input.at);
      if (state.lastEvaluatedCloseTime !== null && closeTime <= state.lastEvaluatedCloseTime) {
        if (closeTime === state.lastEvaluatedCloseTime) return;
        throw new Error("Live evaluation cursor moved backward");
      }
      if (at < state.updatedAt) throw new Error("Live evaluation time moved backward");
      state.signalSequence += 1; state.lastEvaluatedCloseTime = closeTime;
      if (input.signaled) state.lastSignalAt = at;
      state.consecutiveFailures = input.failed ? state.consecutiveFailures + 1 : 0;
      state.updatedAt = at; state.recordVersion += 1; await encrypt(this.#storage, this.#file, state);
    });
  }

  async #required(): Promise<State> {
    const state = await decrypt(this.#storage, this.#file); if (!state) throw new Error("Live state is not initialized"); return state;
  }
}
