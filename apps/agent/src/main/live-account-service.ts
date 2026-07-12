import Decimal from "decimal.js";

import type { ExecutionTarget, InstrumentRules, RiskContext, StrategyPortfolioSnapshot, StrategyPositionSnapshot } from "@cryptobot-labs/trading-core";
import {
  WeexClock,
  WeexCredentials,
  WeexPrivateClient,
  createFetchTransport,
  type HttpTransport,
  type WeexAccountSnapshot,
} from "@cryptobot-labs/weex-client";

import type { CredentialVault } from "./vault";

const CLOCK_PROBE_URL = "https://api-spot.weex.com/api/v3/market/ticker/price?symbol=BTCUSDT";
const Exact = Decimal.clone({ precision: 96 });
const DECIMAL = /^-?(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;

export interface LiveAccountEvidence {
  readonly observedAt: number;
  readonly portfolio: Readonly<StrategyPortfolioSnapshot>;
  readonly risk: Readonly<RiskContext>;
}

export interface LiveAccountServiceOptions {
  readonly vault: Pick<CredentialVault, "withCredentials">;
  readonly transport?: HttpTransport;
  readonly now?: () => number;
}

function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

function amount(value: string, label: string): Decimal {
  if (typeof value !== "string" || !DECIMAL.test(value)) throw new Error(`Invalid ${label}`);
  const parsed = new Exact(value);
  if (!parsed.isFinite()) throw new Error(`Invalid ${label}`);
  return parsed;
}

function unsigned(value: string, label: string): Decimal {
  const parsed = amount(value, label);
  if (parsed.isNegative()) throw new Error(`Invalid ${label}`);
  return parsed;
}

function validateProbe(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("WEEX clock probe returned invalid data");
  const value = body as Record<string, unknown>;
  if (value.symbol !== "BTCUSDT" || typeof value.price !== "string" || !DECIMAL.test(value.price)
    || !amount(value.price, "clock probe price").isPositive()) throw new Error("WEEX clock probe returned invalid data");
}

function balance(snapshot: WeexAccountSnapshot, asset: string) {
  const matches = snapshot.balances.filter((item) => item.asset === asset);
  if (matches.length !== 1) throw new Error(`WEEX account requires exactly one ${asset} balance`);
  return matches[0]!;
}

function exactTarget(target: ExecutionTarget): asserts target is { market: "spot" | "futures"; mode: "live" } {
  if (!target || target.mode !== "live" || (target.market !== "spot" && target.market !== "futures")) {
    throw new Error("Live account evidence requires a live WEEX target");
  }
}

function validateLocalPosition(position: Readonly<StrategyPositionSnapshot> | undefined): void {
  if (position === undefined) return;
  if ((position.side !== "long" && position.side !== "short")
    || !unsigned(position.quantity, "local position quantity").isPositive()
    || !unsigned(position.entryPrice, "local entry price").isPositive()
    || !unsigned(position.peakPrice, "local peak price").isPositive()
    || !unsigned(position.troughPrice, "local trough price").isPositive()
    || unsigned(position.usedMargin, "local used margin").isNegative()
    || !Number.isSafeInteger(position.layerCount) || position.layerCount < 1) {
    throw new Error("Invalid local position evidence");
  }
}

/** Collects credential-isolated WEEX account evidence and normalizes it for the trusted risk engine. */
export function createLiveAccountService(options: LiveAccountServiceOptions) {
  const transport = options.transport ?? createFetchTransport({ timeoutMs: 10_000 });
  const now = options.now ?? Date.now;
  return Object.freeze({
    async collect(input: {
      readonly target: ExecutionTarget;
      readonly rules: Readonly<InstrumentRules>;
      readonly referencePrice: string;
      readonly priceTimestamp: number;
      readonly configuredLeverage: string;
      readonly local: Readonly<{ lastSignalAt: number | null; realizedDailyPnl: string; consecutiveFailures: number;
        dayStartEquity: string; position?: Readonly<StrategyPositionSnapshot> }>;
    }): Promise<LiveAccountEvidence> {
      exactTarget(input.target);
      if (input.rules.market !== input.target.market || !input.rules.symbol || !input.rules.baseAsset || !input.rules.quoteAsset) {
        throw new Error("Instrument rules do not match the live account target");
      }
      const referencePrice = unsigned(input.referencePrice, "reference price");
      if (!referencePrice.isPositive()) throw new Error("Invalid reference price");
      const configuredLeverage = unsigned(input.configuredLeverage, "configured leverage");
      if (!configuredLeverage.isPositive()) throw new Error("Invalid configured leverage");
      timestamp(input.priceTimestamp, "reference price timestamp");
      if ((input.local.lastSignalAt !== null && (!Number.isSafeInteger(input.local.lastSignalAt) || input.local.lastSignalAt < 0))
        || !Number.isSafeInteger(input.local.consecutiveFailures) || input.local.consecutiveFailures < 0) {
        throw new Error("Invalid local live risk evidence");
      }
      const realizedDailyPnl = amount(input.local.realizedDailyPnl, "realized daily PnL");
      const dayStartEquity = unsigned(input.local.dayStartEquity, "day-start equity");
      if (!dayStartEquity.isPositive()) throw new Error("Invalid day-start equity");
      validateLocalPosition(input.local.position);
      const clock = new WeexClock(now);
      const sentAt = timestamp(now(), "clock probe start");
      const probe = await transport.send({ method: "GET", url: CLOCK_PROBE_URL, headers: {} });
      const receivedAt = timestamp(now(), "clock probe completion");
      validateProbe(probe.body);
      const serverTime = typeof probe.headers.date === "string" ? Date.parse(probe.headers.date) : NaN;
      if (!Number.isSafeInteger(serverTime) || serverTime < 0) throw new Error("WEEX server time evidence is unavailable");
      clock.recordServerTime(serverTime, sentAt, receivedAt);

      return options.vault.withCredentials(async (stored) => {
        const client = new WeexPrivateClient({ transport,
          credentials: new WeexCredentials(stored.apiKey, stored.secretKey, stored.passphrase), clock,
          now: () => Math.floor(clock.now()) });
        const verified = await client.verifyAccount(input.target);
        if (verified.canTrade !== true || verified.withdrawalPermission !== "absent"
          || (input.target.market === "futures" && verified.positionMode !== "hedge")) {
          throw new Error("WEEX account permissions are unsafe for live evidence");
        }
        const snapshot = await client.getAccountSnapshot(input.target);
        if (input.priceTimestamp > snapshot.observedAt) throw new Error("Reference price is newer than account evidence");
        if (input.local.lastSignalAt !== null && input.local.lastSignalAt > snapshot.observedAt) {
          throw new Error("Local signal evidence is newer than account evidence");
        }
        const quote = balance(snapshot, input.rules.quoteAsset);
        let equity: Decimal;
        let availableEquity: Decimal;
        let positionSide: RiskContext["positionSide"] = "flat";
        let positionQuantity = new Exact(0);
        let positionNotional = new Exact(0);
        let totalExposure = new Exact(0);
        let unrealizedDailyPnl = new Exact(0);
        let openPositions = 0;
        let position: StrategyPortfolioSnapshot["position"];

        if (input.target.market === "spot") {
          const base = balance(snapshot, input.rules.baseAsset);
          positionQuantity = unsigned(base.total, "spot base balance");
          positionNotional = positionQuantity.mul(referencePrice);
          totalExposure = positionNotional;
          const minimum = unsigned(input.rules.minimumQuantity, "minimum position quantity");
          openPositions = positionQuantity.gte(minimum) ? 1 : 0;
          positionSide = openPositions ? "long" : "flat";
          equity = unsigned(quote.total, "spot quote balance").add(positionNotional);
          availableEquity = unsigned(quote.available, "spot available quote balance");
          if (openPositions) {
            if (!input.local.position || input.local.position.side !== "long"
              || !unsigned(input.local.position.quantity, "local position quantity").eq(positionQuantity)) {
              throw new Error("WEEX spot position is not owned by the active deployment");
            }
            position = Object.freeze({ ...input.local.position, usedMargin: positionNotional.toFixed() });
          } else if (input.local.position) throw new Error("Local position does not exist on WEEX");
        } else {
          const positions = snapshot.positions;
          openPositions = positions.length;
          totalExposure = positions.reduce((total, item) => total.add(unsigned(item.openValue, "position open value")), new Exact(0));
          unrealizedDailyPnl = positions.reduce((total, item) => total.add(amount(item.unrealizedPnl, "position unrealized PnL")), new Exact(0));
          const matches = positions.filter((item) => item.symbol === input.rules.symbol);
          if (matches.length > 1) throw new Error("Multiple WEEX positions for one strategy symbol are not supported");
          const current = matches[0];
          if (current) {
            if (!configuredLeverage.eq(unsigned(current.leverage, "position leverage"))) {
              throw new Error("WEEX position leverage does not match the deployment");
            }
            positionSide = current.side;
            positionQuantity = unsigned(current.size, "position size");
            positionNotional = unsigned(current.openValue, "position open value");
            if (!input.local.position || input.local.position.side !== current.side
              || !unsigned(input.local.position.quantity, "local position quantity").eq(positionQuantity)) {
              throw new Error("WEEX futures position is not owned by the active deployment");
            }
            position = Object.freeze({ ...input.local.position, usedMargin: positionNotional.div(configuredLeverage).toFixed() });
          } else if (input.local.position) throw new Error("Local position does not exist on WEEX");
          equity = unsigned(quote.total, "futures account balance").add(amount(quote.unrealizedPnl, "futures balance unrealized PnL"));
          availableEquity = unsigned(quote.available, "futures available balance");
        }

        const utcDay = new Date(snapshot.observedAt).toISOString().slice(0, 10);
        const portfolio = Object.freeze({ equity: equity.toFixed(), availableEquity: availableEquity.toFixed(),
          dayStartEquity: dayStartEquity.toFixed(), utcDay, ...(position ? { position } : {}) });
        const risk = Object.freeze({ market: input.target.market, symbol: input.rules.symbol, now: snapshot.observedAt,
          priceTimestamp: input.priceTimestamp, lastSignalAt: input.local.lastSignalAt, openPositions, positionSide,
          currentPositionQuantity: positionQuantity.toFixed(), currentPositionNotional: positionNotional.toFixed(),
          totalExposure: totalExposure.toFixed(), realizedDailyPnl: realizedDailyPnl.toFixed(),
          unrealizedDailyPnl: unrealizedDailyPnl.toFixed(), consecutiveFailures: input.local.consecutiveFailures,
          leverage: configuredLeverage.toFixed() }) satisfies Readonly<RiskContext>;
        return Object.freeze({ observedAt: snapshot.observedAt, portfolio, risk });
      });
    },
  });
}
