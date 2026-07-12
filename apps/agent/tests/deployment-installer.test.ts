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

const command = (): ControlCommand => ({ id: "cmd_1", deploymentId: "dep_1", type: "deploy", version: 1,
  correlationId: "corr_1", expectedDeploymentVersion: 2,
  payload: { configurationHash: "a".repeat(64), mode: "paper" }, createdAt: 100, expiresAt: 1_000 });

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
});
