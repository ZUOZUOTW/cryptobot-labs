import { describe, expect, it, vi } from "vitest";

import { SandboxExecutionError, type Candle, type HistoricalDataset, type StrategyEvaluator, type StrategyInput } from "../src";
import { MAX_DECIMAL_STRING_LENGTH, MAX_HISTORICAL_CANDLES, runHistoricalBacktest } from "../src/backtest/engine";
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
  const generatedCandles = (prices: Array<{ open: number; close: number }>, intervalMs = 3_600_000): Candle[] => prices.map((price, index) => ({
    openTime: index * intervalMs,
    closeTime: (index + 1) * intervalMs - 1,
    open: String(price.open),
    high: String(Math.max(price.open, price.close) + 1),
    low: String(Math.min(price.open, price.close) - 1),
    close: String(price.close),
    volume: "100",
    complete: true,
  }));

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

  it("allocates only the requested fraction of usable equity", async () => {
    const full = await runHistoricalBacktest(request({
      feeRate: "0",
      slippageRate: "0",
      evaluator: { async evaluate({ candles }: { candles: readonly Candle[] }) {
        return { id: "full", action: candles.length === 1 ? "buy" : "hold", reason: "full", createdAt: candles.at(-1)!.closeTime };
      } },
    }));
    const quarter = await runHistoricalBacktest(request({
      feeRate: "0",
      slippageRate: "0",
      evaluator: { async evaluate({ candles }: { candles: readonly Candle[] }) {
        return { id: "quarter", action: candles.length === 1 ? "buy" : "hold", reason: "quarter", createdAt: candles.at(-1)!.closeTime, allocationRate: 0.25 };
      } },
    }));
    expect(Number(quarter.trades[0]!.quantity)).toBeCloseTo(Number(full.trades[0]!.quantity) * 0.25, 12);
  });

  it("adds at a weighted entry and partially reduces a layered position", async () => {
    const items = generatedCandles([
      { open: 100, close: 100 }, { open: 100, close: 100 }, { open: 200, close: 200 },
      { open: 160, close: 160 }, { open: 150, close: 150 },
    ]);
    const actions = [
      { action: "buy" as const, allocationRate: 0.2 },
      { action: "buy" as const, allocationRate: 0.25, positionEffect: "add" as const },
      { action: "sell" as const, positionEffect: "reduce" as const, reductionRate: 0.5 },
      { action: "close" as const },
      { action: "hold" as const },
    ];
    const result = await runHistoricalBacktest(request({
      dataset: dataset(items), feeRate: "0", slippageRate: "0",
      evaluator: { async evaluate({ candles }: { candles: readonly Candle[] }) {
        return { id: `layer-${candles.length}`, reason: "layer", createdAt: candles.at(-1)!.closeTime, ...actions[candles.length - 1]! };
      } },
    }));
    expect(result.signalEvents.map((event) => event.effect)).toContain("added");
    expect(result.signalEvents.map((event) => event.effect)).toContain("reduced");
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]).toMatchObject({ entryPrice: "138.4615384615384615384615384615384615385", quantity: "1.625", exitReason: "partial-reduction" });
    expect(result.trades[1]).toMatchObject({ quantity: "1.625", exitReason: "signal" });
  });

  it("splits accrued funding proportionally across partial and final closes", async () => {
    const items = generatedCandles([{ open: 100, close: 100 }, { open: 100, close: 100 }, { open: 100, close: 100 }]);
    const result = await runHistoricalBacktest(request({
      dataset: dataset(items, "futures"), feeRate: "0", slippageRate: "0", leverage: "2",
      funding: [{ timestamp: 4_000_000, rate: "0.1", markPrice: "100" }],
      evaluator: { async evaluate({ candles }: { candles: readonly Candle[] }) {
        const signal = candles.length === 1
          ? { action: "buy" as const }
          : candles.length === 2
            ? { action: "sell" as const, positionEffect: "reduce" as const, reductionRate: 0.5 }
            : { action: "hold" as const };
        return { id: `fund-${candles.length}`, reason: "fund", createdAt: candles.at(-1)!.closeTime, ...signal };
      } },
    }));
    expect(result.trades.map((trade) => trade.funding)).toEqual(["-100", "-100"]);
    expect(result.provenance.fundingTreatment.netFunding).toBe("-200");
  });

  it("rejects layered additions once all collateral is reserved", async () => {
    const items = generatedCandles([{ open: 100, close: 100 }, { open: 100, close: 100 }, { open: 100, close: 100 }]);
    const result = await runHistoricalBacktest(request({
      dataset: dataset(items), feeRate: "0", slippageRate: "0",
      evaluator: { async evaluate({ candles }: { candles: readonly Candle[] }) {
        const action = candles.length === 1
          ? { action: "buy" as const, allocationRate: 1 }
          : { action: "buy" as const, allocationRate: 1, positionEffect: "add" as const };
        return { id: `capacity-${candles.length}`, reason: "capacity", createdAt: candles.at(-1)!.closeTime, ...action };
      } },
    }));
    expect(result.signalEvents.find((event) => event.signalId === "capacity-2")).toMatchObject({
      status: "rejected", effect: "none", reason: "insufficient-available-equity",
    });
    expect(result.trades[0]!.quantity).toBe("10");
  });

  it("uses realized cash for spot tranches and equity for futures tranches", async () => {
    const items = generatedCandles([{ open: 100, close: 100 }, { open: 100, close: 100 }, { open: 200, close: 200 }]);
    const layered = { async evaluate({ candles }: { candles: readonly Candle[] }) {
      return {
        id: `cash-${candles.length}`, action: "buy" as const, reason: "cash", createdAt: candles.at(-1)!.closeTime,
        allocationRate: 0.5, ...(candles.length > 1 ? { positionEffect: "add" as const } : {}),
      };
    } };
    const spot = await runHistoricalBacktest(request({ dataset: dataset(items), feeRate: "0", slippageRate: "0", evaluator: layered }));
    expect(spot.trades[0]!.quantity).toBe("7.5");

    const futures = await runHistoricalBacktest(request({
      dataset: dataset(items, "futures"), feeRate: "0", slippageRate: "0", leverage: "2", evaluator: layered,
    }));
    expect(Number(futures.trades[0]!.quantity)).toBeGreaterThan(Number(spot.trades[0]!.quantity));
    expect(futures.trades[0]!.quantity).toBe("20");
  });

  it("rejects incoherent add/reduce effects without changing the position", async () => {
    const items = generatedCandles([{ open: 100, close: 100 }, { open: 100, close: 100 }, { open: 100, close: 100 }, { open: 100, close: 100 }]);
    const signals = [
      { action: "buy" as const, allocationRate: 0.25 },
      { action: "sell" as const, positionEffect: "add" as const, allocationRate: 0.25 },
      { action: "buy" as const, positionEffect: "reduce" as const, reductionRate: 0.5 },
      { action: "hold" as const },
    ];
    const result = await runHistoricalBacktest(request({
      dataset: dataset(items), feeRate: "0", slippageRate: "0",
      evaluator: { async evaluate({ candles }: { candles: readonly Candle[] }) {
        return { id: `coherent-${candles.length}`, reason: "coherent", createdAt: candles.at(-1)!.closeTime, ...signals[candles.length - 1]! };
      } },
    }));
    expect(result.signalEvents.filter((event) => event.reason === "incoherent-position-effect")).toHaveLength(2);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.quantity).toBe("2.5");
  });

  it.each([
    ["long", "buy", { open: 100, close: 100, high: "101", low: "80" }],
    ["short", "sell", { open: 100, close: 100, high: "120", low: "99" }],
  ] as const)("liquidates a %s at the conservative intrabar mark", async (_side, action, adverse) => {
    const items = generatedCandles([{ open: 100, close: 100 }, { open: 100, close: 100 }, { open: 100, close: 100 }]);
    items[1] = { ...items[1]!, high: adverse.high, low: adverse.low };
    const result = await runHistoricalBacktest(request({
      dataset: dataset(items, "futures"), leverage: "10", maintenanceMarginRate: "0.02", feeRate: "0", slippageRate: "0",
      evaluator: { async evaluate({ candles }: { candles: readonly Candle[] }) {
        return { id: "liq", action: candles.length === 1 ? action : "hold", reason: "liq", createdAt: candles.at(-1)!.closeTime };
      } },
    }));
    expect(result.trades[0]!.exitReason).toBe("liquidation");
    expect(Number(result.equityCurve.at(-1)!.equity)).toBeGreaterThanOrEqual(0);
    expect(result.provenance.liquidationModel).toMatchObject({ maintenanceMarginRate: "0.02", model: "fixed-conservative-not-weex-tier-exact" });
  });

  it("rechecks liquidation after funding is debited", async () => {
    const items = generatedCandles([{ open: 100, close: 100 }, { open: 100, close: 100 }, { open: 100, close: 100 }]);
    const result = await runHistoricalBacktest(request({
      dataset: dataset(items, "futures"), leverage: "10", maintenanceMarginRate: "0.02", feeRate: "0", slippageRate: "0",
      funding: [
        { timestamp: 4_000_000, rate: "0.09", markPrice: "100" },
        { timestamp: 5_000_000, rate: "-0.09", markPrice: "100" },
      ],
      evaluator: { async evaluate({ candles }: { candles: readonly Candle[] }) {
        return { id: "funding-liq", action: candles.length === 1 ? "buy" : "hold", reason: "funding-liq", createdAt: candles.at(-1)!.closeTime };
      } },
    }));
    expect(result.trades[0]!.exitReason).toBe("liquidation");
    expect(result.trades[0]!.exitTime).toBe(4_000_000);
    expect(result.provenance.fundingTreatment.appliedEvents).toBe(1);
    expect(result.provenance.fundingTreatment).toMatchObject({ suppliedEvents: 2, netFunding: "-900" });
  });

  it("applies funding credit first, then the candle-wide adverse extreme", async () => {
    const items = generatedCandles([{ open: 100, close: 100 }, { open: 100, close: 100 }, { open: 100, close: 100 }]);
    items[1] = { ...items[1]!, low: "70" };
    const result = await runHistoricalBacktest(request({
      dataset: dataset(items, "futures"), leverage: "10", maintenanceMarginRate: "0.02", feeRate: "0", slippageRate: "0",
      funding: [{ timestamp: 4_000_000, rate: "-0.05", markPrice: "100" }],
      evaluator: { async evaluate({ candles }: { candles: readonly Candle[] }) {
        return { id: "credit-adverse", action: candles.length === 1 ? "buy" : "hold", reason: "credit-adverse", createdAt: candles.at(-1)!.closeTime };
      } },
    }));
    expect(result.provenance.fundingTreatment).toMatchObject({ appliedEvents: 1, netFunding: "500" });
    expect(result.trades[0]).toMatchObject({ exitReason: "liquidation", exitTime: items[1]!.closeTime });
    expect(result.provenance.liquidationModel).toMatchObject({
      check: "funding-event-mark-immediately-then-candle-low-long-high-short",
      orderingAssumption: "funding-applied-at-event-timestamp-before-candle-wide-adverse-extreme",
    });
  });

  it("latches daily loss until the next UTC day even after equity recovers", async () => {
    const intervalMs = 6 * 3_600_000;
    const items = generatedCandles([
      { open: 100, close: 100 }, { open: 100, close: 80 }, { open: 80, close: 100 },
      { open: 100, close: 100 }, { open: 100, close: 100 },
    ], intervalMs);
    const flags: boolean[] = [];
    const result = await runHistoricalBacktest(request({
      dataset: { ...dataset(items), intervalMs, request: { market: "spot", symbol: "BTCUSDT", interval: "6h" } },
      feeRate: "0", slippageRate: "0",
      evaluator: {
        riskPolicy: { maximumDailyLossRate: 0.05 },
        async evaluate(strategyInput: Readonly<StrategyInput>) {
          flags.push(strategyInput.portfolio!.dailyLossBreached ?? false);
          const action = strategyInput.candles.length === 1 ? "buy" : strategyInput.portfolio!.dailyLossBreached && strategyInput.portfolio!.position ? "close" : "hold";
          return { id: `latch-${strategyInput.now}`, action, reason: "latch", createdAt: strategyInput.now };
        },
      },
    }));
    expect(flags).toEqual([false, true, true, true, false]);
    expect(result.trades).toHaveLength(1);
  });

  it("bounds visual lookback and discloses close-to-next-open execution", async () => {
    const items = generatedCandles(Array.from({ length: 1_100 }, () => ({ open: 100, close: 100 })));
    const seen: number[] = [];
    const result = await runHistoricalBacktest(request({
      dataset: dataset(items),
      evaluator: { maximumLookback: 1024, async evaluate({ candles, now }: Readonly<StrategyInput>) {
        seen.push(candles.length);
        return { id: `bounded-${now}`, action: "hold", reason: "bounded", createdAt: now };
      } },
    }));
    expect(Math.max(...seen)).toBe(1024);
    expect(result.provenance.executionConvention).toEqual({
      signalEvaluation: "completed-candle-close",
      signalExecution: "next-candle-open",
      riskTrigger: "close-only-not-intrabar",
    });
  });

  it("provides frozen real position state and resets day-start equity on UTC boundaries", async () => {
    const shifted = (fixedCandles as Candle[]).map((candle, index) => ({
      ...candle,
      openTime: index * 86_400_000,
      closeTime: (index + 1) * 86_400_000 - 1,
    }));
    const seen: Array<{ day: string; dayStart: string; position?: { entryPrice: string; peakPrice: string; troughPrice: string } }> = [];
    await runHistoricalBacktest(request({
      dataset: { ...dataset(shifted), intervalMs: 86_400_000, request: { market: "spot", symbol: "BTCUSDT", interval: "1d" } },
      feeRate: "0",
      slippageRate: "0",
      evaluator: { async evaluate(strategyInput: Readonly<StrategyInput>) {
        expect(Object.isFrozen(strategyInput.portfolio)).toBe(true);
        if (strategyInput.portfolio) seen.push({
          day: strategyInput.portfolio.utcDay,
          dayStart: strategyInput.portfolio.dayStartEquity,
          ...(strategyInput.portfolio.position ? { position: strategyInput.portfolio.position } : {}),
        });
        return { id: `s-${strategyInput.candles.length}`, action: strategyInput.candles.length === 1 ? "buy" : "hold", reason: "snapshot", createdAt: strategyInput.now };
      } },
    }));
    expect(seen.map((item) => item.day)).toEqual(["1970-01-01", "1970-01-02", "1970-01-03"]);
    expect(seen[1]!.position).toMatchObject({ entryPrice: "101", peakPrice: "111", troughPrice: "100" });
    expect(seen[2]!.dayStart).not.toBe("1000");
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

  it("aborts evidence immediately on sandbox failures even without a caller policy", async () => {
    const evaluate = vi.fn(async () => {
      throw new SandboxExecutionError("deadline-exceeded", "sandbox deadline exceeded");
    });
    await expect(runHistoricalBacktest(request({
      evaluator: { evaluate },
    }))).rejects.toThrow("sandbox deadline exceeded");
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("honors whole-run cancellation and wall-clock budgets", async () => {
    const aborted = new AbortController();
    aborted.abort(new Error("request cancelled"));
    const evaluate = vi.fn(request().evaluator.evaluate);
    await expect(runHistoricalBacktest(request({ evaluator: { evaluate } }), {
      signal: aborted.signal,
    })).rejects.toThrow("request cancelled");
    expect(evaluate).not.toHaveBeenCalled();

    const slow = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { id: "slow", action: "hold" as const, reason: "slow", createdAt: 1 };
    });
    await expect(runHistoricalBacktest(request({
      evaluator: { evaluationErrorPolicy: "abort-backtest", evaluate: slow },
    }), { maximumDurationMs: 1 })).rejects.toThrow(/deadline/i);
    expect(slow).toHaveBeenCalledTimes(1);
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

  it("rejects oversized datasets and decimal strings before evaluation", async () => {
    const evaluator = { evaluate: vi.fn(request().evaluator.evaluate) };
    await expect(runHistoricalBacktest(request({
      dataset: dataset(Array.from({ length: MAX_HISTORICAL_CANDLES + 1 }, () => fixedCandles[0] as Candle)), evaluator,
    }))).rejects.toThrow(/at most/i);
    const oversized = "1".repeat(MAX_DECIMAL_STRING_LENGTH + 1);
    await expect(runHistoricalBacktest(request({
      dataset: dataset([{ ...fixedCandles[0], open: oversized }, fixedCandles[1]] as Candle[]), evaluator,
    }))).rejects.toThrow(/decimal string limit/i);
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("bounds every numeric and metadata collection at the engine boundary", async () => {
    const huge = "1".repeat(MAX_DECIMAL_STRING_LENGTH + 1);
    await expect(runHistoricalBacktest(request({ initialCapital: huge }))).rejects.toThrow(/bounded/i);
    await expect(runHistoricalBacktest(request({
      dataset: dataset(fixedCandles as Candle[], "futures"), leverage: "2", funding: [{ timestamp: 1, rate: huge, markPrice: "100" }],
    }))).rejects.toThrow(/bounded/i);
    await expect(runHistoricalBacktest(request({
      dataset: { ...dataset(fixedCandles as Candle[]), validation: { duplicates: Array(4).fill(1), ordered: true, gaps: [], incompleteCount: 0 } },
    }))).rejects.toThrow(/oversized/i);
    await expect(runHistoricalBacktest(request({ dataset: dataset(fixedCandles as Candle[], "futures"), leverage: "501" }))).rejects.toThrow(/500/);
    await expect(runHistoricalBacktest(request({ maintenanceMarginRate: "0.02" }))).rejects.toThrow(/spot/i);
    await expect(runHistoricalBacktest(request({
      dataset: dataset(fixedCandles as Candle[], "futures"), leverage: "2", maintenanceMarginRate: "1",
    }))).rejects.toThrow(/less than one/i);
  });

  it("supports a viable 20x backtest under the disclosed 2% model", async () => {
    const items = generatedCandles([{ open: 100, close: 100 }, { open: 100, close: 100 }, { open: 100, close: 100 }]);
    const result = await runHistoricalBacktest(request({
      dataset: dataset(items, "futures"), leverage: "20", maintenanceMarginRate: "0.02", feeRate: "0", slippageRate: "0",
      evaluator: { async evaluate({ candles }: { candles: readonly Candle[] }) {
        return { id: "twenty", action: candles.length === 1 ? "buy" : "hold", reason: "twenty", createdAt: candles.at(-1)!.closeTime };
      } },
    }));
    expect(result.trades[0]!.exitReason).toBe("end-of-data");
    expect(result.provenance.liquidationModel).toMatchObject({ maintenanceMarginRate: "0.02", maximumSupportedLeverage: "500" });
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
