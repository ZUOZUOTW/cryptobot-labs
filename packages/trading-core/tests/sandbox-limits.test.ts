import { describe, expect, it } from "vitest";

import {
  BACKTEST_SANDBOX_BUDGET,
  LIVE_SANDBOX_BUDGET,
  createQuickJsStrategySandbox,
} from "../src/sandbox";
import type { StrategyInput } from "../src/contracts";

const input: Readonly<StrategyInput> = {
  candles: [],
  market: "spot",
  symbol: "BTCUSDT",
  now: 1_000,
};

describe("QuickJS sandbox resource limits", () => {
  it("publishes the required live and backtest budgets", () => {
    expect(LIVE_SANDBOX_BUDGET).toEqual({
      deadlineMs: 50,
      memoryBytes: 8 * 1024 * 1024,
      stackBytes: 512 * 1024,
      outputBytes: 16 * 1024,
    });
    expect(BACKTEST_SANDBOX_BUDGET).toEqual({
      ...LIVE_SANDBOX_BUDGET,
      deadlineMs: 250,
    });
  });

  it("interrupts an infinite loop at the deadline", async () => {
    const sandbox = await createQuickJsStrategySandbox(LIVE_SANDBOX_BUDGET);

    try {
      const started = performance.now();
      await expect(
        sandbox.evaluate({
          source: "export default () => { while (true) {} }",
          input,
          now: 1_000,
          randomSeed: "seed",
        }),
      ).rejects.toMatchObject({ code: "deadline-exceeded" });
      expect(performance.now() - started).toBeLessThan(1_000);
    } finally {
      await sandbox.dispose();
    }
  });

  it("fails closed under memory pressure", async () => {
    const sandbox = await createQuickJsStrategySandbox(LIVE_SANDBOX_BUDGET);

    try {
      await expect(
        sandbox.evaluate({
          source: "export default () => ({ action: 'hold', reason: String(new ArrayBuffer(16 * 1024 * 1024)) })",
          input,
          now: 1_000,
          randomSeed: "seed",
        }),
      ).rejects.toMatchObject({ code: "resource-exhausted" });

      await expect(
        sandbox.evaluate({
          source: "export default () => ({ action: 'hold', reason: 'late' })",
          input: { ...input, symbol: "x".repeat(2 * 1024 * 1024 + 1) },
          now: 1_000,
          randomSeed: "seed",
        }),
      ).rejects.toMatchObject({ code: "resource-exhausted" });
    } finally {
      await sandbox.dispose();
    }
  });

  it("rejects output above 16 KiB", async () => {
    const sandbox = await createQuickJsStrategySandbox(LIVE_SANDBOX_BUDGET);

    try {
      await expect(
        sandbox.evaluate({
          source: "export default () => ({ action: 'hold', reason: 'x'.repeat(17 * 1024) })",
          input,
          now: 1_000,
          randomSeed: "seed",
        }),
      ).rejects.toMatchObject({ code: "output-limit-exceeded" });
    } finally {
      await sandbox.dispose();
    }
  });

  it("checks UTF-8 output size inside the guest before exposing the string to the host", async () => {
    const sandbox = await createQuickJsStrategySandbox({
      ...LIVE_SANDBOX_BUDGET,
      outputBytes: 64,
    });

    try {
      await expect(
        sandbox.evaluate({
          source: "export default () => ({ action: 'hold', reason: '\u754c'.repeat(32) })",
          input,
          now: 1_000,
          randomSeed: "seed",
        }),
      ).rejects.toMatchObject({ code: "output-limit-exceeded" });
    } finally {
      await sandbox.dispose();
    }
  });

  it("rejects oversized source and input structures before creating a guest runtime", async () => {
    const sandbox = await createQuickJsStrategySandbox(LIVE_SANDBOX_BUDGET);

    try {
      await expect(
        sandbox.evaluate({
          source: `/* ${"x".repeat(256 * 1024)} */ export default () => ({ action: 'hold', reason: 'late' })`,
          input,
          now: 1_000,
          randomSeed: "seed",
        }),
      ).rejects.toMatchObject({ code: "resource-exhausted" });

      await expect(
        sandbox.evaluate({
          source: "export default () => ({ action: 'hold', reason: 'late' })",
          input: { ...input, candles: new Array(10_001).fill(null) },
          now: 1_000,
          randomSeed: "seed",
        }),
      ).rejects.toMatchObject({ code: "resource-exhausted" });
    } finally {
      await sandbox.dispose();
    }
  });

  it("uses a clean runtime after a fault", async () => {
    const sandbox = await createQuickJsStrategySandbox(LIVE_SANDBOX_BUDGET);

    try {
      await expect(
        sandbox.evaluate({
          source: "export default () => { globalThis.compromised = true; while (true) {} }",
          input,
          now: 1_000,
          randomSeed: "seed",
        }),
      ).rejects.toMatchObject({ code: "deadline-exceeded" });

      const recovered = await sandbox.evaluate({
        source: "export default () => ({ action: typeof compromised === 'undefined' ? 'hold' : 'buy', reason: 'clean' })",
        input,
        now: 2_000,
        randomSeed: "seed",
      });
      expect(recovered.signal.action).toBe("hold");
    } finally {
      await sandbox.dispose();
    }
  });

  it("rejects evaluation after disposal", async () => {
    const sandbox = await createQuickJsStrategySandbox(LIVE_SANDBOX_BUDGET);
    await sandbox.dispose();

    await expect(
      sandbox.evaluate({
        source: "export default () => ({ action: 'hold', reason: 'late' })",
        input,
        now: 1_000,
        randomSeed: "seed",
      }),
    ).rejects.toMatchObject({ code: "disposed" });
  });
});
