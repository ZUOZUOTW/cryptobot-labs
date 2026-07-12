import type {
  ExecutionContext,
  ExecutionOutcome,
  StrategyInput,
  StrategySignal,
} from "@cryptobot-labs/trading-core";
import { describe, expect, it, vi } from "vitest";

import {
  ExecutionRuntime,
  type RuntimeAuditEvent,
  type RuntimeDeployment,
} from "../src/runtime/execution-runtime";
import {
  StrategyWorker,
  StrategyWorkerFault,
  type StrategySandboxLike,
} from "../src/runtime/strategy-worker";

const deployment: RuntimeDeployment = {
  deploymentId: "deployment-1",
  configurationVersion: "configuration-7",
  scriptHash: "sha256:trusted",
  source: "export default () => ({ action: 'hold', reason: 'test' })",
};

const input: StrategyInput = {
  candles: [],
  market: "spot",
  symbol: "BTCUSDT",
  now: 1_000,
};

const context = {
  deploymentId: deployment.deploymentId,
  configurationVersion: deployment.configurationVersion,
  signalSequence: 1,
  market: "spot",
  mode: "paper",
  now: 1_000,
  riskContext: {
    market: "spot",
    symbol: "BTCUSDT",
    now: 1_000,
    leverage: "1",
  },
} as ExecutionContext;

const signal: StrategySignal = {
  id: "signal-1",
  action: "hold",
  reason: "deterministic-test",
  createdAt: 1_000,
};

const blocked: ExecutionOutcome = { status: "blocked", reason: "circuit-breaker" };

function sandbox(
  evaluate: StrategySandboxLike["evaluate"] = vi.fn(async () => ({
    signal,
    scriptHash: deployment.scriptHash,
    durationMs: 1,
  })),
) {
  return { evaluate, dispose: vi.fn(async () => undefined) } satisfies StrategySandboxLike;
}

function setup(candidate = sandbox(), timeoutMs = 50) {
  const propose = vi.fn(async () => blocked);
  const audit: RuntimeAuditEvent[] = [];
  const worker = new StrategyWorker(async () => candidate, timeoutMs);
  const runtime = new ExecutionRuntime({
    worker,
    coordinator: { propose },
    audit: async (event) => { audit.push(event); },
  });
  runtime.start(deployment);
  return { runtime, worker, propose, audit, candidate };
}

describe("StrategyWorker", () => {
  it("serializes sandbox evaluations", async () => {
    let active = 0;
    let maximum = 0;
    const candidate = sandbox(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return { signal, scriptHash: deployment.scriptHash, durationMs: 1 };
    });
    const worker = new StrategyWorker(async () => candidate);

    await Promise.all([
      worker.evaluate({ source: deployment.source, input, now: 1_000, randomSeed: "a" }),
      worker.evaluate({ source: deployment.source, input, now: 1_001, randomSeed: "b" }),
    ]);

    expect(maximum).toBe(1);
  });

  it("destroys and recreates a sandbox after an evaluation fault", async () => {
    const first = sandbox(vi.fn(async () => { throw new Error("untrusted details"); }));
    const second = sandbox();
    const factory = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const worker = new StrategyWorker(factory);
    const request = { source: deployment.source, input, now: 1_000, randomSeed: "seed" };

    await expect(worker.evaluate(request)).rejects.toMatchObject({ code: "sandbox-fault" });
    await expect(worker.evaluate(request)).resolves.toMatchObject({ scriptHash: deployment.scriptHash });
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("times out, disposes, and fences the old sandbox", async () => {
    const first = sandbox(() => new Promise(() => undefined));
    const second = sandbox();
    const factory = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const worker = new StrategyWorker(factory, 5);
    const request = { source: deployment.source, input, now: 1_000, randomSeed: "seed" };

    await expect(worker.evaluate(request)).rejects.toMatchObject({ code: "timeout" });
    await expect(worker.evaluate(request)).resolves.toMatchObject({ signal });
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it("cancels queued work without evaluating it", async () => {
    let release!: () => void;
    const candidate = sandbox(vi.fn(() => new Promise<
      Awaited<ReturnType<StrategySandboxLike["evaluate"]>>
    >((resolve) => {
      release = () => resolve({ signal, scriptHash: deployment.scriptHash, durationMs: 1 });
    })));
    const worker = new StrategyWorker(async () => candidate, 1_000);
    const request = { source: deployment.source, input, now: 1_000, randomSeed: "seed" };
    const first = worker.evaluate(request);
    const second = worker.evaluate(request);
    await vi.waitFor(() => expect(candidate.evaluate).toHaveBeenCalledOnce());
    const cancellation = worker.cancel();
    release();

    await cancellation;
    await expect(first).rejects.toBeInstanceOf(StrategyWorkerFault);
    await expect(second).rejects.toMatchObject({ code: "cancelled" });
    expect(candidate.evaluate).toHaveBeenCalledOnce();
  });
});

describe("ExecutionRuntime", () => {
  it("passes every sandbox signal through ExecutionCoordinator.propose", async () => {
    const { runtime, propose, candidate, audit } = setup();

    await expect(runtime.evaluate({ input, now: 1_000, randomSeed: "seed", context }))
      .resolves.toEqual({ status: "proposed", outcome: blocked });

    expect(propose).toHaveBeenCalledOnce();
    expect(propose).toHaveBeenCalledWith(signal, context);
    expect(candidate.evaluate).toHaveBeenCalledWith({
      source: deployment.source,
      input,
      now: 1_000,
      randomSeed: "seed",
    });
    const evaluate = vi.mocked(candidate.evaluate);
    expect(evaluate.mock.calls[0]?.[0]).not.toHaveProperty("credentials");
    expect(evaluate.mock.calls[0]?.[0]).not.toHaveProperty("exchange");
    expect(audit).toContainEqual(expect.objectContaining({ type: "signal-proposed" }));
  });

  it("rejects a configuration fence before sandbox evaluation", async () => {
    const { runtime, propose, candidate, audit } = setup();
    const staleContext = { ...context, configurationVersion: "configuration-old" };

    await expect(runtime.evaluate({ input, now: 1_000, randomSeed: "seed", context: staleContext }))
      .resolves.toEqual({ status: "discarded", reason: "stale" });

    expect(candidate.evaluate).not.toHaveBeenCalled();
    expect(propose).not.toHaveBeenCalled();
    expect(audit).toContainEqual(expect.objectContaining({
      type: "signal-discarded",
      reason: "context-version-mismatch",
    }));
  });

  it.each([
    ["market", { input: { ...input, market: "futures" as const } }],
    ["symbol", { input: { ...input, symbol: "ETHUSDT" } }],
    ["input time", { input: { ...input, now: 999 } }],
    ["evaluation time", { now: 999 }],
    ["risk market", {
      context: {
        ...context,
        riskContext: { ...context.riskContext, market: "futures" as const },
      },
    }],
    ["risk time", {
      context: {
        ...context,
        riskContext: { ...context.riskContext, now: 999 },
      },
    }],
    ["leverage", {
      input: { ...input, leverage: "2" },
    }],
  ])("rejects a %s context mismatch before sandbox evaluation", async (_label, override) => {
    const { runtime, propose, candidate, audit } = setup();
    const request = {
      input,
      now: 1_000,
      randomSeed: "seed",
      context,
      ...override,
    };

    await expect(runtime.evaluate(request))
      .resolves.toEqual({ status: "discarded", reason: "stale" });

    expect(candidate.evaluate).not.toHaveBeenCalled();
    expect(propose).not.toHaveBeenCalled();
    expect(audit).toContainEqual(expect.objectContaining({
      type: "signal-discarded",
      reason: "context-input-mismatch",
    }));
  });

  it("pauses and audits a script hash mismatch without proposing", async () => {
    const candidate = sandbox(vi.fn(async () => ({
      signal,
      scriptHash: "sha256:untrusted",
      durationMs: 1,
    })));
    const { runtime, propose, audit } = setup(candidate);

    await expect(runtime.evaluate({ input, now: 1_000, randomSeed: "seed", context }))
      .resolves.toEqual({ status: "paused", reason: "script-hash-mismatch" });
    expect(runtime.paused).toBe(true);
    expect(propose).not.toHaveBeenCalled();
    expect(audit).toContainEqual(expect.objectContaining({
      type: "strategy-paused",
      reason: "script-hash-mismatch",
    }));
  });

  it("discards a late sandbox result after stop", async () => {
    let release!: () => void;
    const candidate = sandbox(vi.fn(() => new Promise<
      Awaited<ReturnType<StrategySandboxLike["evaluate"]>>
    >((resolve) => {
      release = () => resolve({ signal, scriptHash: deployment.scriptHash, durationMs: 1 });
    })));
    const { runtime, propose } = setup(candidate, 1_000);
    const pending = runtime.evaluate({ input, now: 1_000, randomSeed: "seed", context });
    await vi.waitFor(() => expect(candidate.evaluate).toHaveBeenCalledOnce());
    const stopping = runtime.stop();
    release();

    await stopping;
    await expect(pending).resolves.toEqual({ status: "discarded", reason: "stale" });
    expect(propose).not.toHaveBeenCalled();
  });

  it("pauses and audits sandbox and coordinator faults", async () => {
    const failedSandbox = sandbox(vi.fn(async () => { throw new Error("sandbox secret"); }));
    const first = setup(failedSandbox);
    await expect(first.runtime.evaluate({ input, now: 1_000, randomSeed: "seed", context }))
      .resolves.toEqual({ status: "paused", reason: "sandbox-fault" });
    expect(first.audit).toContainEqual(expect.objectContaining({ reason: "sandbox-fault" }));
    expect(JSON.stringify(first.audit)).not.toContain("sandbox secret");

    const second = setup();
    second.propose.mockRejectedValueOnce(new Error("exchange secret"));
    await expect(second.runtime.evaluate({ input, now: 1_000, randomSeed: "seed", context }))
      .resolves.toEqual({ status: "paused", reason: "execution-coordinator-fault" });
    expect(JSON.stringify(second.audit)).not.toContain("exchange secret");
  });
});
