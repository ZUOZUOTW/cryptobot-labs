import type { Candle, InstrumentRules, Market } from "@cryptobot-labs/trading-core";
import {
  WeexPublicClient,
  createFetchTransport,
  parseIntervalMs,
  type HttpTransport,
} from "@cryptobot-labs/weex-client";

import { ClockFreshnessGuard, MarketStreamState } from "./market-stream";

const CLOCK_PROBE = "https://api-spot.weex.com/api/v3/market/ticker/price?symbol=BTCUSDT";
const MAX_RULES_AGE_MS = 5 * 60_000;

export interface PublicMarketSnapshot {
  readonly candles: readonly Candle[];
  readonly rules: Readonly<InstrumentRules>;
  readonly collectedAt: number;
}

export class InstrumentRuleState {
  readonly #values = new Map<string, { rules: Readonly<InstrumentRules>; verifiedAt: number }>();
  record(rules: InstrumentRules, verifiedAt: number): void {
    if (!Number.isSafeInteger(verifiedAt) || verifiedAt < 0) throw new TypeError("Invalid instrument verification time");
    this.#values.set(`${rules.market}:${rules.symbol}`, Object.freeze({ rules: Object.freeze({ ...rules }), verifiedAt }));
  }
  requireFresh(market: Market, symbol: string, now: number): Readonly<InstrumentRules> {
    return this.requireFreshSnapshot(market, symbol, now).rules;
  }
  requireFreshSnapshot(market: Market, symbol: string, now: number): Readonly<{
    rules: Readonly<InstrumentRules>;
    verifiedAt: number;
  }> {
    const value = this.#values.get(`${market}:${symbol}`);
    if (!value || !Number.isSafeInteger(now) || now < value.verifiedAt || now - value.verifiedAt > MAX_RULES_AGE_MS) {
      throw new Error("Instrument rules are stale or unavailable");
    }
    return value;
  }
}

export interface PublicMarketServiceOptions {
  readonly market: MarketStreamState;
  readonly clock: ClockFreshnessGuard;
  readonly instruments: InstrumentRuleState;
  readonly transport?: HttpTransport;
  readonly now?: () => number;
}

/** Collects bounded WEEX public evidence; it never accepts credentials. */
export class PublicMarketService {
  readonly #options: PublicMarketServiceOptions;
  readonly #transport: HttpTransport;
  readonly #now: () => number;
  readonly #client: WeexPublicClient;

  constructor(options: PublicMarketServiceOptions) {
    this.#options = options; this.#transport = options.transport ?? createFetchTransport({ timeoutMs: 10_000 });
    this.#now = options.now ?? Date.now; this.#client = new WeexPublicClient(this.#transport, this.#now);
  }

  async collect(input: { market: Market; symbol: string; timeframe: string }): Promise<PublicMarketSnapshot> {
    const interval = parseIntervalMs(input.timeframe);
    const sentAt = this.#timestamp();
    const probe = await this.#transport.send({ method: "GET", url: CLOCK_PROBE, headers: { Accept: "application/json" } });
    const receivedAt = this.#timestamp();
    const body = probe.body as Record<string, unknown>;
    const serverTime = Date.parse(probe.headers.date ?? "");
    if (!body || body.symbol !== "BTCUSDT" || typeof body.price !== "string" ||
        !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(body.price) || !Number.isSafeInteger(serverTime)) {
      throw new Error("WEEX clock evidence is invalid");
    }
    const midpoint = sentAt + (receivedAt - sentAt) / 2;
    this.#options.clock.record({ synchronizedAt: receivedAt, driftMs: serverTime - midpoint });
    const rules = await this.#client.getInstrumentRules(input.market, input.symbol);
    const candles = (await this.#client.fetchCandles({ market: input.market, symbol: input.symbol,
      interval: input.timeframe, limit: 100 })).filter(({ complete }) => complete).slice(-100);
    const latest = candles.at(-1);
    if (!latest || latest.closeTime > receivedAt || receivedAt - latest.closeTime > interval * 2) {
      throw new Error("WEEX completed candles are stale or unavailable");
    }
    this.#options.instruments.record(rules, receivedAt);
    this.#options.market.record({ market: input.market, symbol: input.symbol, bid: latest.close, ask: latest.close,
      last: latest.close, exchangeTimestamp: latest.closeTime, receivedAt });
    return Object.freeze({ candles: Object.freeze(candles), rules, collectedAt: receivedAt });
  }

  #timestamp(): number {
    const value = this.#now(); if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid public market clock"); return value;
  }
}
