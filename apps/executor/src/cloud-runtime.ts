import {
  SignalIntentNormalizer,
  createVisualStrategyEvaluator,
  deriveClientOrderId,
  evaluateOrderRisk,
  type RiskContext,
  type RiskPolicy,
  type StrategyPortfolioSnapshot,
  type VisualBotConfig,
} from "@cryptobot-labs/trading-core";
import {
  createFetchTransport,
  decryptWeexCredentials,
  parseIntervalMs,
  WeexClock,
  WeexPrivateClient,
  WeexPublicClient,
  type CredentialEnvelopeKms,
} from "@cryptobot-labs/weex-client";

import type { CloudRun, CloudRuntimeRepository } from "./cloud-repository";

const CLOCK_PROBE_URL = "https://api-spot.weex.com/api/v3/market/ticker/price?symbol=BTCUSDT";
const DECIMAL = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;

const amount = (value: unknown, fallback = "0"): string =>
  typeof value === "string" && DECIMAL.test(value) ? value : fallback;
const signed = (values: readonly string[]): string => values.reduce((sum, value) => sum + Number(value), 0).toFixed(8)
  .replace(/\.?0+$/, "") || "0";

const policy = (value: Record<string, unknown>): RiskPolicy => Object.freeze({
  allowedSymbols: Object.freeze([...(value.allowedSymbols as string[])]),
  maximumOrderNotional: amount(value.maxOrderNotional),
  maximumPositionNotional: amount(value.maxPositionNotional),
  maximumTotalExposure: amount(value.maxTotalExposure),
  maximumSimultaneousPositions: Number(value.maxSimultaneousPositions),
  maximumDailyLoss: amount(value.maxDailyLoss),
  maximumLeverage: amount(value.maxLeverage),
  maximumSlippageBps: String(value.maxSlippageBps),
  minimumSignalCooldownMs: Number(value.minSignalCooldownMs),
  maximumConsecutiveFailures: Number(value.maxConsecutiveFailures),
  maximumPriceAgeMs: 120_000,
});

export class CloudStrategyRuntime {
  readonly #owner = `worker_${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
  readonly #transport = createFetchTransport({ timeoutMs: 10_000 });
  readonly #public = new WeexPublicClient(this.#transport);
  #active = false;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: {
    repository: CloudRuntimeRepository;
    kms: CredentialEnvelopeKms;
    liveTradingEnabled: boolean;
    now?: () => number;
  }) {}

  start(): void {
    if (this.#active) return;
    this.#active = true;
    void this.#tick();
  }

  stop(): void {
    this.#active = false;
    if (this.#timer) clearTimeout(this.#timer);
  }

  async #tick(): Promise<void> {
    if (!this.#active) return;
    try {
      const now = (this.options.now ?? Date.now)();
      const runs = await this.options.repository.claimRuns(this.#owner, now);
      for (const run of runs) {
        try { await this.#evaluate(run); }
        catch { await this.options.repository.fail(run, this.#owner, "execution_failed",
          (this.options.now ?? Date.now)()).catch(() => undefined); }
      }
    } finally {
      if (this.#active) this.#timer = setTimeout(() => void this.#tick(), 10_000);
    }
  }

  async #evaluate(run: CloudRun): Promise<void> {
    if (run.mode === "live" && !this.options.liveTradingEnabled) throw new Error("Live cloud trading is disabled");
    const config = createVisualStrategyEvaluator(run.config as unknown as VisualBotConfig).config;
    if (config.market !== "futures") throw new Error("Cloud runtime currently requires futures strategies");
    const interval = parseIntervalMs(config.timeframe);
    const now = (this.options.now ?? Date.now)();
    const endTime = Math.floor(now / interval) * interval;
    const startTime = Math.max(0, endTime - interval * 300);
    const dataset = await this.#public.collectHistoricalCandles({ market: "futures", symbol: config.symbol,
      interval: config.timeframe, startTime, endTime, limit: 100 });
    const candles = dataset.candles.slice(-300);
    const latest = candles.at(-1);
    if (!latest || latest.closeTime <= (run.lastCandleAt ?? -1)) {
      await this.options.repository.release(run.id, this.#owner, (this.options.now ?? Date.now)());
      return;
    }
    const rules = await this.#public.getInstrumentRules("futures", config.symbol);
    const stored = await this.options.repository.credential(run.connectionId, run.userId);
    const credentials = await decryptWeexCredentials({ envelope: stored.envelope, context: stored.context,
      kms: this.options.kms });
    const sentAt = (this.options.now ?? Date.now)();
    const probe = await this.#transport.send({ method: "GET", url: CLOCK_PROBE_URL, headers: { Accept: "application/json" } });
    const receivedAt = (this.options.now ?? Date.now)();
    const serverTime = Date.parse(probe.headers.date ?? "");
    if (!Number.isSafeInteger(serverTime) || receivedAt < sentAt) throw new Error("WEEX clock is unavailable");
    const clock = new WeexClock(this.options.now ?? Date.now);
    clock.recordServerTime(serverTime, sentAt, receivedAt);
    const target = { market: "futures" as const, mode: run.mode };
    const client = new WeexPrivateClient({ transport: this.#transport, credentials, clock,
      rulesProvider: async (_target, symbol) => {
        if (symbol !== rules.symbol) throw new Error("Instrument mismatch");
        return { rules, verifiedAt: (this.options.now ?? Date.now)() };
      }, now: () => Math.floor(clock.now()), maximumGetAttempts: 1 });
    const verification = await client.verifyAccount(target);
    if (verification.readPermission !== true || (run.mode === "live"
      && (verification.canTrade !== true || verification.withdrawalPermission !== "absent"
        || verification.positionMode !== "hedge"))) throw new Error("WEEX account verification is unsafe");
    const account = await client.getAccountSnapshot(target);
    const positions = account.positions.filter((position) => position.symbol === config.symbol && Number(position.size) > 0);
    const position = positions[0];
    const balance = account.balances.find(({ asset }) => asset === "USDT") ?? account.balances[0];
    const equity = balance?.total ?? "0";
    if (!DECIMAL.test(equity) || Number(equity) <= 0) throw new Error("WEEX equity is unavailable");
    await this.options.repository.recordAccountSnapshot(run, this.#owner, {
      asset: balance?.asset ?? "USDT",
      observedAt: account.observedAt,
      equity,
      availableEquity: balance?.available ?? "0",
      unrealizedPnl: signed(account.positions.map(({ unrealizedPnl }) => unrealizedPnl)),
      positions: account.positions.filter(({ size }) => Number(size) > 0),
    });
    const portfolio: StrategyPortfolioSnapshot = Object.freeze({
      equity, dayStartEquity: equity, availableEquity: balance?.available,
      utcDay: new Date(account.observedAt).toISOString().slice(0, 10),
      ...(position ? { position: Object.freeze({ side: position.side, entryPrice: latest.close,
        peakPrice: latest.close, troughPrice: latest.close, quantity: position.size,
        usedMargin: position.openValue, layerCount: 1 }) } : {}),
    });
    const evaluator = createVisualStrategyEvaluator(config);
    const signal = await evaluator.evaluate({ candles, market: "futures", symbol: config.symbol,
      timeframe: config.timeframe, leverage: String(config.leverage), now: account.observedAt, portfolio });
    if (signal.action === "hold") {
      await this.options.repository.complete(run, this.#owner, latest.closeTime, signal, account.observedAt);
      return;
    }
    const clientOrderId = await deriveClientOrderId({ deploymentId: run.id,
      configurationVersion: `v${run.version}`, signalId: signal.id, sequence: latest.closeTime });
    const claim = await this.options.repository.claimOrder({ runId: run.id, candleCloseAt: latest.closeTime,
      clientOrderId, signal, now: account.observedAt });
    if (claim.status !== "claimed" && claim.status !== "unknown") {
      await this.options.repository.complete(run, this.#owner, latest.closeTime, signal, account.observedAt);
      return;
    }
    const currentNotional = position?.openValue ?? "0";
    const context: RiskContext = Object.freeze({ market: "futures", symbol: config.symbol, now: account.observedAt,
      priceTimestamp: latest.closeTime, lastSignalAt: run.lastEvaluatedAt, openPositions: account.positions.length,
      positionSide: position?.side ?? "flat", currentPositionQuantity: position?.size ?? "0",
      currentPositionNotional: currentNotional,
      totalExposure: signed(account.positions.map(({ openValue }) => openValue)),
      realizedDailyPnl: "0", unrealizedDailyPnl: signed(account.positions.map(({ unrealizedPnl }) => unrealizedPnl)),
      consecutiveFailures: 0, leverage: String(config.leverage) });
    const riskPolicy = policy(run.risk);
    const intent = await new SignalIntentNormalizer().normalize(signal, {
      deploymentId: run.id, configurationVersion: `v${run.version}`, signalSequence: latest.closeTime,
      market: "futures", mode: run.mode, referencePrice: latest.close, riskPolicy, riskContext: context,
      instrumentRules: rules, now: account.observedAt,
    });
    const decision = evaluateOrderRisk(riskPolicy, context, intent, rules);
    if (!decision.allowed) {
      await this.options.repository.recordOrder({ runId: run.id, candleCloseAt: latest.closeTime,
        status: "risk-rejected", intent, errorCode: decision.reason, now: account.observedAt });
      await this.options.repository.complete(run, this.#owner, latest.closeTime,
        { ...signal, riskRejected: decision.reason }, account.observedAt);
      return;
    }
    if (claim.status === "unknown") {
      const existing = await client.findOrderByClientOrderId({ target, symbol: config.symbol, clientOrderId,
        ...(claim.exchangeOrderId ? { exchangeOrderId: claim.exchangeOrderId } : {}) });
      if (existing) {
        await this.options.repository.recordOrder({ runId: run.id, candleCloseAt: latest.closeTime,
          status: "acknowledged", intent, exchangeOrderId: existing.exchangeOrderId, now: account.observedAt });
        await this.options.repository.complete(run, this.#owner, latest.closeTime, signal, account.observedAt);
        return;
      }
    }
    const outcome = await client.submitOrder({ target, clientOrderId, intent });
    await this.options.repository.recordOrder({ runId: run.id, candleCloseAt: latest.closeTime,
      status: outcome.status, intent, ...(outcome.status === "acknowledged" ? { exchangeOrderId: outcome.exchangeOrderId }
        : { errorCode: outcome.reason ?? outcome.status }), now: account.observedAt });
    await this.options.repository.complete(run, this.#owner, latest.closeTime, signal, account.observedAt);
  }
}
