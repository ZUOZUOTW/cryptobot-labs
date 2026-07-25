import { describe, expect, it, vi } from "vitest";

import { createAgentUpdateService, isSquirrelLifecycleInvocation, type AutoUpdaterAdapter } from "../src/main/update-service";
import type { DurableRunRecord } from "../src/main/run-store";

function updater() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const value: AutoUpdaterAdapter = { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), quitAndInstall: vi.fn(),
    on: vi.fn((event, listener) => { listeners.set(event, listener); }),
    removeListener: vi.fn((event) => { listeners.delete(event); }) };
  return { value, emit: (event: string, ...args: unknown[]) => listeners.get(event)?.(...args) };
}
const run = (mode: "paper" | "live", status: "running" | "paused"): DurableRunRecord => ({ schemaVersion: 1,
  recordVersion: 1, definition: { deploymentId: "dep_1", configurationVersion: "v1", scriptHash: "a".repeat(64),
    mode, market: "spot", symbol: "BTCUSDT" }, status, pausedReason: null, ambiguousOrder: null, updatedAt: 1 });

describe("Agent update service", () => {
  it("recognizes Squirrel maintenance launches without treating first run as maintenance", () => {
    expect(isSquirrelLifecycleInvocation(["agent.exe", "--squirrel-updated"])).toBe(true);
    expect(isSquirrelLifecycleInvocation(["agent.exe", "--squirrel-firstrun"])).toBe(false);
  });
  it("uses only the allowlisted HTTPS control-plane update endpoint", async () => {
    const adapter = updater(); const service = createAgentUpdateService({ updater: adapter.value,
      runStore: { restore: async () => null }, packaged: true, platform: "darwin", arch: "arm64",
      currentVersion: "1.2.3", controlPlaneOrigin: "https://labs.example/" });
    await service.check();
    expect(adapter.value.setFeedURL).toHaveBeenCalledWith({
      url: "https://labs.example/api/agent-updates/darwin-arm64/1.2.3/feed", serverType: "json" });
    expect(adapter.value.checkForUpdates).toHaveBeenCalledOnce();
    const unsafe = createAgentUpdateService({ updater: updater().value, runStore: { restore: async () => null },
      packaged: true, platform: "darwin", arch: "arm64", currentVersion: "1.2.3",
      controlPlaneOrigin: "http://labs.example/" });
    expect(unsafe.status()).toEqual({ state: "disabled", version: null, reason: "origin-unavailable" });
  });

  it("blocks checking, installation, and live resume across update races", async () => {
    let record: DurableRunRecord | null = run("live", "running"); const adapter = updater();
    const service = createAgentUpdateService({ updater: adapter.value, runStore: { restore: async () => record as never },
      packaged: true, platform: "win32", arch: "x64", currentVersion: "1.2.3",
      controlPlaneOrigin: "https://labs.example/" });
    await expect(service.check()).resolves.toEqual({ state: "blocked", version: null, reason: "live-running" });
    expect(adapter.value.checkForUpdates).not.toHaveBeenCalled();
    record = run("live", "paused"); await service.check();
    expect(adapter.value.setFeedURL).toHaveBeenCalledWith({ url: "https://labs.example/api/agent-updates/win32-x64/1.2.3/" });
    adapter.emit("update-available", { version: "1.2.4" }); expect(service.canStartLive()).toBe(false);
    adapter.emit("update-downloaded", {}, "notes", "1.2.4");
    record = run("live", "running"); await expect(service.install()).rejects.toThrow(/paused/);
    expect(adapter.value.quitAndInstall).not.toHaveBeenCalled();
    record = run("live", "paused"); adapter.emit("update-downloaded", {}, "notes", "1.2.4");
    await service.install(); expect(adapter.value.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("serializes update checks against a live-start reservation", async () => {
    const adapter = updater(); const service = createAgentUpdateService({ updater: adapter.value,
      runStore: { restore: async () => null }, packaged: true, platform: "darwin", arch: "x64",
      currentVersion: "1.2.3", controlPlaneOrigin: "https://labs.example/" });
    const release = service.beginLiveStart(); expect(release).not.toBeNull();
    await expect(service.check()).resolves.toEqual({ state: "blocked", version: null, reason: "live-running" });
    expect(adapter.value.checkForUpdates).not.toHaveBeenCalled(); release!();
    await service.check(); expect(adapter.value.checkForUpdates).toHaveBeenCalledOnce();
  });
});
