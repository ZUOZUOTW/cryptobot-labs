import { describe, expect, it, vi } from "vitest";

import type { Candle, HistoricalDataset, StrategyEvaluator } from "../src";
import { runHistoricalBacktest } from "../src/backtest/engine";
import fixedCandles from "./fixtures/btcusdt-1h.json";

function dataset(
  candles: readonly Candle[] = fixedCandles as Candle[],
  market: "spot" | "futures" = "spot",
): HistoricalDataset {
  return {
    request: { market, symbol: "BTCUSDT", interval: "1h", startTime: 0, endTime: 10_800_000 },
    candles,
    intervalMs: 3_600_000,
    complete: true,
    validation: { duplicates: [], ordered: true, gaps: [], incompleteCount: 0 },
    provenance: {
      provider: "WEEX",
      sourceKind: "public-api",
      endpoint: "/candles",
      collectedAt: 20_000_000,
      singleResponse: true,
      paginated: false,
      truncated: false,
      requestedStartTime: 0,
      requestedEndTime: 10_800_000,
      returnedStartTime: 0,
      returnedEndTime: 10_800_000,
    },
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    dataset: dataset(),
    evaluator: {
      async evaluate({ candles }: { candles: readonly Candle[] }) {
        const action = candles.length === 1 ? "buy" : candles.length === 2 ? "close" : "hold";
        return { id: `signal-${candles.length}`, action, reason: action, createdAt: candles.at(-1)!.closeTime };
      },
    } satisfies StrategyEvaluator,
    initialCapital: "1000",
    feeRate: "0.001",
    slippageRate: "0.002",
    leverage: "1",
    funding: [],
    gapPolicy: "fail" as const,
    engineVersion: "1",
    configHash: "config",
    strategyHash: "strategy",
    ...overrides,
  };
}

describe("historical backtest", () => {
  it("evaluates candle N and fills its signal at candle N+1 open", async () => {
    const seen: number[] = [];
    const base = request();
    const result = await runHistoricalBacktest({
      ...base,
      evaluator: {
        async evaluate(input) {
          seen.push(input.candles.length);
          return base.evaluator.evaluate(input);
        },
      },
    });

    expect(seen).toEqual([1, 2, 3]);
    expect(result.trades[0]).toMatchObject({
      side: "long",
      entryTime: 3_600_000,
      entryPrice: "101.202",
      exitTime: 7_200_000,
      exitPrice: "119.76",
      exitReason: "signal",
    });
    expect(result.provenance.provider).toBe("WEEX");
  });

  it("closes an open position at the final close with adverse slippage", async () => {
    const result = await runHistoricalBacktest(request({
      feeRate: "0",
      slippageRate: "0.01",
      evaluator: {
        async evaluate({ candles }: { candles: readonly Candle[] }) {
          return { id: "buy", action: candles.length === 1 ? "buy" : "hold", reason: "test", createdAt: candles.at(-1)!.closeTime };
        },
      },
    }));

    expect(result.trades[0]).toMatchObject({ exitPrice: "118.8", exitTime: 10_799_999, exitReason: "end-of-data" });
  });

  it("supports futures long and short but never flips on the same signal", async () => {
    const futures = dataset(fixedCandles as Candle[], "futures");
    const actions = ["buy", "sell", "sell"] as const;
    const result = await runHistoricalBacktest(request({
      dataset: futures,
      feeRate: "0",
      slippageRate: "0",
      leverage: "2",
      evaluator: {
        async evaluate({ candles }: { candles: readonly Candle[] }) {
          return { id: `s${candles.length}`, action: actions[candles.length - 1] ?? "hold", reason: "test", createdAt: candles.at(-1)!.closeTime };
        },
      },
    }));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ side: "long", exitReason: "opposite-signal" });
    expect(result.signalEvents.find((event) => event.signalId === "s2")?.effect).toBe("closed");
  });

  it("rejects spot shorts and records evaluator errors and invalid signals", async () => {
    let call = 0;
    const result = await runHistoricalBacktest(request({
      evaluator: {
        async evaluate() {
          call += 1;
          if (call === 1) return { id: "short", action: "sell", reason: "bad", createdAt: 1 };
          if (call === 2) throw new Error("strategy failed");
          return { id: "invalid", action: "wait", reason: "bad", createdAt: 3 } as never;
        },
      },
    }));

    expect(result.trades).toEqual([]);
    expect(result.signalEvents.map(({ status, reason }) => [status, reason])).toEqual([
      ["rejected", "spot-short-not-supported"],
      ["rejected", "evaluator-error"],
      ["rejected", "invalid-signal"],
    ]);
  });

  it("fails on gaps before evaluating, or discloses them without interpolation", async () => {
    const candles = [fixedCandles[0], fixedCandles[2]] as Candle[];
    const evaluator = { evaluate: vi.fn(async () => ({ id: "hold", action: "hold" as const, reason: "test", createdAt: 1 })) };
    const broken = dataset(candles);

    await expect(runHistoricalBacktest(request({ dataset: broken, evaluator }))).rejects.toThrow(/gap/i);
    expect(evaluator.evaluate).not.toHaveBeenCalled();

    const result = await runHistoricalBacktest(request({ dataset: broken, evaluator, gapPolicy: "disclose" }));
    expect(result.provenance.complete).toBe(false);
    expect(result.provenance.gaps).toEqual([{ from: 3_600_000, to: 7_199_999 }]);
    expect(result.equityCurve).toHaveLength(2);
  });

  it("rejects empty, insufficient, incomplete, unordered, duplicate, and invalid numeric inputs", async () => {
    const base = request();
    await expect(runHistoricalBacktest({ ...base, dataset: dataset([]) })).rejects.toThrow(/two completed candles/i);
    await expect(runHistoricalBacktest({ ...base, dataset: dataset([fixedCandles[0] as Candle]) })).rejects.toThrow(/two completed candles/i);
    await expect(runHistoricalBacktest({ ...base, dataset: dataset([{ ...fixedCandles[0], complete: false }, fixedCandles[1]] as Candle[]) })).rejects.toThrow(/complete/i);
    await expect(runHistoricalBacktest({ ...base, dataset: dataset([fixedCandles[1], fixedCandles[0]] as Candle[]) })).rejects.toThrow(/ordered/i);
    await expect(runHistoricalBacktest({ ...base, dataset: dataset([fixedCandles[0], fixedCandles[0]] as Candle[]) })).rejects.toThrow();
    for (const [field, value] of [["initialCapital", "0"], ["feeRate", "-1"], ["slippageRate", "1"], ["leverage", "0"]] as const) {
      await expect(runHistoricalBacktest({ ...base, [field]: value })).rejects.toThrow();
    }
  });

  it("rejects unsafe candle timestamps at the engine boundary", async () => {
    const base = request();
    const cases = [
      { ...fixedCandles[0], openTime: -1 },
      { ...fixedCandles[0], openTime: 0.5 },
      { ...fixedCandles[0], closeTime: Number.MAX_SAFE_INTEGER + 1 },
      { ...fixedCandles[0], closeTime: fixedCandles[0]!.openTime },
    ];
    for (const invalid of cases) {
      await expect(runHistoricalBacktest({
        ...base,
        dataset: dataset([invalid, fixedCandles[1]] as Candle[]),
      })).rejects.toThrow(/time/i);
    }
  });

  it("requires an explicit funding mark price rather than looking ahead to a candle close", async () => {
    const evaluate = vi.fn(request().evaluator.evaluate);
    await expect(runHistoricalBacktest(request({
      dataset: dataset(fixedCandles as Candle[], "futures"),
      evaluator: { evaluate },
      funding: [{ timestamp: 5_000_000, rate: "0.01" }],
    }))).rejects.toThrow(/mark price/i);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects overlapping candles and interval-duration mismatches before evaluation", async () => {
    const evaluate = vi.fn(request().evaluator.evaluate);
    const overlapping = [
      fixedCandles[0],
      { ...fixedCandles[1], openTime: 3_000_000, closeTime: 6_599_999 },
    ] as Candle[];
    const wrongDuration = [
      fixedCandles[0],
      { ...fixedCandles[1], closeTime: 7_100_000 },
    ] as Candle[];

    await expect(runHistoricalBacktest(request({ dataset: dataset(overlapping), evaluator: { evaluate } })))
      .rejects.toThrow(/overlap/i);
    await expect(runHistoricalBacktest(request({ dataset: dataset(wrongDuration), evaluator: { evaluate } })))
      .rejects.toThrow(/duration/i);
    expect(evaluate).not.toHaveBeenCalled();
  });
});
