import { describe, expect, it, vi } from "vitest";

import type { ControlCommand } from "../src/main/control-client";
import { DeploymentInstaller } from "../src/main/deployment-installer";
import type { DeploymentBundle } from "../src/main/deployment-client";
import type { DurableRunRecord, DurableRunState, DurableRunStore } from "../src/main/run-store";

const bundle = (overrides: Partial<DeploymentBundle["deployment"]> = {}): DeploymentBundle => ({
  schemaVersion: 1,
  deployment: { id: "dep_1", version: 2, strategyVersionId: "strategy_1", mode: "paper", state: "stopped",
    configurationHash: "a".repeat(64), ...overrides },
  strategy: { market: "spot", symbol: "BTCUSDT", configHash: "b".repeat(64), sourceHash: null,
    config: { blocks: [] }, source: null },
  risk: { id: "risk_1", allowedSymbols: ["BTCUSDT"], maxOrderNotional: "100", maxPositionNotional: "500",
    maxTotalExposure: "1000", maxSimultaneousPositions: 2, maxDailyLoss: "50", maxLeverage: "1",
    maxSlippageBps: 30, minSignalCooldownMs: 0, maxConsecutiveFailures: 3,
    operationMode: "approval-required", updatedAt: 100 },
});

const command = (overrides: Partial<ControlCommand> = {}): ControlCommand => ({ id: "cmd_1", deploymentId: "dep_1", type: "deploy", version: 1,
  correlationId: "corr_1", expectedDeploymentVersion: 2,
  payload: { configurationHash: "a".repeat(64), mode: "paper" }, createdAt: 100, expiresAt: 1_000, ...overrides });

function memoryStore(initial: DurableRunRecord | null = null): DurableRunStore & { saved: DurableRunState[] } {
  let record = initial;
  return { saved: [], async restore() { return record && { ...record, resumeAllowed: false as const,
    restoredStatus: record.status === "stopped" ? "stopped" as const : "paused" as const,
    restoredReason: record.status === "stopped" ? null : record.pausedReason ?? "restart-reconciliation-required" }; },
  async save(state, expectedVersion) { if ((record?.recordVersion ?? null) !== expectedVersion) throw new Error("version conflict");
    this.saved.push(state); record = { ...state, schemaVersion: 1, recordVersion: (record?.recordVersion ?? 0) + 1 }; return record; },
  async erase() { record = null; } };
}

describe("deployment installer", () => {
  it("fetches the fenced bundle and persists only paused execution metadata", async () => {
    const store = memoryStore();
    const fetchBundle = vi.fn(async () => bundle());
    const installer = new DeploymentInstaller({ deployments: { fetchBundle }, store, now: () => 500 });
    await expect(installer.deploymentVersion("dep_1")).resolves.toBeNull();
    await expect(installer.execute(command())).resolves.toEqual({ status: "ok", code: "installed" });
    await expect(installer.deploymentVersion("dep_1")).resolves.toBe(2);
    expect(fetchBundle).toHaveBeenCalledWith("dep_1", 2);
    expect(store.saved[0]).toEqual({ definition: { deploymentId: "dep_1", configurationVersion: "v2",
      scriptHash: "b".repeat(64), mode: "paper", market: "spot", symbol: "BTCUSDT" },
    status: "paused", pausedReason: "deployment-installed", ambiguousOrder: null, updatedAt: 500 });
    expect(JSON.stringify(store.saved)).not.toMatch(/source|apiKey|secret|passphrase/i);
  });

  it("rejects mismatched or unsafe bundles without writing state", async () => {
    const store = memoryStore();
    const installer = new DeploymentInstaller({ deployments: { fetchBundle: async () => bundle({ configurationHash: "c".repeat(64) }) }, store });
    await expect(installer.execute(command())).resolves.toEqual({ status: "rejected", code: "invalid_deployment" });
    expect(store.saved).toHaveLength(0);
  });

  it("resumes and pauses only after the runner lifecycle succeeds", async () => {
    const store = memoryStore(); const runner = { resume: vi.fn(async () => undefined), activate: vi.fn(async () => undefined), pause: vi.fn(async () => undefined) };
    const installer = new DeploymentInstaller({ deployments: { fetchBundle: async () => bundle() }, store, runner, now: () => 600 });
    await installer.execute(command());
    await expect(installer.execute(command({ id: "cmd_resume", type: "resume-paper", payload: { reason: "operator" } })))
      .resolves.toEqual({ status: "ok", code: "paper_resumed" });
    expect(runner.resume).toHaveBeenCalledOnce();
    expect(runner.activate).toHaveBeenCalledOnce();
    expect(store.saved.at(-1)).toMatchObject({ status: "running", pausedReason: null, updatedAt: 600 });
    await expect(installer.execute(command({ id: "cmd_pause", type: "pause", payload: { reason: "operator" } })))
      .resolves.toEqual({ status: "ok", code: "paused" });
    expect(runner.pause).toHaveBeenCalledOnce();
    expect(store.saved.at(-1)).toMatchObject({ status: "paused", pausedReason: "operator-paused" });
  });

  it("stages a locally verified live definition paused without starting a runner", async () => {
    const store = memoryStore();
    const runner = { resume: vi.fn(async () => undefined), activate: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined) };
    const prepare = vi.fn(async () => ({ deploymentId: "dep_1", configurationVersion: "v2",
      scriptHash: "b".repeat(64), mode: "live" as const, market: "spot" as const, symbol: "BTCUSDT" }));
    const installer = new DeploymentInstaller({ deployments: { fetchBundle: async () => bundle() }, store, runner,
      liveUnlock: { prepare }, now: () => 700 });
    await installer.execute(command());

    await expect(installer.execute(command({ id: "cmd_live", type: "request-live-unlock", payload: { revalidate: {} } })))
      .resolves.toEqual({ status: "ok", code: "live_unlock_staged" });
    expect(store.saved.at(-1)).toMatchObject({ definition: { mode: "live" }, status: "paused",
      pausedReason: "live-unlock-pending", updatedAt: 700 });
    expect(runner.resume).not.toHaveBeenCalled();
    expect(runner.activate).not.toHaveBeenCalled();
  });

  it("keeps the paper record unchanged when local live revalidation fails", async () => {
    const store = memoryStore();
    const installer = new DeploymentInstaller({ deployments: { fetchBundle: async () => bundle() }, store,
      liveUnlock: { prepare: async () => { throw new Error("unsafe permissions"); } } });
    await installer.execute(command());

    await expect(installer.execute(command({ type: "request-live-unlock", payload: { revalidate: {} } })))
      .rejects.toThrow("unsafe permissions");
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]).toMatchObject({ definition: { mode: "paper" }, status: "paused" });
  });

  it("starts and pauses the dedicated live runner only after the server bundle is live paused", async () => {
    const store = memoryStore();
    const liveRunner = { resume: vi.fn(async () => undefined), pause: vi.fn(async () => undefined) };
    const prepare = vi.fn(async () => ({ deploymentId: "dep_1", configurationVersion: "v2",
      scriptHash: "b".repeat(64), mode: "live" as const, market: "spot" as const, symbol: "BTCUSDT" }));
    let current = bundle();
    const installer = new DeploymentInstaller({ deployments: { fetchBundle: async () => current }, store,
      liveRunner, liveUnlock: { prepare }, now: () => 800 });
    await installer.execute(command());
    await installer.execute(command({ type: "request-live-unlock", payload: { revalidate: {} } }));
    current = bundle({ mode: "live", state: "paused" });

    await expect(installer.execute(command({ id: "cmd_resume_live", type: "resume-live",
      payload: { reason: "operator" } }))).resolves.toEqual({ status: "ok", code: "live_resumed" });
    expect(liveRunner.resume).toHaveBeenCalledWith(current);
    expect(store.saved.at(-1)).toMatchObject({ definition: { mode: "live" }, status: "running", pausedReason: null });
    await expect(installer.execute(command({ id: "cmd_pause_live", type: "pause", payload: { reason: "operator" } })))
      .resolves.toEqual({ status: "ok", code: "paused" });
    expect(liveRunner.pause).toHaveBeenCalledOnce();
  });

  it("stages and starts a futures Demo run only after the server acknowledges the mode transition",async()=>{
    const store=memoryStore();const liveRunner={resume:vi.fn(async()=>undefined),activate:vi.fn(async()=>undefined),
      pause:vi.fn(async()=>undefined),stopNewOrders:vi.fn(),cancelOpenOrders:vi.fn(),
      closePositions:vi.fn(async()=>({closed:1 as const}))};
    let current:DeploymentBundle={...bundle(),strategy:{...bundle().strategy,market:"futures",symbol:"BTCUSDT"}};
    const installer=new DeploymentInstaller({deployments:{fetchBundle:async()=>current},store,liveRunner,now:()=>850});
    await installer.execute(command());
    await expect(installer.execute(command({type:"enable-futures-demo",payload:{reason:"operator"}})))
      .resolves.toEqual({status:"ok",code:"demo_enabled"});
    expect(store.saved.at(-1)).toMatchObject({definition:{mode:"futures-demo",market:"futures"},status:"paused",
      pausedReason:"demo-enable-pending"});
    current={...current,deployment:{...current.deployment,mode:"futures-demo",state:"paused"}};
    await expect(installer.execute(command({type:"resume-demo",payload:{reason:"operator"}})))
      .resolves.toEqual({status:"ok",code:"demo_resumed"});
    expect(liveRunner.resume).toHaveBeenCalledWith(current);expect(liveRunner.activate).toHaveBeenCalledOnce();
    await expect(installer.execute(command({type:"stop-new-orders",payload:{reason:"emergency"}})))
      .resolves.toEqual({status:"ok",code:"new_orders_stopped"});
    await expect(installer.execute(command({type:"cancel-open-orders",payload:{scope:"deployment",reason:"emergency"}})))
      .resolves.toEqual({status:"rejected",code:"demo_cancel_unsupported"});
    expect(liveRunner.cancelOpenOrders).not.toHaveBeenCalled();
    await expect(installer.execute(command({type:"close-positions",payload:{scope:"all",symbol:null}})))
      .resolves.toEqual({status:"ok",code:"close_submitted"});
    await expect(installer.execute(command({type:"pause",payload:{reason:"operator"}})))
      .resolves.toEqual({status:"ok",code:"paused"});
    expect(liveRunner.pause).toHaveBeenCalledOnce();
  });

  it("refuses live start while an update owns the restart gate", async () => {
    const store = memoryStore(); const liveRunner = { resume: vi.fn(async () => undefined), pause: vi.fn(async () => undefined) };
    const prepare = vi.fn(async () => ({ deploymentId: "dep_1", configurationVersion: "v2",
      scriptHash: "b".repeat(64), mode: "live" as const, market: "spot" as const, symbol: "BTCUSDT" }));
    let current = bundle();
    const installer = new DeploymentInstaller({ deployments: { fetchBundle: async () => current }, store, liveRunner,
      liveUnlock: { prepare }, beginLiveStart: () => null });
    await installer.execute(command()); await installer.execute(command({ type: "request-live-unlock", payload: { revalidate: {} } }));
    current = bundle({ mode: "live", state: "paused" });
    await expect(installer.execute(command({ type: "resume-live", payload: { reason: "operator" } })))
      .resolves.toEqual({ status: "rejected", code: "update_pending" });
    expect(liveRunner.resume).not.toHaveBeenCalled();
  });

  it("routes independent live stop and cancel commands without treating them as position close", async () => {
    const store = memoryStore();
    const liveRunner = { resume: vi.fn(async () => undefined), pause: vi.fn(async () => undefined),
      stopNewOrders: vi.fn(), cancelOpenOrders: vi.fn(async () => ({ cancelled: 2, rejected: 0, unresolved: 0 })),
      closePositions: vi.fn(async () => ({ closed: 1 as const })) };
    const prepare = vi.fn(async () => ({ deploymentId: "dep_1", configurationVersion: "v2",
      scriptHash: "b".repeat(64), mode: "live" as const, market: "spot" as const, symbol: "BTCUSDT" }));
    let current = bundle();
    const installer = new DeploymentInstaller({ deployments: { fetchBundle: async () => current }, store,
      liveRunner, liveUnlock: { prepare } });
    await installer.execute(command()); await installer.execute(command({ type: "request-live-unlock", payload: { revalidate: {} } }));
    current = bundle({ mode: "live", state: "paused" });
    await installer.execute(command({ type: "resume-live", payload: { reason: "operator" } }));

    await expect(installer.execute(command({ type: "stop-new-orders", payload: { reason: "emergency" } })))
      .resolves.toEqual({ status: "ok", code: "new_orders_stopped" });
    await expect(installer.execute(command({ type: "cancel-open-orders", payload: { scope: "deployment", reason: "emergency" } })))
      .resolves.toEqual({ status: "ok", code: "open_orders_cancelled" });
    await expect(installer.execute(command({ type: "close-positions", payload: { scope: "all", symbol: null } })))
      .resolves.toEqual({ status: "ok", code: "close_submitted" });
    expect(liveRunner.stopNewOrders).toHaveBeenCalledOnce(); expect(liveRunner.cancelOpenOrders).toHaveBeenCalledOnce();
    expect(liveRunner.closePositions).toHaveBeenCalledWith("dep_1", null, "cmd_1");
  });

  it("revalidates a fenced connection and pauses execution before credential erasure", async () => {
    const store = memoryStore();
    const runner = { resume: vi.fn(async () => undefined), pause: vi.fn(async () => undefined) };
    const connectionControl = { revalidate: vi.fn(async () => undefined), erase: vi.fn(async () => undefined) };
    const installer = new DeploymentInstaller({ deployments: { fetchBundle: async () => bundle() }, store,
      runner, connectionControl, now: () => 900 });
    await installer.execute(command());
    await installer.execute(command({ type: "resume-paper", payload: { reason: "operator" } }));

    await expect(installer.execute(command({ type: "revalidate-connection", payload: {} })))
      .resolves.toEqual({ status: "ok", code: "connection_revalidated" });
    await expect(installer.execute(command({ type: "erase-local-credentials", payload: { reason: "operator" } })))
      .resolves.toEqual({ status: "ok", code: "credentials_erased" });
    expect(connectionControl.revalidate).toHaveBeenCalledOnce();
    expect(runner.pause).toHaveBeenCalledOnce();
    expect(store.saved.at(-1)).toMatchObject({ status: "paused", pausedReason: "credentials-erased" });
    expect(connectionControl.erase).toHaveBeenCalledOnce();
    expect(runner.pause.mock.invocationCallOrder[0]).toBeLessThan(connectionControl.erase.mock.invocationCallOrder[0]);
  });
});
