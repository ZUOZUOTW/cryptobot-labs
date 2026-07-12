import { describe, expect, it } from "vitest";

import { SignalIntentNormalizer, type ExecutionContext } from "../src";
import { context, instrument, policy } from "./fixtures/risk";

const execution = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
  deploymentId: "dep-1", configurationVersion: "v1", signalSequence: 1, market: "spot", mode: "paper",
  referencePrice: "1000.09", riskPolicy: policy, riskContext: context, instrumentRules: instrument, now: 10_000,
  ...overrides,
});

describe("signal intent normalizer", () => {
  it("sizes entries from the risk envelope and floors exchange precision", async () => {
    const normalizer = new SignalIntentNormalizer();
    await expect(normalizer.normalize({ id: "sig-1", action: "buy", reason: "entry", createdAt: 10_000,
      allocationRate: 0.5 }, execution())).resolves.toEqual({ symbol: "BTCUSDT", side: "buy", quantity: "0.05",
      price: "1000", expectedSlippageBps: "50", reduceOnly: false });
  });

  it("turns close and reductions into explicit reduce-only intents", async () => {
    const normalizer = new SignalIntentNormalizer();
    await expect(normalizer.normalize({ id: "sig-close", action: "close", reason: "risk", createdAt: 10_000 }, execution()))
      .resolves.toMatchObject({ side: "sell", quantity: "0.05", reduceOnly: true });
    await expect(normalizer.normalize({ id: "sig-reduce", action: "sell", reason: "grid", createdAt: 10_000,
      positionEffect: "reduce", reductionRate: 0.5 }, execution())).resolves.toMatchObject({ side: "sell", quantity: "0.025", reduceOnly: true });
  });

  it("rejects holds, stale signals, flat reductions, and below-minimum orders", async () => {
    const normalizer = new SignalIntentNormalizer();
    await expect(normalizer.normalize({ id: "hold", action: "hold", reason: "none", createdAt: 10_000 }, execution())).rejects.toThrow();
    await expect(normalizer.normalize({ id: "stale", action: "buy", reason: "old", createdAt: 9_999 }, execution())).rejects.toThrow();
    await expect(normalizer.normalize({ id: "reduce", action: "sell", reason: "bad", createdAt: 10_000,
      positionEffect: "reduce", reductionRate: 1 }, execution({ riskContext: { ...context, positionSide: "flat",
      currentPositionQuantity: "0", currentPositionNotional: "0" } }))).rejects.toThrow(/flat/i);
    await expect(normalizer.normalize({ id: "tiny", action: "buy", reason: "tiny", createdAt: 10_000,
      allocationRate: 0.001 }, execution())).rejects.toThrow(/minimum/i);
  });
});
