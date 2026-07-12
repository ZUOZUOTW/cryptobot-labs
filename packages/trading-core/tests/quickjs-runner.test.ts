import { describe, expect, it } from "vitest";

import {
  LIVE_SANDBOX_BUDGET,
  createQuickJsStrategySandbox,
  sha256ScriptHash,
} from "../src/sandbox";
import type { StrategyInput } from "../src/contracts";

const input: Readonly<StrategyInput> = {
  candles: [],
  market: "spot",
  symbol: "BTCUSDT",
  now: 1_000,
};

const holdSource = "export default () => ({ action: 'hold', reason: 'ok' })";
const FUNCTIONAL_TEST_BUDGET = { ...LIVE_SANDBOX_BUDGET, deadlineMs: 500 };

describe("QuickJS strategy sandbox", () => {
  it.each([
    "fetch",
    "WebSocket",
    "process",
    "require",
    "Deno",
    "Bun",
    "XMLHttpRequest",
  ])("does not expose %s to custom strategy code", async (name) => {
    const sandbox = await createQuickJsStrategySandbox(FUNCTIONAL_TEST_BUDGET);

    try {
      const result = await sandbox.evaluate({
        source:
          "export default () => ({ action: typeof " +
          name +
          " === 'undefined' ? 'hold' : 'buy', reason: 'capability-check' })",
        input,
        now: 1_000,
        randomSeed: "seed",
      });

      expect(result.signal.action).toBe("hold");
    } finally {
      await sandbox.dispose();
    }
  });

  it("rejects module imports instead of resolving host capabilities", async () => {
    const sandbox = await createQuickJsStrategySandbox(FUNCTIONAL_TEST_BUDGET);

    try {
      await expect(
        sandbox.evaluate({
          source: "import fs from 'node:fs'; export default () => ({ action: 'hold', reason: String(fs) })",
          input,
          now: 1_000,
          randomSeed: "seed",
        }),
      ).rejects.toMatchObject({ code: "execution-failed" });
    } finally {
      await sandbox.dispose();
    }
  });

  it("passes a detached, deeply frozen input", async () => {
    const mutableInput: StrategyInput = {
      ...input,
      candles: [
        {
          openTime: 0,
          closeTime: 1,
          open: "1",
          high: "1",
          low: "1",
          close: "1",
          volume: "1",
          complete: true,
        },
      ],
    };
    const sandbox = await createQuickJsStrategySandbox(FUNCTIONAL_TEST_BUDGET);

    try {
      const result = await sandbox.evaluate({
        source: `export default (input) => {
          let frozen = Object.isFrozen(input) && Object.isFrozen(input.candles) && Object.isFrozen(input.candles[0]);
          try { input.symbol = 'ETHUSDT'; } catch {}
          try { input.candles[0].close = '999'; } catch {}
          return { action: frozen && input.symbol === 'BTCUSDT' && input.candles[0].close === '1' ? 'hold' : 'buy', reason: 'immutability' };
        }`,
        input: mutableInput,
        now: 1_000,
        randomSeed: "seed",
      });

      expect(result.signal.action).toBe("hold");
      expect(mutableInput.symbol).toBe("BTCUSDT");
      expect(mutableInput.candles[0]?.close).toBe("1");
    } finally {
      await sandbox.dispose();
    }
  });

  it("makes Date.now and Math.random deterministic for the supplied seed", async () => {
    const sandbox = await createQuickJsStrategySandbox(FUNCTIONAL_TEST_BUDGET);
    const source = `export default () => ({
      action: 'hold',
      reason: [Date.now(), new Date().getTime(), Math.random(), Math.random()].join(':')
    })`;

    try {
      const first = await sandbox.evaluate({ source, input, now: 42_000, randomSeed: "same" });
      const second = await sandbox.evaluate({ source, input, now: 42_000, randomSeed: "same" });
      const changed = await sandbox.evaluate({ source, input, now: 42_000, randomSeed: "different" });

      expect(first.signal.reason).toBe(second.signal.reason);
      expect(first.signal.reason.startsWith("42000:42000:")).toBe(true);
      expect(changed.signal.reason).not.toBe(first.signal.reason);
    } finally {
      await sandbox.dispose();
    }
  });

  it("returns a strict, trusted StrategySignal and rejects extra output fields", async () => {
    const sandbox = await createQuickJsStrategySandbox(FUNCTIONAL_TEST_BUDGET);

    try {
      const result = await sandbox.evaluate({
        source: "export default () => ({ action: 'buy', reason: 'entry', allocationRate: 0.25 })",
        input,
        now: 7_000,
        randomSeed: "seed",
      });

      expect(result.signal).toEqual({
        id: `sandbox-${result.scriptHash.slice(0, 16)}-7000`,
        action: "buy",
        reason: "entry",
        createdAt: 7_000,
        allocationRate: 0.25,
      });
      await expect(
        sandbox.evaluate({
          source: "export default () => ({ action: 'hold', reason: 'no', credentials: 'leak' })",
          input,
          now: 7_000,
          randomSeed: "seed",
        }),
      ).rejects.toMatchObject({ code: "invalid-signal" });
    } finally {
      await sandbox.dispose();
    }
  });

  it("computes a stable SHA-256 hash from the exact script bytes", async () => {
    await expect(sha256ScriptHash("")).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );

    const sandbox = await createQuickJsStrategySandbox(FUNCTIONAL_TEST_BUDGET);
    try {
      const first = await sandbox.evaluate({ source: holdSource, input, now: 1, randomSeed: "a" });
      const second = await sandbox.evaluate({ source: holdSource, input, now: 2, randomSeed: "b" });
      const different = await sandbox.evaluate({ source: `${holdSource} `, input, now: 1, randomSeed: "a" });

      expect(first.scriptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(second.scriptHash).toBe(first.scriptHash);
      expect(different.scriptHash).not.toBe(first.scriptHash);
    } finally {
      await sandbox.dispose();
    }
  });
});
