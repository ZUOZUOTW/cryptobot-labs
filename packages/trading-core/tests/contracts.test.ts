import { describe, expect, it } from "vitest";

import { CandleSchema, StrategySignalSchema } from "../src/schemas";

const validCandle = {
  openTime: 1,
  closeTime: 2,
  open: "10",
  high: "11",
  low: "9",
  close: "10.5",
  volume: "1.25",
  complete: true,
};

const validSignal = {
  id: "sig-1",
  action: "buy",
  reason: "entry",
  createdAt: 2,
};

describe("shared trading contracts", () => {
  it("accepts valid candles and strategy signals", () => {
    expect(CandleSchema.parse(validCandle)).toEqual(validCandle);
    expect(StrategySignalSchema.parse(validSignal)).toEqual(validSignal);
  });

  it("rejects invalid OHLC relationships", () => {
    expect(() => CandleSchema.parse({ ...validCandle, high: "9" })).toThrow();
    expect(() => CandleSchema.parse({ ...validCandle, low: "10.25" })).toThrow();
  });

  it("rejects credential-shaped and other extra fields", () => {
    expect(() =>
      StrategySignalSchema.parse({
        ...validSignal,
        secretKey: "must-not-pass",
      }),
    ).toThrow();
    expect(() => CandleSchema.parse({ ...validCandle, note: "extra" })).toThrow();
  });

  it("rejects invalid timestamps, decimal strings, and actions", () => {
    expect(() => CandleSchema.parse({ ...validCandle, openTime: Number.NaN })).toThrow();
    expect(() => CandleSchema.parse({ ...validCandle, closeTime: 1 })).toThrow();
    expect(() => CandleSchema.parse({ ...validCandle, volume: "0" })).toThrow();
    expect(() => CandleSchema.parse({ ...validCandle, open: "1e3" })).toThrow();
    expect(() => StrategySignalSchema.parse({ ...validSignal, action: "wait" })).toThrow();
  });
});
