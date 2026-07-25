import { describe, expect, it } from "vitest";

import { decimalRatio, deriveFuturesPositionSnapshot, requireSettlementBalance } from "../src/cloud-runtime";

describe("cloud strategy settlement balance", () => {
  it("uses WEEX SUSDT for futures demo execution", () => {
    expect(requireSettlementBalance([
      { asset: "SUSDT", total: "5000", available: "5000" },
    ], "futures-demo")).toMatchObject({ asset: "SUSDT", total: "5000" });
  });

  it("classifies an empty demo wallet as an actionable terminal prerequisite", () => {
    expect(() => requireSettlementBalance([
      { asset: "SUSDT", total: "0", available: "0" },
    ], "futures-demo")).toThrow(expect.objectContaining({
      code: "demo_funds_required",
      stage: "account",
      terminal: true,
    }));
  });

  it("does not use a live USDT balance when the demo settlement asset is absent", () => {
    expect(() => requireSettlementBalance([
      { asset: "USDT", total: "5000", available: "5000" },
      { asset: "USDC", total: "100", available: "100" },
    ], "futures-demo")).toThrow(expect.objectContaining({
      code: "demo_funds_required",
    }));
  });
});

describe("cloud strategy position accounting", () => {
  it("derives an exact futures entry price and post-entry extrema", () => {
    const snapshot = deriveFuturesPositionSnapshot({
      asset: "USDT",
      symbol: "BTCUSDT",
      side: "long",
      leverage: "10",
      size: "0.02",
      openValue: "1801.067",
      unrealizedPnl: "-85.569",
      openedAt: 2_000,
      updatedAt: 4_000,
    }, [
      { openTime: 0, closeTime: 1_999, open: "1", high: "100000", low: "1", close: "90000", volume: "1", complete: true },
      { openTime: 2_000, closeTime: 2_999, open: "90050", high: "92000", low: "88000", close: "91000", volume: "1", complete: true },
      { openTime: 3_000, closeTime: 3_999, open: "91000", high: "93000", low: "89000", close: "92000", volume: "1", complete: true },
    ]);

    expect(snapshot).toEqual({
      side: "long",
      entryTime: 2_000,
      entryPrice: "90053.35",
      peakPrice: "93000",
      troughPrice: "88000",
      quantity: "0.02",
      usedMargin: "1801.067",
      layerCount: 1,
    });
  });

  it("performs decimal division without binary floating-point drift", () => {
    expect(decimalRatio("1", "3")).toBe("0.333333333333333333");
    expect(decimalRatio("650", "0.01")).toBe("65000");
  });
});
