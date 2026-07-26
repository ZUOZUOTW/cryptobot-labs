import {
  parseIntervalMs,
  type WeexPublicClient,
} from "@cryptobot-labs/weex-client";
import type { Candle, InstrumentRules, Market } from "@cryptobot-labs/trading-core";

interface MarketRequest {
  readonly market: Market;
  readonly symbol: string;
  readonly timeframe: string;
}

interface CandleEntry {
  readonly endTime: number;
  readonly candles: readonly Candle[];
}

interface RuleEntry {
  readonly expiresAt: number;
  readonly rules: InstrumentRules;
}

interface MarketDataClient {
  collectHistoricalCandles: WeexPublicClient["collectHistoricalCandles"];
  getInstrumentRules: WeexPublicClient["getInstrumentRules"];
}

const mergeCandles = (left: readonly Candle[], right: readonly Candle[]): readonly Candle[] => {
  const values = new Map<number, Candle>();
  for (const candle of [...left, ...right]) values.set(candle.openTime, candle);
  return Object.freeze([...values.values()]
    .sort((a, b) => a.openTime - b.openTime)
    .filter(({ complete }) => complete)
    .slice(-300));
};

export class CloudMarketDataCache {
  readonly #candles = new Map<string, CandleEntry>();
  readonly #candleRequests = new Map<string, Promise<readonly Candle[]>>();
  readonly #rules = new Map<string, RuleEntry>();
  readonly #ruleRequests = new Map<string, Promise<InstrumentRules>>();

  constructor(
    private readonly client: MarketDataClient,
    private readonly now: () => number = Date.now,
    private readonly maximumEntries = 256,
  ) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 2_048) {
      throw new TypeError("Invalid market cache capacity");
    }
  }

  expectedCloseAt(request: MarketRequest, now = this.now()): number {
    const interval = parseIntervalMs(request.timeframe);
    return Math.floor(now / interval) * interval - 1;
  }

  async history(request: MarketRequest, now = this.now()): Promise<readonly Candle[]> {
    const interval = parseIntervalMs(request.timeframe);
    const endTime = Math.floor(now / interval) * interval;
    const key = `${request.market}:${request.symbol}:${request.timeframe}`;
    const existing = this.#candles.get(key);
    if (existing?.endTime === endTime) return existing.candles;
    const pendingKey = `${key}:${endTime}`;
    const pending = this.#candleRequests.get(pendingKey);
    if (pending) return pending;

    const requestPromise = (async () => {
      const gap = existing ? Math.max(1, Math.ceil((endTime - existing.endTime) / interval)) : 300;
      const requestedCount = existing && gap <= 98 ? Math.min(100, gap + 2) : 300;
      const startTime = Math.max(0, endTime - interval * requestedCount);
      const dataset = await this.client.collectHistoricalCandles({
        market: request.market,
        symbol: request.symbol,
        interval: request.timeframe,
        startTime,
        endTime,
        limit: 100,
      });
      const candles = mergeCandles(existing?.candles ?? [], dataset.candles);
      const latest = candles.at(-1);
      if (!latest || latest.closeTime < endTime - 1) {
        throw new Error("WEEX candle history did not reach the latest closed interval");
      }
      this.#touch(this.#candles, key, { endTime, candles });
      return candles;
    })();
    this.#candleRequests.set(pendingKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      this.#candleRequests.delete(pendingKey);
    }
  }

  async instrumentRules(market: Market, symbol: string): Promise<InstrumentRules> {
    const key = `${market}:${symbol}`;
    const now = this.now();
    const existing = this.#rules.get(key);
    if (existing && existing.expiresAt > now) return existing.rules;
    const pending = this.#ruleRequests.get(key);
    if (pending) return pending;
    const request = this.client.getInstrumentRules(market, symbol).then((rules) => {
      this.#touch(this.#rules, key, { rules, expiresAt: this.now() + 5 * 60_000 });
      return rules;
    });
    this.#ruleRequests.set(key, request);
    try {
      return await request;
    } finally {
      this.#ruleRequests.delete(key);
    }
  }

  #touch<K, V>(values: Map<K, V>, key: K, value: V): void {
    values.delete(key);
    while (values.size >= this.maximumEntries) {
      const oldest = values.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      values.delete(oldest);
    }
    values.set(key, value);
  }
}
