import Decimal from "decimal.js";

import type { PositionSide } from "./types";

Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -1_000_000, toExpPos: 1_000_000 });

/**
 * Public decimal values are rounded to 40 significant digits, emitted in plain
 * notation, then stripped of insignificant trailing zeroes. Zero is always "0".
 */
export function decimalString(value: Decimal.Value): string {
  const decimal = new Decimal(value);
  if (decimal.isZero()) return "0";
  const fixed = decimal.toSignificantDigits(40, Decimal.ROUND_HALF_UP).toFixed();
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

export function decimal(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function adverseFill(
  referencePrice: Decimal.Value,
  orderSide: "buy" | "sell",
  slippageRate: Decimal.Value,
): Decimal {
  const multiplier = orderSide === "buy"
    ? new Decimal(1).plus(slippageRate)
    : new Decimal(1).minus(slippageRate);
  return new Decimal(referencePrice).times(multiplier);
}

export function positionPnl(
  side: PositionSide,
  entryPrice: Decimal.Value,
  exitPrice: Decimal.Value,
  quantity: Decimal.Value,
): Decimal {
  const movement = side === "long"
    ? new Decimal(exitPrice).minus(entryPrice)
    : new Decimal(entryPrice).minus(exitPrice);
  return movement.times(quantity);
}

export function unrealizedPnl(
  side: PositionSide,
  entryPrice: Decimal.Value,
  markPrice: Decimal.Value,
  quantity: Decimal.Value,
): Decimal {
  return positionPnl(side, entryPrice, markPrice, quantity);
}
