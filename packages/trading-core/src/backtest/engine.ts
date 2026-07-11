import Decimal from "decimal.js";

import type { Candle, StrategySignal } from "../contracts";
import { CandleSchema, StrategySignalSchema } from "../schemas";
import { adverseFill, decimal, decimalString, positionPnl, unrealizedPnl } from "./accounting";
import { calculateMetrics } from "./metrics";
import { datasetDigest } from "./provenance";
import type {
  EquityPoint,
  FundingEvent,
  HistoricalBacktestRequest,
  HistoricalBacktestResult,
  HistoricalTrade,
  PositionSide,
  SignalEvent,
  TradeExitReason,
} from "./types";

interface Position {
  side: PositionSide;
  entryTime: number;
  entryPrice: Decimal;
  quantity: Decimal;
  entryFee: Decimal;
  funding: Decimal;
  peakPrice: Decimal;
  troughPrice: Decimal;
}

interface PendingSignal {
  signal: StrategySignal;
  event: SignalEvent;
}

const UNSIGNED_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_ECMASCRIPT_TIMESTAMP = 8_640_000_000_000_000;

function numeric(value: string, label: string, options: { positive?: boolean; belowOne?: boolean; signed?: boolean } = {}): Decimal {
  const pattern = options.signed ? SIGNED_DECIMAL : UNSIGNED_DECIMAL;
  if (!pattern.test(value)) throw new TypeError(`${label} must be a plain decimal string`);
  const parsed = decimal(value);
  if (options.positive ? parsed.lte(0) : !options.signed && parsed.lt(0)) {
    throw new RangeError(`${label} is outside its allowed range`);
  }
  if (options.belowOne && parsed.gte(1)) throw new RangeError(`${label} must be less than one`);
  return parsed;
}

function validateFunding(events: readonly FundingEvent[], market: "spot" | "futures"): FundingEvent[] {
  if (!Array.isArray(events)) throw new TypeError("funding must be an array");
  if (market === "spot" && events.length > 0) throw new TypeError("funding is only valid for futures");
  return events.map((event) => {
    if (!Number.isSafeInteger(event.timestamp) || event.timestamp < 0) throw new TypeError("Invalid funding timestamp");
    numeric(event.rate, "funding rate", { signed: true });
    if (typeof event.markPrice !== "string") throw new TypeError("Funding mark price is required");
    numeric(event.markPrice, "funding mark price", { positive: true });
    return { ...event };
  }).sort((left, right) => left.timestamp - right.timestamp);
}

function validateAndCopy(request: HistoricalBacktestRequest): {
  candles: ReadonlyArray<Readonly<Candle>>;
  gaps: Array<{ from: number; to: number }>;
  duplicateCount: number;
  incompleteCount: number;
  funding: FundingEvent[];
} {
  if (!request || typeof request !== "object") throw new TypeError("Backtest request is required");
  const { dataset } = request;
  if (!dataset || typeof dataset !== "object" || !Array.isArray(dataset.candles)) throw new TypeError("Historical dataset is required");
  if (dataset.request.market !== "spot" && dataset.request.market !== "futures") throw new TypeError("Invalid market");
  if (!dataset.request.symbol || !dataset.request.interval) throw new TypeError("Dataset symbol and interval are required");
  if (!Number.isSafeInteger(dataset.intervalMs) || dataset.intervalMs <= 0) throw new TypeError("Invalid dataset interval");
  if (dataset.provenance.sourceKind !== "public-api" || !dataset.provenance.provider) throw new TypeError("Invalid dataset provenance");
  if (!dataset.validation || typeof dataset.validation !== "object" ||
      !Array.isArray(dataset.validation.duplicates) || !Array.isArray(dataset.validation.gaps) ||
      typeof dataset.validation.ordered !== "boolean" ||
      !Number.isSafeInteger(dataset.validation.incompleteCount) || dataset.validation.incompleteCount < 0) {
    throw new TypeError("Invalid dataset validation summary");
  }
  if (typeof request.evaluator?.evaluate !== "function") throw new TypeError("Strategy evaluator is required");
  for (const field of ["engineVersion", "configHash", "strategyHash"] as const) {
    if (typeof request[field] !== "string" || !request[field]) throw new TypeError(`${field} is required`);
  }
  if (request.gapPolicy !== "fail" && request.gapPolicy !== "disclose") throw new TypeError("Invalid gap policy");

  numeric(request.initialCapital, "initialCapital", { positive: true });
  numeric(request.feeRate, "feeRate", { belowOne: true });
  numeric(request.slippageRate, "slippageRate", { belowOne: true });
  const leverage = numeric(request.leverage, "leverage", { positive: true });
  if (dataset.request.market === "spot" && !leverage.eq(1)) throw new RangeError("Spot leverage must be one");
  if (leverage.times(request.feeRate).gte(1)) {
    throw new RangeError("Leverage and fee rate would consume all usable equity");
  }

  if (dataset.candles.length < 2) throw new RangeError("Historical backtests require at least two completed candles");
  for (const candle of dataset.candles) {
    if (!Number.isSafeInteger(candle.openTime) || !Number.isSafeInteger(candle.closeTime) ||
        candle.openTime < 0 || candle.closeTime <= candle.openTime || candle.closeTime > MAX_ECMASCRIPT_TIMESTAMP) {
      throw new TypeError("Invalid candle timestamp");
    }
    if (candle.closeTime - candle.openTime !== dataset.intervalMs - 1) {
      throw new TypeError("Candle duration must exactly match intervalMs");
    }
  }
  const parsed = dataset.candles.map((candle) => CandleSchema.parse(candle));
  const incompleteCount = parsed.filter((candle) => !candle.complete).length;
  if (incompleteCount > 0) throw new TypeError("Historical backtests require complete candles");

  const declaredDuplicates = new Set<number>();
  for (const timestamp of dataset.validation.duplicates) {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("Invalid duplicate timestamp");
    declaredDuplicates.add(timestamp);
  }
  const declaredGaps = dataset.validation.gaps.map((gap) => {
    if (!Number.isSafeInteger(gap.from) || !Number.isSafeInteger(gap.to) || gap.from < 0 || gap.to < gap.from) {
      throw new TypeError("Invalid declared candle gap");
    }
    return { from: gap.from, to: gap.to };
  });

  const seen = new Set<number>();
  let actualDuplicateCount = 0;
  const computedGaps: Array<{ from: number; to: number }> = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const candle = parsed[index]!;
    if (seen.has(candle.openTime)) actualDuplicateCount += 1;
    seen.add(candle.openTime);
    if (index > 0) {
      const previous = parsed[index - 1]!;
      if (candle.openTime <= previous.openTime) throw new TypeError("Candles must be strictly ordered");
      if (previous.closeTime >= candle.openTime) throw new TypeError("Candles must not overlap");
      if (candle.openTime > previous.openTime + dataset.intervalMs) {
        computedGaps.push({ from: previous.openTime + dataset.intervalMs, to: candle.openTime - 1 });
      }
    }
  }
  if (actualDuplicateCount > 0) throw new TypeError("Duplicate candle timestamps are not supported");
  const gapByRange = new Map<string, { from: number; to: number }>();
  for (const gap of [...declaredGaps, ...computedGaps]) gapByRange.set(`${gap.from}:${gap.to}`, gap);
  const gaps = [...gapByRange.values()].sort((left, right) => left.from - right.from || left.to - right.to);
  if (gaps.length > 0 && request.gapPolicy === "fail") throw new TypeError("Historical dataset contains candle gaps");

  return {
    candles: parsed.map((candle) => Object.freeze({ ...candle })),
    gaps,
    duplicateCount: declaredDuplicates.size,
    incompleteCount: Math.max(incompleteCount, dataset.validation.incompleteCount),
    funding: validateFunding(request.funding, dataset.request.market),
  };
}

export async function runHistoricalBacktest(
  request: HistoricalBacktestRequest,
): Promise<HistoricalBacktestResult> {
  const validated = validateAndCopy(request);
  const { dataset } = request;
  const market = dataset.request.market;
  const feeRate = decimal(request.feeRate);
  const slippageRate = decimal(request.slippageRate);
  const leverage = decimal(request.leverage);
  const initialCapital = decimal(request.initialCapital);
  let balance = initialCapital;
  let position: Position | undefined;
  let pending: PendingSignal | undefined;
  let fundingCursor = 0;
  let appliedFundingEvents = 0;
  let netFunding = decimal(0);
  const trades: HistoricalTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const signalEvents: SignalEvent[] = [];

  function closePosition(referencePrice: string, timestamp: number, reason: TradeExitReason): void {
    if (!position) return;
    const orderSide = position.side === "long" ? "sell" : "buy";
    const exitPrice = adverseFill(referencePrice, orderSide, slippageRate);
    const exitFee = exitPrice.times(position.quantity).times(feeRate);
    const grossPnl = positionPnl(position.side, position.entryPrice, exitPrice, position.quantity);
    balance = balance.plus(grossPnl).minus(exitFee);
    const fees = position.entryFee.plus(exitFee);
    const realizedPnl = grossPnl.minus(fees).plus(position.funding);
    trades.push({
      side: position.side,
      entryTime: position.entryTime,
      exitTime: timestamp,
      entryPrice: decimalString(position.entryPrice),
      exitPrice: decimalString(exitPrice),
      quantity: decimalString(position.quantity),
      entryFee: decimalString(position.entryFee),
      exitFee: decimalString(exitFee),
      fees: decimalString(fees),
      funding: decimalString(position.funding),
      realizedPnl: decimalString(realizedPnl),
      exitReason: reason,
    });
    position = undefined;
  }

  function openPosition(side: PositionSide, referencePrice: string, timestamp: number, allocationRate = 1): void {
    const orderSide = side === "long" ? "buy" : "sell";
    const entryPrice = adverseFill(referencePrice, orderSide, slippageRate);
    // Allocate all usable equity while reserving the entry fee (and futures margin).
    const marginRate = market === "futures" ? decimal(1).div(leverage) : decimal(1);
    const notional = balance.times(allocationRate).div(marginRate.plus(feeRate));
    const quantity = notional.div(entryPrice);
    const entryFee = notional.times(feeRate);
    balance = balance.minus(entryFee);
    position = {
      side,
      entryTime: timestamp,
      entryPrice,
      quantity,
      entryFee,
      funding: decimal(0),
      peakPrice: entryPrice,
      troughPrice: entryPrice,
    };
  }

  function executePending(candle: Readonly<Candle>): void {
    if (!pending) return;
    const { signal, event } = pending;
    pending = undefined;
    event.executionTime = candle.openTime;
    if (!position) {
      if (signal.action === "buy") {
        if (balance.lte(0)) {
          event.status = "rejected";
          event.effect = "none";
          event.reason = "nonpositive-equity";
        } else {
          openPosition("long", candle.open, candle.openTime, signal.allocationRate);
          event.effect = "opened";
        }
      } else if (signal.action === "sell" && market === "futures") {
        if (balance.lte(0)) {
          event.status = "rejected";
          event.effect = "none";
          event.reason = "nonpositive-equity";
        } else {
          openPosition("short", candle.open, candle.openTime, signal.allocationRate);
          event.effect = "opened";
        }
      } else {
        event.status = "rejected";
        event.effect = "none";
        event.reason = signal.action === "sell" ? "spot-short-not-supported" : "no-position-to-close";
      }
      return;
    }

    const opposite = (position.side === "long" && signal.action === "sell") ||
      (position.side === "short" && signal.action === "buy");
    if (signal.action === "close" || opposite) {
      closePosition(candle.open, candle.openTime, opposite ? "opposite-signal" : "signal");
      event.effect = "closed";
    } else {
      event.status = "rejected";
      event.effect = "none";
      event.reason = "position-already-open";
    }
  }

  let utcDay = "";
  let dayStartEquity = initialCapital;
  for (let index = 0; index < validated.candles.length; index += 1) {
    const candle = validated.candles[index]!;
    const currentUtcDay = new Date(candle.closeTime).toISOString().slice(0, 10);
    if (currentUtcDay !== utcDay) {
      utcDay = currentUtcDay;
      dayStartEquity = equityCurve.length === 0
        ? initialCapital
        : decimal(equityCurve.at(-1)!.equity);
    }
    executePending(candle);

    if (position) {
      position.peakPrice = Decimal.max(position.peakPrice, candle.high);
      position.troughPrice = Decimal.min(position.troughPrice, candle.low);
    }

    let periodFunding = decimal(0);
    while (fundingCursor < validated.funding.length && validated.funding[fundingCursor]!.timestamp <= candle.closeTime) {
      const event = validated.funding[fundingCursor]!;
      fundingCursor += 1;
      if (!position || event.timestamp < position.entryTime) continue;
      const markPrice = decimal(event.markPrice);
      const payment = position.quantity.times(markPrice).times(event.rate);
      const adjustment = position.side === "long" ? payment.negated() : payment;
      balance = balance.plus(adjustment);
      position.funding = position.funding.plus(adjustment);
      periodFunding = periodFunding.plus(adjustment);
      netFunding = netFunding.plus(adjustment);
      appliedFundingEvents += 1;
    }

    const equity = position
      ? balance.plus(unrealizedPnl(position.side, position.entryPrice, candle.close, position.quantity))
      : balance;
    equityCurve.push({ timestamp: candle.closeTime, equity: decimalString(equity), funding: decimalString(periodFunding) });

    const evaluatedAt = candle.closeTime;
    let signal: StrategySignal;
    try {
      const inputCandles = Object.freeze(validated.candles.slice(0, index + 1));
      const candidate = await request.evaluator.evaluate(Object.freeze({
        candles: inputCandles,
        market,
        symbol: dataset.request.symbol,
        now: evaluatedAt,
        timeframe: dataset.request.interval,
        portfolio: Object.freeze({
          equity: decimalString(equity),
          dayStartEquity: decimalString(dayStartEquity),
          utcDay,
          ...(position ? {
            position: Object.freeze({
              side: position.side,
              entryPrice: decimalString(position.entryPrice),
              peakPrice: decimalString(position.peakPrice),
              troughPrice: decimalString(position.troughPrice),
              quantity: decimalString(position.quantity),
            }),
          } : {}),
        }),
      }));
      const parsed = StrategySignalSchema.safeParse(candidate);
      if (!parsed.success) {
        signalEvents.push({ signalId: `invalid-${index + 1}`, evaluatedAt, status: "rejected", effect: "none", reason: "invalid-signal" });
        continue;
      }
      signal = parsed.data;
    } catch {
      signalEvents.push({ signalId: `error-${index + 1}`, evaluatedAt, status: "rejected", effect: "none", reason: "evaluator-error" });
      continue;
    }

    const event: SignalEvent = {
      signalId: signal.id,
      action: signal.action,
      evaluatedAt,
      status: "accepted",
      effect: signal.action === "hold" ? "held" : "queued",
      reason: signal.reason,
    };
    signalEvents.push(event);
    if (market === "spot" && signal.action === "sell" && !position) {
      event.status = "rejected";
      event.effect = "none";
      event.reason = "spot-short-not-supported";
    } else if (signal.action !== "hold") {
      pending = { signal, event };
    }
  }

  if (pending) {
    pending.event.effect = "ignored-end-of-data";
    pending = undefined;
  }

  const finalCandle = validated.candles.at(-1)!;
  if (position) {
    closePosition(finalCandle.close, finalCandle.closeTime, "end-of-data");
    equityCurve[equityCurve.length - 1] = {
      ...equityCurve[equityCurve.length - 1]!,
      equity: decimalString(balance),
    };
  }

  const digest = await datasetDigest({ ...dataset, candles: validated.candles });
  const firstCandle = validated.candles[0]!;
  const provenanceComplete = dataset.complete && validated.gaps.length === 0 &&
    validated.duplicateCount === 0 && validated.incompleteCount === 0 && dataset.validation.ordered &&
    !dataset.provenance.truncated;

  return {
    trades,
    equityCurve,
    signalEvents,
    metrics: calculateMetrics(request.initialCapital, equityCurve, trades, dataset.intervalMs),
    provenance: {
      provider: dataset.provenance.provider,
      dataSource: dataset.provenance.provider,
      sourceKind: dataset.provenance.sourceKind,
      requestedRange: {
        ...(dataset.request.startTime === undefined ? {} : { startTime: dataset.request.startTime }),
        ...(dataset.request.endTime === undefined ? {} : { endTime: dataset.request.endTime }),
      },
      fetchedRange: { startTime: firstCandle.openTime, endTime: finalCandle.closeTime },
      gaps: validated.gaps,
      gapCount: validated.gaps.length,
      duplicateCount: validated.duplicateCount,
      incompleteCount: validated.incompleteCount,
      complete: provenanceComplete,
      feeRate: decimalString(feeRate),
      slippageRate: decimalString(slippageRate),
      fundingTreatment: {
        convention: "long-pays-positive-short-receives-positive",
        suppliedEvents: validated.funding.length,
        appliedEvents: appliedFundingEvents,
        netFunding: decimalString(netFunding),
      },
      market,
      symbol: dataset.request.symbol,
      interval: dataset.request.interval,
      engineVersion: request.engineVersion,
      configHash: request.configHash,
      strategyHash: request.strategyHash,
      datasetDigest: digest,
    },
  };
}
