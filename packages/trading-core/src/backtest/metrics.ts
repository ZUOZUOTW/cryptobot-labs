import Decimal from "decimal.js";

import { decimal, decimalString } from "./accounting";
import type { EquityPoint, HistoricalBacktestMetrics, HistoricalTrade } from "./types";

const YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

export function calculateMetrics(
  initialCapital: string,
  equityCurve: readonly EquityPoint[],
  trades: readonly HistoricalTrade[],
  intervalMs: number,
): HistoricalBacktestMetrics {
  const initial = decimal(initialCapital);
  const finalEquity = decimal(equityCurve.at(-1)?.equity ?? initialCapital);
  const totalReturn = finalEquity.div(initial).minus(1);

  const periods = Math.max(1, equityCurve.length);
  const annualPeriods = decimal(String(YEAR_MS)).div(String(intervalMs));
  const annualized = finalEquity.lte(0)
    ? decimal(-1)
    : finalEquity.div(initial).pow(annualPeriods.div(periods)).minus(1);

  let peak = initial;
  let maximumDrawdown = decimal(0);
  const returns: Decimal[] = [];
  let previous = initial;
  for (const point of equityCurve) {
    const equity = decimal(point.equity);
    if (equity.gt(peak)) peak = equity;
    if (peak.gt(0)) maximumDrawdown = Decimal.max(maximumDrawdown, peak.minus(equity).div(peak));
    if (!previous.isZero()) returns.push(equity.minus(previous).div(previous));
    previous = equity;
  }

  const wins = trades.filter((trade) => decimal(trade.realizedPnl).gt(0));
  const gains = wins.reduce((sum, trade) => sum.plus(trade.realizedPnl), decimal(0));
  const losses = trades
    .filter((trade) => decimal(trade.realizedPnl).lt(0))
    .reduce((sum, trade) => sum.plus(decimal(trade.realizedPnl).abs()), decimal(0));

  let sharpe = decimal(0);
  if (returns.length >= 2) {
    const mean = returns.reduce((sum, value) => sum.plus(value), decimal(0)).div(returns.length);
    const variance = returns
      .reduce((sum, value) => sum.plus(value.minus(mean).pow(2)), decimal(0))
      .div(returns.length - 1);
    if (variance.gt(0)) sharpe = mean.div(variance.sqrt()).times(annualPeriods.sqrt());
  }

  return {
    totalReturn: decimalString(totalReturn),
    annualizedReturn: decimalString(annualized),
    maxDrawdown: decimalString(maximumDrawdown),
    winRate: decimalString(trades.length === 0 ? 0 : decimal(wins.length).div(trades.length)),
    profitFactor: losses.isZero() ? (gains.isZero() ? "0" : null) : decimalString(gains.div(losses)),
    sharpe: decimalString(sharpe),
    trades: trades.length,
  };
}
