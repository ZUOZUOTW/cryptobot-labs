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
  usedMargin: Decimal;
  layerCount: number;
}

interface PendingSignal {
  signal: StrategySignal;
  event: SignalEvent;
}

const UNSIGNED_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_ECMASCRIPT_TIMESTAMP = 8_640_000_000_000_000;
export const MAX_HISTORICAL_CANDLES = 10_000;
export const MAX_DECIMAL_STRING_LENGTH = 128;
export const MAX_HISTORICAL_FUNDING_EVENTS = MAX_HISTORICAL_CANDLES * 4;
export const MAX_VALIDATION_ENTRIES = MAX_HISTORICAL_CANDLES;
export const MAX_HISTORICAL_LEVERAGE = 10;
const DEFAULT_MAINTENANCE_MARGIN_RATE = "0.02";

function numeric(value: string, label: string, options: { positive?: boolean; belowOne?: boolean; signed?: boolean } = {}): Decimal {
  const pattern = options.signed ? SIGNED_DECIMAL : UNSIGNED_DECIMAL;
  if (typeof value !== "string" || value.length > MAX_DECIMAL_STRING_LENGTH || !pattern.test(value)) {
    throw new TypeError(`${label} must be a bounded plain decimal string`);
  }
  const parsed = decimal(value);
  if (options.positive ? parsed.lte(0) : !options.signed && parsed.lt(0)) {
    throw new RangeError(`${label} is outside its allowed range`);
  }
  if (options.belowOne && parsed.gte(1)) throw new RangeError(`${label} must be less than one`);
  return parsed;
}

function validateFunding(events: readonly FundingEvent[], market: "spot" | "futures"): FundingEvent[] {
  if (!Array.isArray(events)) throw new TypeError("funding must be an array");
  if (events.length > MAX_HISTORICAL_FUNDING_EVENTS) throw new RangeError("Too many funding events");
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
  if (dataset.request.market === "spot") {
    if (request.maintenanceMarginRate !== undefined && !numeric(request.maintenanceMarginRate, "maintenanceMarginRate").eq(0)) {
      throw new RangeError("Spot maintenanceMarginRate must be zero or omitted");
    }
  } else {
    numeric(request.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE, "maintenanceMarginRate", { positive: true, belowOne: true });
  }
  if (leverage.times(request.feeRate).gte(1)) {
    throw new RangeError("Leverage and fee rate would consume all usable equity");
  }
  if (leverage.gt(MAX_HISTORICAL_LEVERAGE)) throw new RangeError(`Historical leverage must not exceed ${MAX_HISTORICAL_LEVERAGE}`);

  if (dataset.candles.length < 2) throw new RangeError("Historical backtests require at least two completed candles");
  if (dataset.candles.length > MAX_HISTORICAL_CANDLES) throw new RangeError(`Historical backtests support at most ${MAX_HISTORICAL_CANDLES} candles`);
  if (Array.isArray(request.funding) && request.funding.length > dataset.candles.length * 4) {
    throw new RangeError("Funding events are oversized for the candle dataset");
  }
  if (dataset.validation.duplicates.length > MAX_VALIDATION_ENTRIES || dataset.validation.gaps.length > MAX_VALIDATION_ENTRIES ||
      dataset.validation.duplicates.length > dataset.candles.length || dataset.validation.gaps.length > dataset.candles.length) {
    throw new RangeError("Historical validation metadata is oversized");
  }
  for (const candle of dataset.candles) {
    if (!Number.isSafeInteger(candle.openTime) || !Number.isSafeInteger(candle.closeTime) ||
        candle.openTime < 0 || candle.closeTime <= candle.openTime || candle.closeTime > MAX_ECMASCRIPT_TIMESTAMP) {
      throw new TypeError("Invalid candle timestamp");
    }
    if (candle.closeTime - candle.openTime !== dataset.intervalMs - 1) {
      throw new TypeError("Candle duration must exactly match intervalMs");
    }
    for (const field of ["open", "high", "low", "close", "volume"] as const) {
      if (typeof candle[field] !== "string" || candle[field].length > MAX_DECIMAL_STRING_LENGTH) {
        throw new TypeError(`Candle ${field} exceeds the decimal string limit`);
      }
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
  const maintenanceMarginRate = market === "futures"
    ? decimal(request.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE)
    : decimal(0);
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

  function reducePosition(referencePrice: string, timestamp: number, reason: TradeExitReason, requestedRate = 1): void {
    if (!position) return;
    const rate = Decimal.min(1, Decimal.max(0, requestedRate));
    const quantity = position.quantity.times(rate);
    if (quantity.lte(0)) return;
    const orderSide = position.side === "long" ? "sell" : "buy";
    const exitPrice = adverseFill(referencePrice, orderSide, slippageRate);
    const exitFee = exitPrice.times(quantity).times(feeRate);
    const grossPnl = positionPnl(position.side, position.entryPrice, exitPrice, quantity);
    balance = balance.plus(grossPnl).minus(exitFee);
    const entryFee = position.entryFee.times(rate);
    const funding = position.funding.times(rate);
    const fees = entryFee.plus(exitFee);
    const realizedPnl = grossPnl.minus(fees).plus(funding);
    trades.push({
      side: position.side,
      entryTime: position.entryTime,
      exitTime: timestamp,
      entryPrice: decimalString(position.entryPrice),
      exitPrice: decimalString(exitPrice),
      quantity: decimalString(quantity),
      entryFee: decimalString(entryFee),
      exitFee: decimalString(exitFee),
      fees: decimalString(fees),
      funding: decimalString(funding),
      realizedPnl: decimalString(realizedPnl),
      exitReason: reason,
    });
    if (rate.eq(1)) {
      position = undefined;
    } else {
      position.quantity = position.quantity.minus(quantity);
      position.entryFee = position.entryFee.minus(entryFee);
      position.funding = position.funding.minus(funding);
      position.usedMargin = position.usedMargin.times(decimal(1).minus(rate));
      position.layerCount = Math.max(1, position.layerCount - 1);
    }
  }

  function closePosition(referencePrice: string, timestamp: number, reason: TradeExitReason): void {
    reducePosition(referencePrice, timestamp, reason, 1);
  }

  function liquidateIfRequired(markPrice: string, timestamp: number): boolean {
    if (market !== "futures" || !position) return false;
    const mark = decimal(markPrice);
    const marginBalance = balance.plus(unrealizedPnl(position.side, position.entryPrice, mark, position.quantity));
    const maintenance = position.quantity.times(mark).times(maintenanceMarginRate);
    if (marginBalance.gt(maintenance)) return false;
    closePosition(markPrice, timestamp, "liquidation");
    balance = Decimal.max(0, balance);
    return true;
  }

  function addPosition(side: PositionSide, referencePrice: string, timestamp: number, allocationRate = 1): boolean {
    const orderSide = side === "long" ? "buy" : "sell";
    const entryPrice = adverseFill(referencePrice, orderSide, slippageRate);
    const marginRate = market === "futures" ? decimal(1).div(leverage) : decimal(1);
    const accountEquity = position
      ? balance.plus(unrealizedPnl(position.side, position.entryPrice, referencePrice, position.quantity))
      : balance;
    const accountBase = market === "spot" ? balance : accountEquity;
    const available = Decimal.max(0, accountBase.minus(position?.usedMargin ?? 0));
    const trancheBudget = Decimal.min(available, Decimal.max(0, accountBase).times(allocationRate));
    const notional = trancheBudget.div(marginRate.plus(feeRate));
    if (notional.lte(0)) return false;
    const quantity = notional.div(entryPrice);
    const entryFee = notional.times(feeRate);
    const usedMargin = notional.times(marginRate);
    balance = balance.minus(entryFee);
    if (!position) {
      position = {
        side, entryTime: timestamp, entryPrice, quantity, entryFee, funding: decimal(0),
        peakPrice: entryPrice, troughPrice: entryPrice, usedMargin, layerCount: 1,
      };
    } else {
      const priorQuantity = position.quantity;
      const totalQuantity = priorQuantity.plus(quantity);
      position.entryPrice = position.entryPrice.times(priorQuantity).plus(entryPrice.times(quantity)).div(totalQuantity);
      position.quantity = totalQuantity;
      position.entryFee = position.entryFee.plus(entryFee);
      position.usedMargin = position.usedMargin.plus(usedMargin);
      position.peakPrice = Decimal.max(position.peakPrice, entryPrice);
      position.troughPrice = Decimal.min(position.troughPrice, entryPrice);
      position.layerCount += 1;
    }
    return true;
  }

  function executePending(candle: Readonly<Candle>): void {
    if (!pending) return;
    const { signal, event } = pending;
    pending = undefined;
    event.executionTime = candle.openTime;
    if (!position) {
      if (signal.positionEffect === "reduce") {
        event.status = "rejected";
        event.effect = "none";
        event.reason = "no-position-to-reduce";
      } else if (signal.action === "buy") {
        if (balance.lte(0)) {
          event.status = "rejected";
          event.effect = "none";
          event.reason = "nonpositive-equity";
        } else {
          event.effect = addPosition("long", candle.open, candle.openTime, signal.allocationRate) ? "opened" : "none";
          if (event.effect === "none") { event.status = "rejected"; event.reason = "insufficient-available-equity"; }
        }
      } else if (signal.action === "sell" && market === "futures") {
        if (balance.lte(0)) {
          event.status = "rejected";
          event.effect = "none";
          event.reason = "nonpositive-equity";
        } else {
          event.effect = addPosition("short", candle.open, candle.openTime, signal.allocationRate) ? "opened" : "none";
          if (event.effect === "none") { event.status = "rejected"; event.reason = "insufficient-available-equity"; }
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
    const sameDirection = (position.side === "long" && signal.action === "buy") ||
      (position.side === "short" && signal.action === "sell");
    const incoherent = (sameDirection && signal.positionEffect === "reduce") ||
      (opposite && signal.positionEffect === "add") ||
      (signal.positionEffect !== undefined && !sameDirection && !opposite);
    if (incoherent) {
      event.status = "rejected";
      event.effect = "none";
      event.reason = "incoherent-position-effect";
    } else if (sameDirection && signal.positionEffect === "add") {
      event.effect = addPosition(position.side, candle.open, candle.openTime, signal.allocationRate) ? "added" : "none";
      if (event.effect === "none") {
        event.status = "rejected";
        event.reason = "insufficient-available-equity";
      }
    } else if (opposite && signal.positionEffect === "reduce") {
      const fullyClosed = (signal.reductionRate ?? 1) === 1;
      reducePosition(candle.open, candle.openTime, fullyClosed ? "signal" : "partial-reduction", signal.reductionRate);
      event.effect = fullyClosed ? "closed" : "reduced";
    } else if (signal.action === "close" || opposite) {
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
  let dailyLossBreached = false;
  const maximumDailyLossRate = request.evaluator.riskPolicy?.maximumDailyLossRate;
  const maximumLookback = request.evaluator.maximumLookback;
  if (maximumLookback !== undefined && (!Number.isSafeInteger(maximumLookback) || maximumLookback < 2 || maximumLookback > MAX_HISTORICAL_CANDLES)) {
    throw new TypeError("Evaluator maximumLookback is invalid");
  }
  if (maximumDailyLossRate !== undefined && (!Number.isFinite(maximumDailyLossRate) || maximumDailyLossRate <= 0 || maximumDailyLossRate > 1)) {
    throw new TypeError("Evaluator maximumDailyLossRate is invalid");
  }
  for (let index = 0; index < validated.candles.length; index += 1) {
    const candle = validated.candles[index]!;
    const currentUtcDay = new Date(candle.closeTime).toISOString().slice(0, 10);
    if (currentUtcDay !== utcDay) {
      utcDay = currentUtcDay;
      dayStartEquity = equityCurve.length === 0
        ? initialCapital
        : decimal(equityCurve.at(-1)!.equity);
      dailyLossBreached = false;
    }
    executePending(candle);

    if (position) {
      position.peakPrice = Decimal.max(position.peakPrice, candle.high);
      position.troughPrice = Decimal.min(position.troughPrice, candle.low);
    }

    if (position) {
      liquidateIfRequired(position.side === "long" ? candle.low : candle.high, candle.closeTime);
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

    if (position) {
      liquidateIfRequired(position.side === "long" ? candle.low : candle.high, candle.closeTime);
    }

    const equity = position
      ? balance.plus(unrealizedPnl(position.side, position.entryPrice, candle.close, position.quantity))
      : balance;
    if (maximumDailyLossRate !== undefined && !dailyLossBreached &&
        equity.lte(dayStartEquity.times(decimal(1).minus(maximumDailyLossRate)))) {
      dailyLossBreached = true;
    }
    equityCurve.push({ timestamp: candle.closeTime, equity: decimalString(equity), funding: decimalString(periodFunding) });

    const evaluatedAt = candle.closeTime;
    let signal: StrategySignal;
    try {
      const inputCandles = Object.freeze(validated.candles.slice(
        maximumLookback === undefined ? 0 : Math.max(0, index + 1 - maximumLookback),
        index + 1,
      ));
      const candidate = await request.evaluator.evaluate(Object.freeze({
        candles: inputCandles,
        market,
        symbol: dataset.request.symbol,
        now: evaluatedAt,
        timeframe: dataset.request.interval,
        leverage: decimalString(leverage),
        portfolio: Object.freeze({
          equity: decimalString(equity),
          dayStartEquity: decimalString(dayStartEquity),
          utcDay,
          dailyLossBreached,
          availableEquity: decimalString(Decimal.max(
            0,
            (market === "spot" ? balance : equity).minus(position?.usedMargin ?? 0),
          )),
          ...(position ? {
            position: Object.freeze({
              side: position.side,
              entryPrice: decimalString(position.entryPrice),
              peakPrice: decimalString(position.peakPrice),
              troughPrice: decimalString(position.troughPrice),
              quantity: decimalString(position.quantity),
              usedMargin: decimalString(position.usedMargin),
              layerCount: position.layerCount,
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
      executionConvention: {
        signalEvaluation: "completed-candle-close",
        signalExecution: "next-candle-open",
        riskTrigger: "close-only-not-intrabar",
      },
      liquidationModel: {
        maintenanceMarginRate: decimalString(maintenanceMarginRate),
        maximumSupportedLeverage: "10",
        check: "intrabar-low-for-long-high-for-short-and-after-funding",
        model: "fixed-conservative-not-weex-tier-exact",
      },
    },
  };
}
