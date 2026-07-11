import { expect, it } from "vitest";

import type { Candle, HistoricalDataset, StrategyEvaluator } from "../src";
import { runHistoricalBacktest } from "../src/backtest/engine";
import fixedCandles from "./fixtures/btcusdt-1h.json";

const evaluator: StrategyEvaluator = { async evaluate({ candles }) {
  return { id: `s-${candles.length}`, action: candles.length === 1 ? "buy" : "hold", reason: "fixed", createdAt: candles.at(-1)!.closeTime };
} };

function dataset(candles: readonly Candle[]): HistoricalDataset {
  return {
    request: { market: "spot", symbol: "BTCUSDT", interval: "1h", startTime: 0, endTime: 10_800_000 }, candles,
    intervalMs: 3_600_000, complete: true,
    validation: { duplicates: [], ordered: true, gaps: [], incompleteCount: 0 },
    provenance: { provider: "WEEX", sourceKind: "public-api", endpoint: "/candles", collectedAt: 123, singleResponse: true, paginated: false, truncated: false },
  };
}

it("returns byte-identical results and a stable canonical dataset digest", async () => {
  const request = { dataset: dataset(fixedCandles as Candle[]), evaluator, initialCapital: "1000", feeRate: "0.001", slippageRate: "0.002", leverage: "1", funding: [], gapPolicy: "fail" as const, engineVersion: "1", configHash: "config", strategyHash: "strategy" };
  const first = await runHistoricalBacktest(request);
  const second = await runHistoricalBacktest(request);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(first.provenance.datasetDigest).toMatch(/^[a-f0-9]{64}$/);

  const reorderedDataset = { ...request.dataset, request: { interval: "1h", endTime: 10_800_000, symbol: "BTCUSDT", market: "spot" as const, startTime: 0 } };
  const reordered = await runHistoricalBacktest({ ...request, dataset: reorderedDataset });
  expect(reordered.provenance.datasetDigest).toBe(first.provenance.datasetDigest);
});
