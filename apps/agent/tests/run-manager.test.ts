import { describe, expect, it, vi } from "vitest";

import type {
  ExecutionContext,
  InstrumentRules,
  StrategyInput,
} from "@cryptobot-labs/trading-core";
import { LocalEmergencyStop } from "../src/main/emergency-stop";
import { RunManager, type RunManagerDependencies } from "../src/main/run-manager";

const NOW = 1_800_000_000_000;
const rules: InstrumentRules = {
  market: "spot",
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  tickSize: "0.01",
  stepSize: "0.0001",
  minimumQuantity: "0.0001",
  minimumNotional: "5",
};
const input: StrategyInput = {
  market: "spot",
  symbol: "BTCUSDT",
  now: NOW,
  timeframe: "1m",
  candles: [{
    openTime: NOW - 60_000,
    closeTime: NOW,
    open: "100",
    high: "101",
    low: "99",
    close: "100",
    volume: "10",
    complete: true,
  }],
};
const context = {
  deploymentId: "dep-1",
  configurationVersion: "v1",
  signalSequence: 1,
  market: "spot",
  mode: "paper",
  referencePrice: "100",
  instrumentRules: rules,
  now: NOW,
  riskPolicy: {},
  riskContext: {
    market: "spot",
    symbol: "BTCUSDT",
    now: NOW,
    priceTimestamp: NOW,
    equity: "1000",
    dayStartEquity: "1000",
    openPositions: 0,
    totalExposure: "0",
    orderNotional: "10",
    positionNotionalAfter: "10",
    slippageRate: 0,
    lastSignalAt: null,
    consecutiveFailures: 0,
  },
} as unknown as ExecutionContext;

function setup(overrides: Partial<RunManagerDependencies> = {}) {
  const audit: unknown[] = [];
  const runtime = {
    start: vi.fn(),
    evaluate: vi.fn(async () => ({
      status: "proposed" as const,
      outcome: {
        status: "submitted" as const,
        order: { status: "acknowledged" },
      },
    })),
    stop: vi.fn(async () => undefined),
  };
  const dependencies: RunManagerDependencies = {
    market: { requireFresh: vi.fn(() => ({
      market: "spot" as const,
      symbol: "BTCUSDT",
      bid: "99",
      ask: "101",
      last: "100",
      exchangeTimestamp: NOW,
      receivedAt: NOW,
    })) },
    clock: { requireFresh: vi.fn() },
    connection: { requireFresh: vi.fn() },
    instruments: { requireFresh: vi.fn(() => rules) },
    reconciliation: { reconcileBeforeSubmit: vi.fn(async () => ({ ready: true as const })) },
    circuitBreaker: { canSubmit: vi.fn(() => true) },
    audit: vi.fn(async (event) => { audit.push(event); }),
    ...overrides,
    runtime: overrides.runtime ?? runtime as unknown as RunManagerDependencies["runtime"],
  };
  const manager = new RunManager(dependencies);
  manager.start({
    deployment: {
      deploymentId: "dep-1",
      configurationVersion: "v1",
      scriptHash: "a".repeat(64),
      source: "export default () => ({ action: 'hold', reason: 'test' })",
    },
    mode: "paper",
    market: "spot",
    symbol: "BTCUSDT",
  });
  return { manager, runtime, dependencies, audit };
}

describe("RunManager fail-closed execution", () => {
  it("checks fresh market, clock, instrument rules, breaker, and reconciliation before evaluating", async () => {
    const { manager, runtime, dependencies } = setup();

    await expect(manager.evaluate({ now: NOW, randomSeed: "seed", context, input }))
      .resolves.toMatchObject({ status: "proposed" });

    expect(dependencies.market.requireFresh).toHaveBeenCalled();
    expect(dependencies.clock.requireFresh).toHaveBeenCalledWith(NOW);
    expect(dependencies.instruments.requireFresh).toHaveBeenCalled();
    expect(dependencies.reconciliation.reconcileBeforeSubmit).toHaveBeenCalled();
    expect(runtime.evaluate).toHaveBeenCalledOnce();
  });

  it("requires a verified local connection for futures demo and live, but not paper", async () => {
    const paper = setup();
    await paper.manager.evaluate({ now: NOW, randomSeed: "seed", context, input });
    expect(paper.dependencies.connection.requireFresh).not.toHaveBeenCalled();

    const live = setup();
    await live.manager.stop();
    live.manager.start({
      deployment: {
        deploymentId: "dep-1", configurationVersion: "v1",
        scriptHash: "a".repeat(64), source: "source",
      },
      mode: "live", market: "spot", symbol: "BTCUSDT",
    });
    await live.manager.evaluate({
      now: NOW,
      randomSeed: "seed",
      input,
      context: { ...context, mode: "live" },
    });
    expect(live.dependencies.connection.requireFresh).toHaveBeenCalledWith(
      { market: "spot", mode: "live" }, NOW,
    );
  });

  it.each([
    ["market-data-stale", { market: { requireFresh: vi.fn(() => { throw new Error("stale"); }) } }],
    ["clock-unsynchronised", { clock: { requireFresh: vi.fn(() => { throw new Error("secret=bad"); }) } }],
    ["circuit-breaker-open", { circuitBreaker: { canSubmit: vi.fn(() => false) } }],
    ["reconciliation-required", { reconciliation: { reconcileBeforeSubmit: vi.fn(async () => ({ ready: false as const, reason: "unknown-order" })) } }],
  ] as const)("pauses before strategy execution on %s", async (reason, override) => {
    const { manager, runtime, audit } = setup(override as Partial<RunManagerDependencies>);
    await expect(manager.evaluate({ now: NOW, randomSeed: "seed", context, input }))
      .resolves.toEqual({ status: "paused", reason });
    expect(runtime.evaluate).not.toHaveBeenCalled();
    expect(JSON.stringify(audit)).not.toMatch(/secret=bad/i);
  });

  it("never resubmits an ambiguous order and requires reconciliation", async () => {
    const { manager, runtime } = setup();
    runtime.evaluate.mockResolvedValueOnce({
      status: "proposed",
      outcome: { status: "submitted", order: { status: "unknown" } },
    } as never);

    await expect(manager.evaluate({ now: NOW, randomSeed: "seed", context, input }))
      .resolves.toEqual({ status: "paused", reason: "ambiguous-order" });
    await expect(manager.evaluate({ now: NOW + 1, randomSeed: "seed", context, input }))
      .resolves.toEqual({ status: "paused", reason: "ambiguous-order" });
    expect(runtime.evaluate).toHaveBeenCalledOnce();
  });

  it("rejects spot futures-demo and mismatched trusted context", async () => {
    const { manager } = setup();
    await manager.stop();
    expect(() => manager.start({
      deployment: {
        deploymentId: "dep-1", configurationVersion: "v1",
        scriptHash: "a".repeat(64), source: "source",
      },
      mode: "futures-demo", market: "spot", symbol: "BTCUSDT",
    })).toThrow(/futures/i);

    const active = setup();
    await expect(active.manager.evaluate({
      now: NOW, randomSeed: "seed", input, context: { ...context, market: "futures" },
    })).resolves.toEqual({ status: "paused", reason: "context-mismatch" });
    expect(active.runtime.evaluate).not.toHaveBeenCalled();
  });

  it("does not let queued work from an old generation execute in a restarted run", async () => {
    let release!: () => void;
    let markEntered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const reconciliation = vi.fn()
      .mockImplementationOnce(async () => {
        markEntered();
        await blocked;
        return { ready: true as const };
      })
      .mockResolvedValue({ ready: true as const });
    const { manager, runtime } = setup({ reconciliation: { reconcileBeforeSubmit: reconciliation } });

    const first = manager.evaluate({ now: NOW, randomSeed: "first", context, input });
    const queued = manager.evaluate({ now: NOW, randomSeed: "queued", context, input });
    await entered;
    await manager.stop();
    manager.start({
      deployment: {
        deploymentId: "dep-1", configurationVersion: "v1",
        scriptHash: "a".repeat(64), source: "source",
      },
      mode: "paper", market: "spot", symbol: "BTCUSDT",
    });
    release();

    await expect(first).resolves.toMatchObject({ status: "paused" });
    await expect(queued).resolves.toMatchObject({ status: "paused" });
    expect(runtime.evaluate).not.toHaveBeenCalled();
  });

  it("binds risk pricing to the trusted quote and latest candle timeline", async () => {
    const staleRisk = setup();
    await expect(staleRisk.manager.evaluate({
      now: NOW, randomSeed: "seed", input,
      context: { ...context, riskContext: { ...context.riskContext, priceTimestamp: NOW - 1 } },
    })).resolves.toEqual({ status: "paused", reason: "market-context-mismatch" });
    expect(staleRisk.runtime.evaluate).not.toHaveBeenCalled();

    const futureCandle = setup();
    await expect(futureCandle.manager.evaluate({
      now: NOW, randomSeed: "seed",
      input: { ...input, candles: [{ ...input.candles[0], closeTime: NOW + 1 }] },
      context,
    })).resolves.toEqual({ status: "paused", reason: "market-context-mismatch" });
    expect(futureCandle.runtime.evaluate).not.toHaveBeenCalled();

    const staleCandle = setup();
    await expect(staleCandle.manager.evaluate({
      now: NOW, randomSeed: "seed",
      input: { ...input, candles: [{ ...input.candles[0], openTime: NOW - 240_000, closeTime: NOW - 180_000 }] },
      context,
    })).resolves.toEqual({ status: "paused", reason: "market-context-mismatch" });
    expect(staleCandle.runtime.evaluate).not.toHaveBeenCalled();

    const reordered = setup();
    await expect(reordered.manager.evaluate({
      now: NOW, randomSeed: "seed",
      input: {
        ...input,
        candles: [
          input.candles[0],
          { ...input.candles[0], openTime: NOW - 240_000, closeTime: NOW - 180_000 },
        ],
      },
      context,
    })).resolves.toEqual({ status: "paused", reason: "market-context-mismatch" });
    expect(reordered.runtime.evaluate).not.toHaveBeenCalled();
  });
});

describe("LocalEmergencyStop", () => {
  it("latches new-order blocking locally without cancelling or closing anything", async () => {
    const coordinator = {
      emergencyStop: vi.fn(),
      cancelOpenOrders: vi.fn(async () => ({ cancelled: 0, rejected: 0, unresolved: 0, skipped: 0 })),
    };
    const runControl = { latchEmergency: vi.fn(async () => undefined) };
    const closer = { closePositions: vi.fn(async () => ({ closed: 1 })) };
    const emergency = new LocalEmergencyStop({
      coordinator, runControl, closer, audit: vi.fn(async () => undefined),
    });

    await emergency.stopNewOrders("dep-1", NOW);
    expect(coordinator.emergencyStop).toHaveBeenCalledOnce();
    expect(runControl.latchEmergency).toHaveBeenCalledOnce();
    expect(coordinator.cancelOpenOrders).not.toHaveBeenCalled();
    expect(closer.closePositions).not.toHaveBeenCalled();
  });

  it("requires distinct exact confirmations for cancellation and position closing", async () => {
    const coordinator = {
      emergencyStop: vi.fn(),
      cancelOpenOrders: vi.fn(async () => ({ cancelled: 2, rejected: 0, unresolved: 0, skipped: 0 })),
    };
    const closer = { closePositions: vi.fn(async () => ({ closed: 1 })) };
    const emergency = new LocalEmergencyStop({
      coordinator,
      runControl: { latchEmergency: vi.fn(async () => undefined) },
      closer,
      audit: vi.fn(async () => undefined),
    });

    await expect(emergency.cancelOpenOrders("dep-1", NOW, "wrong")).rejects.toThrow(/confirmation/i);
    await emergency.cancelOpenOrders("dep-1", NOW, "CANCEL OPEN ORDERS");
    expect(coordinator.cancelOpenOrders).toHaveBeenCalledOnce();
    expect(closer.closePositions).not.toHaveBeenCalled();

    await expect(emergency.closePositions("dep-1", NOW, "wrong")).rejects.toThrow(/confirmation/i);
    await emergency.closePositions("dep-1", NOW, "CLOSE POSITIONS");
    expect(closer.closePositions).toHaveBeenCalledOnce();
  });
});
