import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";

import type { Candle, HistoricalDataset, StrategyEvaluator } from "../src";
import { runHistoricalBacktest } from "../src/backtest/engine";

function candles(prices: readonly string[]): Candle[] {
  return prices.map((price, index) => ({
    openTime: index * 3_600_000,
    closeTime: (index + 1) * 3_600_000 - 1,
    open: price, high: price, low: price, close: price, volume: "1", complete: true,
  }));
}

function dataset(prices: readonly string[], market: "spot" | "futures" = "spot"): HistoricalDataset {
  const rows = candles(prices);
  return {
    request: { market, symbol: "BTCUSDT", interval: "1h", startTime: 0, endTime: rows.length * 3_600_000 },
    candles: rows,
    intervalMs: 3_600_000,
    complete: true,
    validation: { duplicates: [], ordered: true, gaps: [], incompleteCount: 0 },
    provenance: { provider: "WEEX", sourceKind: "public-api", endpoint: "/candles", collectedAt: 1, singleResponse: true, paginated: false, truncated: false },
  };
}

function evaluator(actions: readonly ("buy" | "sell" | "close" | "hold")[]): StrategyEvaluator {
  return { async evaluate({ candles: rows }) {
    const action = actions[rows.length - 1] ?? "hold";
    return { id: `s${rows.length}`, action, reason: action, createdAt: rows.at(-1)!.closeTime };
  } };
}

function request(data: HistoricalDataset, strategy: StrategyEvaluator, overrides: Record<string, unknown> = {}) {
  return { dataset: data, evaluator: strategy, initialCapital: "1000", feeRate: "0", slippageRate: "0", leverage: "1", funding: [], gapPolicy: "fail" as const, engineVersion: "1", configHash: "c", strategyHash: "s", ...overrides };
}

describe("historical accounting", () => {
  it("charges entry and exit fees on notional", async () => {
    const result = await runHistoricalBacktest(request(dataset(["100", "100", "110"]), evaluator(["buy", "close"]), {
      initialCapital: "1100",
      feeRate: "0.1",
    }));
    expect(result.trades[0]).toMatchObject({ quantity: "10", entryFee: "100", exitFee: "110", fees: "210", realizedPnl: "-110" });
    expect(result.equityCurve.at(-1)?.equity).toBe("990");
  });

  it("applies leverage to futures notional and calculates long and short PnL", async () => {
    const long = await runHistoricalBacktest(request(dataset(["100", "100", "110"], "futures"), evaluator(["buy", "close"]), { leverage: "2" }));
    expect(long.trades[0]).toMatchObject({ quantity: "20", realizedPnl: "200" });

    const short = await runHistoricalBacktest(request(dataset(["100", "100", "90"], "futures"), evaluator(["sell", "close"]), { leverage: "2" }));
    expect(short.trades[0]).toMatchObject({ side: "short", quantity: "20", realizedPnl: "200" });
  });

  it("applies positive funding as a long payment and short receipt", async () => {
    const funding = [{ timestamp: 8_000_000, rate: "0.01", markPrice: "100" }];
    const long = await runHistoricalBacktest(request(dataset(["100", "100", "100"], "futures"), evaluator(["buy", "hold"]), { funding }));
    const short = await runHistoricalBacktest(request(dataset(["100", "100", "100"], "futures"), evaluator(["sell", "hold"]), { funding }));
    expect(long.trades[0]).toMatchObject({ funding: "-10", realizedPnl: "-10" });
    expect(short.trades[0]).toMatchObject({ funding: "10", realizedPnl: "10" });
    expect(long.provenance.fundingTreatment.appliedEvents).toBe(1);
  });

  it("includes initial capital when calculating first-period drawdown", async () => {
    const result = await runHistoricalBacktest(request(dataset(["100", "100", "50"]), evaluator(["buy", "hold"])));
    expect(result.metrics.maxDrawdown).toBe("0.5");
  });

  it("rejects leverage and fee combinations that can consume all usable equity", async () => {
    await expect(runHistoricalBacktest(request(
      dataset(["100", "100"], "futures"),
      evaluator(["buy"]),
      { leverage: "100", feeRate: "0.01" },
    ))).rejects.toThrow(/leverage.*fee/i);
  });

  it("does not create negative positions when a ruined account receives a re-entry signal", async () => {
    const result = await runHistoricalBacktest(request(
      dataset(["100", "100", "1", "1"], "futures"),
      evaluator(["buy", "close", "buy"]),
      { leverage: "2" },
    ));

    expect(result.trades).toHaveLength(1);
    expect(result.equityCurve[2]!.equity).toBe("-980");
    expect(result.signalEvents.find((event) => event.signalId === "s3")).toMatchObject({
      status: "rejected",
      effect: "none",
      reason: "nonpositive-equity",
    });
    expect(result.trades.every((trade) => !trade.quantity.startsWith("-"))).toBe(true);
  });

  it("uses elapsed timestamps for annualization and suppresses irregular-sample Sharpe", async () => {
    const second = { ...candles(["100"])[0]!, openTime: 3_600_000, closeTime: 7_199_999, open: "100", high: "110", low: "100", close: "110" };
    const contiguous = { ...dataset(["100", "100"]), candles: [candles(["100"])[0]!, second] };
    const gapRows = [candles(["100"])[0]!, { ...second, openTime: 7_200_000, closeTime: 10_799_999 }];
    const gapped: HistoricalDataset = {
      ...dataset(["100", "110"]),
      candles: gapRows,
      complete: false,
      validation: { duplicates: [], ordered: true, gaps: [{ from: 3_600_000, to: 7_199_999 }], incompleteCount: 0 },
    };
    const strategy = evaluator(["buy"]);
    const regularResult = await runHistoricalBacktest(request(contiguous, strategy));
    const gapResult = await runHistoricalBacktest(request(gapped, strategy, { gapPolicy: "disclose" }));

    expect(new Decimal(gapResult.metrics.annualizedReturn).lt(regularResult.metrics.annualizedReturn)).toBe(true);
    expect(gapResult.metrics.sharpe).toBe("0");
  });
});
