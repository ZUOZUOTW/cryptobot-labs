import { z } from "zod";

const finiteTimestampSchema = z.number().finite();
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const signedDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const PositiveDecimalStringSchema = z
  .string()
  .regex(decimalPattern, "Must be a plain decimal string")
  .refine((value) => /[1-9]/.test(value), "Must be greater than zero");

function comparePositiveDecimals(left: string, right: string): number {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");

  if (leftInteger.length !== rightInteger.length) {
    return leftInteger.length > rightInteger.length ? 1 : -1;
  }
  if (leftInteger !== rightInteger) {
    return leftInteger > rightInteger ? 1 : -1;
  }

  const fractionLength = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = leftFraction.padEnd(fractionLength, "0");
  const normalizedRight = rightFraction.padEnd(fractionLength, "0");
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft > normalizedRight ? 1 : -1;
}

export const MarketSchema = z.enum(["spot", "futures"]);
export const ExecutionModeSchema = z.enum(["paper", "futures-demo", "live"]);
export const SignalActionSchema = z.enum(["buy", "sell", "close", "hold"]);

export const CandleSchema = z
  .strictObject({
    openTime: finiteTimestampSchema,
    closeTime: finiteTimestampSchema,
    open: PositiveDecimalStringSchema,
    high: PositiveDecimalStringSchema,
    low: PositiveDecimalStringSchema,
    close: PositiveDecimalStringSchema,
    volume: PositiveDecimalStringSchema,
    complete: z.boolean(),
  })
  .superRefine((candle, context) => {
    if (candle.closeTime <= candle.openTime) {
      context.addIssue({
        code: "custom",
        path: ["closeTime"],
        message: "closeTime must be after openTime",
      });
    }

    const prices = [candle.open, candle.close, candle.low];
    if (prices.some((price) => comparePositiveDecimals(candle.high, price) < 0)) {
      context.addIssue({
        code: "custom",
        path: ["high"],
        message: "high must be greater than or equal to every price",
      });
    }

    const upperPrices = [candle.open, candle.close, candle.high];
    if (upperPrices.some((price) => comparePositiveDecimals(candle.low, price) > 0)) {
      context.addIssue({
        code: "custom",
        path: ["low"],
        message: "low must be less than or equal to every price",
      });
    }
  });

export const StrategySignalSchema = z.strictObject({
  id: z.string().min(1),
  action: SignalActionSchema,
  reason: z.string().min(1),
  createdAt: finiteTimestampSchema,
  allocationRate: z.number().finite().gt(0).lte(1).optional(),
  positionEffect: z.enum(["add", "reduce"]).optional(),
  reductionRate: z.number().finite().gt(0).lte(1).optional(),
}).superRefine((signal, context) => {
  if (signal.reductionRate !== undefined && signal.positionEffect !== "reduce") {
    context.addIssue({ code: "custom", path: ["reductionRate"], message: "reductionRate requires positionEffect reduce" });
  }
  if (signal.positionEffect === "add" && signal.action === "close") {
    context.addIssue({ code: "custom", path: ["positionEffect"], message: "close cannot add to a position" });
  }
  if (signal.positionEffect !== undefined && signal.action !== "buy" && signal.action !== "sell") {
    context.addIssue({ code: "custom", path: ["positionEffect"], message: "positionEffect requires buy or sell" });
  }
});

export const StrategyInputSchema = z.strictObject({
  candles: z.array(CandleSchema),
  market: MarketSchema,
  symbol: z.string().min(1),
  now: finiteTimestampSchema,
  timeframe: z.string().min(1).optional(),
  leverage: PositiveDecimalStringSchema.optional(),
  portfolio: z.strictObject({
    equity: z.string().regex(signedDecimalPattern),
    dayStartEquity: z.string().regex(signedDecimalPattern),
    utcDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dailyLossBreached: z.boolean().optional(),
    availableEquity: z.string().regex(signedDecimalPattern).optional(),
    consecutiveLosses: z.number().int().nonnegative().optional(),
    lastLossAt: finiteTimestampSchema.optional(),
    position: z.strictObject({
      side: z.enum(["long", "short"]),
      entryTime: finiteTimestampSchema.optional(),
      entryPrice: PositiveDecimalStringSchema,
      peakPrice: PositiveDecimalStringSchema,
      troughPrice: PositiveDecimalStringSchema,
      quantity: PositiveDecimalStringSchema,
      usedMargin: PositiveDecimalStringSchema,
      layerCount: z.number().int().positive(),
    }).optional(),
  }).optional(),
});

export type ParsedCandle = z.infer<typeof CandleSchema>;
export type ParsedStrategySignal = z.infer<typeof StrategySignalSchema>;
export type ParsedStrategyInput = z.infer<typeof StrategyInputSchema>;
