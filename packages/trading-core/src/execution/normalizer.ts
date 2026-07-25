import Decimal from "decimal.js";

import type { StrategySignal } from "../contracts";
import type { OrderIntent } from "../risk";
import type { ExecutionContext, IntentNormalizer } from "./types";

const ExactDecimal = Decimal.clone({ precision: 96 });

function positive(value: string, label: string): Decimal {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
  const parsed = new ExactDecimal(value);
  if (!parsed.isPositive()) throw new TypeError(`Invalid ${label}`);
  return parsed;
}

function floorToStep(value: Decimal, step: string): Decimal {
  const increment = positive(step, "instrument step size");
  return value.div(increment).floor().mul(increment);
}

/** Converts an approved strategy signal into a precision-safe limit intent. */
export class SignalIntentNormalizer implements IntentNormalizer {
  async normalize(signal: Readonly<StrategySignal>, context: Readonly<ExecutionContext>): Promise<OrderIntent> {
    if (!signal || signal.createdAt !== context.now || signal.action === "hold") {
      throw new TypeError("Signal is not executable");
    }
    const price = floorToStep(positive(context.referencePrice, "reference price"), context.instrumentRules.tickSize);
    const risk = context.riskContext;
    let side: "buy" | "sell";
    let reduceOnly = false;
    let quantity: Decimal;

    if (signal.action === "close" || signal.positionEffect === "reduce") {
      if (risk.positionSide === "flat") throw new TypeError("Cannot reduce a flat position");
      side = risk.positionSide === "long" ? "sell" : "buy";
      reduceOnly = true;
      const current = positive(risk.currentPositionQuantity, "current position quantity");
      const rate = signal.action === "close" ? new ExactDecimal(1) : new ExactDecimal(signal.reductionRate ?? 0);
      if (!rate.isPositive() || rate.gt(1)) throw new TypeError("Invalid reduction rate");
      quantity = floorToStep(current.mul(rate), context.instrumentRules.stepSize);
    } else {
      if (signal.action !== "buy" && signal.action !== "sell") throw new TypeError("Signal action is not executable");
      side = signal.action;
      const allocation = new ExactDecimal(signal.allocationRate ?? 1);
      if (!allocation.isPositive() || allocation.gt(1)) throw new TypeError("Invalid allocation rate");
      const budget = positive(context.riskPolicy.maximumOrderNotional, "maximum order notional").mul(allocation);
      quantity = floorToStep(budget.div(price), context.instrumentRules.stepSize);
    }
    const minimum = positive(context.instrumentRules.minimumQuantity, "minimum quantity");
    if (!quantity.isPositive() || quantity.lt(minimum)) throw new RangeError("Normalized quantity is below the instrument minimum");
    return Object.freeze({
      symbol: context.instrumentRules.symbol,
      side,
      quantity: quantity.toFixed(),
      price: price.toFixed(),
      expectedSlippageBps: context.riskPolicy.maximumSlippageBps,
      reduceOnly,
    });
  }
}
