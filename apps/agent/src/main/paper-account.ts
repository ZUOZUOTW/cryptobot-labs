import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import type { Market, TrackedOrder } from "@cryptobot-labs/trading-core";

import type { PaperAccountSnapshot } from "./paper-evaluation-context";
import type { AsyncSafeStorage, VaultFileStore } from "./vault";

const Exact = Decimal.clone({ precision: 96 });
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const ID = /^[A-Za-z0-9_.:@/+\-]{1,128}$/;
const MAX_PROCESSED = 1_024;
const MAX_BYTES = 512 * 1024;

interface Position { side: "long" | "short"; quantity: string; entryPrice: string; peakPrice: string; troughPrice: string; layerCount: number }
interface State { schemaVersion: 1; recordVersion: number; deploymentId: string; market: Market; symbol: string; initialEquity: string;
  realizedPnl: string; realizedDailyPnl: string; dayStartEquity: string; utcDay: string; position: Position | null;
  lastMarkPrice: string; lastMarkAt: number; lastSignalAt: number | null; consecutiveFailures: number;
  signalSequence: number; lastEvaluatedCloseTime: number | null; processedOrderIds: string[]; updatedAt: number }

const decimal = (value: unknown, positive = false): string => {
  if (typeof value !== "string" || !DECIMAL.test(value) || (positive && !new Exact(value).isPositive())) throw new Error("Paper account is corrupt");
  return value;
};
const integer = (value: unknown, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error("Paper account is corrupt"); return value as number;
};
const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

function parse(raw: string): State {
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) throw new Error("Paper account is corrupt");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("Paper account is corrupt"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Paper account is corrupt");
  const item = value as Record<string, unknown>;
  const keys = ["schemaVersion","recordVersion","deploymentId","market","symbol","initialEquity","realizedPnl","realizedDailyPnl",
    "dayStartEquity","utcDay","position","lastMarkPrice","lastMarkAt","lastSignalAt","consecutiveFailures","processedOrderIds","updatedAt"];
  keys.push("signalSequence", "lastEvaluatedCloseTime");
  if (Object.keys(item).sort().join() !== [...keys].sort().join() || item.schemaVersion !== 1 || !ID.test(String(item.deploymentId)) ||
      (item.market !== "spot" && item.market !== "futures") || typeof item.symbol !== "string" || !/^[A-Z0-9]{4,34}$/.test(item.symbol) ||
      typeof item.utcDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.utcDay) || !Array.isArray(item.processedOrderIds) ||
      item.processedOrderIds.length > MAX_PROCESSED || item.processedOrderIds.some((id) => typeof id !== "string" || !ID.test(id)) ||
      new Set(item.processedOrderIds).size !== item.processedOrderIds.length) throw new Error("Paper account is corrupt");
  let position: Position | null = null;
  if (item.position !== null) {
    if (!item.position || typeof item.position !== "object" || Array.isArray(item.position)) throw new Error("Paper account is corrupt");
    const p = item.position as Record<string, unknown>;
    if (Object.keys(p).sort().join() !== ["side","quantity","entryPrice","peakPrice","troughPrice","layerCount"].sort().join() ||
        (p.side !== "long" && p.side !== "short")) throw new Error("Paper account is corrupt");
    position = { side: p.side, quantity: decimal(p.quantity, true), entryPrice: decimal(p.entryPrice, true),
      peakPrice: decimal(p.peakPrice, true), troughPrice: decimal(p.troughPrice, true), layerCount: integer(p.layerCount, 1) };
  }
  return { schemaVersion: 1, recordVersion: integer(item.recordVersion, 1), deploymentId: String(item.deploymentId), market: item.market,
    symbol: item.symbol, initialEquity: decimal(item.initialEquity, true), realizedPnl: decimal(item.realizedPnl),
    realizedDailyPnl: decimal(item.realizedDailyPnl), dayStartEquity: decimal(item.dayStartEquity, true), utcDay: item.utcDay,
    position, lastMarkPrice: decimal(item.lastMarkPrice, true), lastMarkAt: integer(item.lastMarkAt),
    lastSignalAt: item.lastSignalAt === null ? null : integer(item.lastSignalAt), consecutiveFailures: integer(item.consecutiveFailures),
    signalSequence: integer(item.signalSequence), lastEvaluatedCloseTime: item.lastEvaluatedCloseTime === null ? null : integer(item.lastEvaluatedCloseTime),
    processedOrderIds: [...item.processedOrderIds] as string[], updatedAt: integer(item.updatedAt) };
}

async function decrypt(storage: AsyncSafeStorage, file: VaultFileStore): Promise<State | null> {
  if (!(await storage.isAsyncEncryptionAvailable())) throw new Error("OS-backed paper account encryption is unavailable");
  const bytes = await file.read(); if (!bytes) return null; const operation = storage.decryptStringAsync ?? storage.decryptString;
  if (!operation) throw new Error("Paper account decryption is unavailable"); const copy = Uint8Array.from(bytes);
  try { return parse(await operation.call(storage, copy)); } finally { copy.fill(0); }
}
async function encrypt(storage: AsyncSafeStorage, file: VaultFileStore, state: State): Promise<void> {
  const operation = storage.encryptStringAsync ?? storage.encryptString;
  if (!(await storage.isAsyncEncryptionAvailable()) || !operation) throw new Error("OS-backed paper account encryption is unavailable");
  const plain = Buffer.from(JSON.stringify(state)); if (plain.byteLength > MAX_BYTES) { plain.fill(0); throw new Error("Paper account exceeds size limit"); }
  let bytes: Uint8Array | undefined; try { bytes = Uint8Array.from(await operation.call(storage, plain.toString("utf8")));
    if (!bytes.length) throw new Error("Paper account encryption failed"); await file.writeAtomically(bytes, 0o600); }
  finally { plain.fill(0); bytes?.fill(0); }
}

export class DurablePaperAccount {
  readonly #storage: AsyncSafeStorage; readonly #file: VaultFileStore; #tail: Promise<void> = Promise.resolve();
  constructor(storage: AsyncSafeStorage, file: VaultFileStore) { this.#storage = storage; this.#file = file; }
  #exclusive<T>(work: () => Promise<T>): Promise<T> { const result = this.#tail.then(work, work); this.#tail = result.then(() => undefined, () => undefined); return result; }

  initialize(input: { deploymentId: string; market: Market; symbol: string; initialEquity: string; now: number }): Promise<void> {
    return this.#exclusive(async () => { const existing = await decrypt(this.#storage, this.#file);
      if (existing) { if (existing.deploymentId !== input.deploymentId || existing.market !== input.market || existing.symbol !== input.symbol || existing.initialEquity !== input.initialEquity) throw new Error("Paper account deployment fence failed"); return; }
      const equity = decimal(input.initialEquity, true), now = integer(input.now);
      await encrypt(this.#storage, this.#file, { schemaVersion: 1, recordVersion: 1, deploymentId: input.deploymentId, market: input.market,
        symbol: input.symbol, initialEquity: equity, realizedPnl: "0", realizedDailyPnl: "0", dayStartEquity: equity, utcDay: utcDay(now),
        position: null, lastMarkPrice: "1", lastMarkAt: now, lastSignalAt: null, consecutiveFailures: 0,
        signalSequence: 0, lastEvaluatedCloseTime: null, processedOrderIds: [], updatedAt: now }); });
  }

  mark(priceValue: string, atValue: number): Promise<void> { return this.#exclusive(async () => { const state = await this.#required();
    const price = decimal(priceValue, true), at = integer(atValue); if (at < state.lastMarkAt) throw new Error("Paper mark moved backward");
    const nextDay = utcDay(at); if (nextDay !== state.utcDay) { state.dayStartEquity = this.#equity(state, price);
      state.realizedDailyPnl = "0"; state.utcDay = nextDay; }
    if (state.position) { state.position.peakPrice = Exact.max(state.position.peakPrice, price).toFixed(); state.position.troughPrice = Exact.min(state.position.troughPrice, price).toFixed(); }
    state.lastMarkPrice = price; state.lastMarkAt = at; state.updatedAt = at; state.recordVersion += 1; await encrypt(this.#storage, this.#file, state); }); }

  applyFill(order: TrackedOrder, atValue: number): Promise<void> { return this.#exclusive(async () => { const state = await this.#required(), at = integer(atValue);
    if (order.deploymentId !== state.deploymentId || order.executionTarget.mode !== "paper" || order.executionTarget.market !== state.market ||
        order.approvedIntent.symbol !== state.symbol || order.status !== "filled" || !order.averageFillPrice || order.fees === undefined) throw new Error("Invalid paper fill");
    if (at < state.updatedAt) throw new Error("Paper fill moved backward");
    const fingerprint = `${order.clientOrderId}:${createHash("sha256").update(JSON.stringify({ exchangeOrderId: order.exchangeOrderId,
      quantity: order.cumulativeFilledQuantity, price: order.averageFillPrice, fees: order.fees })).digest("hex")}`;
    const replay = state.processedOrderIds.find((value) => value.startsWith(`${order.clientOrderId}:`));
    if (replay) { if (replay === fingerprint) return; throw new Error("Paper fill replay conflict"); }
    if (state.processedOrderIds.length >= MAX_PROCESSED) throw new Error("Paper account fill registry is full");
    const price = new Exact(decimal(order.averageFillPrice, true)), quantity = new Exact(decimal(order.cumulativeFilledQuantity, true)), fees = new Exact(decimal(order.fees));
    const direction = order.approvedIntent.side === "buy" ? "long" : "short";
    let realized = fees.neg(); const current = state.position;
    if (!current) {
      if (order.approvedIntent.reduceOnly || (state.market === "spot" && direction === "short")) throw new Error("Invalid paper opening fill");
      state.position = { side: direction, quantity: quantity.toFixed(), entryPrice: price.toFixed(), peakPrice: price.toFixed(), troughPrice: price.toFixed(), layerCount: 1 };
    } else if (current.side === direction) {
      if (order.approvedIntent.reduceOnly) throw new Error("Invalid paper add fill");
      const oldQuantity = new Exact(current.quantity), total = oldQuantity.add(quantity);
      current.entryPrice = new Exact(current.entryPrice).mul(oldQuantity).add(price.mul(quantity)).div(total).toFixed(); current.quantity = total.toFixed(); current.layerCount += 1;
      current.peakPrice = Exact.max(current.peakPrice, price).toFixed(); current.troughPrice = Exact.min(current.troughPrice, price).toFixed();
    } else {
      if (!order.approvedIntent.reduceOnly || quantity.gt(current.quantity)) throw new Error("Invalid paper reduction fill");
      const pnlPerUnit = current.side === "long" ? price.sub(current.entryPrice) : new Exact(current.entryPrice).sub(price);
      realized = realized.add(pnlPerUnit.mul(quantity)); const remaining = new Exact(current.quantity).sub(quantity);
      if (remaining.isZero()) state.position = null; else current.quantity = remaining.toFixed();
    }
    state.realizedPnl = new Exact(state.realizedPnl).add(realized).toFixed(); state.realizedDailyPnl = new Exact(state.realizedDailyPnl).add(realized).toFixed();
    state.processedOrderIds.push(fingerprint); state.lastMarkPrice = price.toFixed(); state.lastMarkAt = Math.max(state.lastMarkAt, at);
    state.updatedAt = at; state.recordVersion += 1; await encrypt(this.#storage, this.#file, state); }); }

  evaluationCursor(): Promise<{ nextSignalSequence: number; lastEvaluatedCloseTime: number | null }> {
    return this.#exclusive(async () => { const state = await this.#required();
      return { nextSignalSequence: state.signalSequence + 1, lastEvaluatedCloseTime: state.lastEvaluatedCloseTime }; });
  }

  completeEvaluation(input: { closeTime: number; at: number; signaled: boolean; failed: boolean }): Promise<void> {
    return this.#exclusive(async () => { const state = await this.#required(), closeTime = integer(input.closeTime), at = integer(input.at);
      if (state.lastEvaluatedCloseTime !== null && closeTime <= state.lastEvaluatedCloseTime) {
        if (closeTime === state.lastEvaluatedCloseTime) return;
        throw new Error("Paper evaluation cursor moved backward");
      }
      if (at < state.updatedAt) throw new Error("Paper evaluation time moved backward");
      state.signalSequence += 1; state.lastEvaluatedCloseTime = closeTime;
      if (input.signaled) state.lastSignalAt = at;
      state.consecutiveFailures = input.failed ? state.consecutiveFailures + 1 : 0;
      state.updatedAt = at; state.recordVersion += 1; await encrypt(this.#storage, this.#file, state);
    });
  }

  snapshot(leverageValue: string): Promise<PaperAccountSnapshot> { return this.#exclusive(async () => { const state = await this.#required();
    const leverage = new Exact(decimal(leverageValue, true)), mark = new Exact(state.lastMarkPrice), equity = new Exact(this.#equity(state, state.lastMarkPrice));
    const notional = state.position ? new Exact(state.position.quantity).mul(mark) : new Exact(0);
    const available = Decimal.max(0, equity.sub(notional.div(leverage))).toFixed();
    return Object.freeze({ portfolio: Object.freeze({ equity: equity.toFixed(), dayStartEquity: state.dayStartEquity, availableEquity: available,
      utcDay: state.utcDay, ...(state.position ? { position: Object.freeze({ ...state.position, usedMargin: notional.div(leverage).toFixed() }) } : {}) }),
    risk: Object.freeze({ lastSignalAt: state.lastSignalAt, openPositions: state.position ? 1 : 0, positionSide: state.position?.side ?? "flat",
      currentPositionQuantity: state.position?.quantity ?? "0", currentPositionNotional: notional.toFixed(), totalExposure: notional.toFixed(),
      realizedDailyPnl: state.realizedDailyPnl, unrealizedDailyPnl: this.#unrealized(state, state.lastMarkPrice), consecutiveFailures: state.consecutiveFailures }) }); }); }

  async #required(): Promise<State> { const state = await decrypt(this.#storage, this.#file); if (!state) throw new Error("Paper account is not initialized"); return state; }
  #unrealized(state: State, markValue: string): string { if (!state.position) return "0"; const mark = new Exact(markValue), entry = new Exact(state.position.entryPrice), quantity = new Exact(state.position.quantity);
    return (state.position.side === "long" ? mark.sub(entry) : entry.sub(mark)).mul(quantity).toFixed(); }
  #equity(state: State, mark: string): string { return new Exact(state.initialEquity).add(state.realizedPnl).add(this.#unrealized(state, mark)).toFixed(); }
}
