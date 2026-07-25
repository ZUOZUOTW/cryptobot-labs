import type { DurableRunStore } from "./run-store";

export type AgentUpdateState = "disabled" | "idle" | "checking" | "downloading" | "downloaded"
  | "not-available" | "blocked" | "error";
export type AgentUpdateReason = "not-packaged" | "origin-unavailable" | "unsupported-platform"
  | "squirrel-first-run" | "live-running" | null;
export interface AgentUpdateStatus { state: AgentUpdateState; version: string | null; reason: AgentUpdateReason }

type UpdateEvent = "checking-for-update" | "update-available" | "update-not-available" | "update-downloaded" | "error";
type Listener = (...args: unknown[]) => void;
export interface AutoUpdaterAdapter {
  setFeedURL(options: { url: string; serverType?: "json" }): void;
  checkForUpdates(): void | Promise<void>;
  quitAndInstall(): void;
  on(event: UpdateEvent, listener: Listener): unknown;
  removeListener(event: UpdateEvent, listener: Listener): unknown;
}

export interface AgentUpdateService {
  status(): AgentUpdateStatus;
  check(): Promise<AgentUpdateStatus>;
  install(): Promise<void>;
  canStartLive(): boolean;
  beginLiveStart(): (() => void) | null;
  dispose(): void;
}

const VERSION = /^\d+\.\d+\.\d+$/;
const SQUIRREL_LIFECYCLE = new Set(["--squirrel-install", "--squirrel-updated", "--squirrel-uninstall",
  "--squirrel-obsolete"]);
export const isSquirrelLifecycleInvocation = (arguments_: readonly string[]): boolean =>
  arguments_.some((argument) => SQUIRREL_LIFECYCLE.has(argument));
const snapshot = (state: AgentUpdateState, version: string | null = null,
  reason: AgentUpdateReason = null): AgentUpdateStatus => Object.freeze({ state, version, reason });

export function createAgentUpdateService(dependencies: {
  updater: AutoUpdaterAdapter;
  runStore: Pick<DurableRunStore, "restore">;
  packaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  currentVersion: string;
  controlPlaneOrigin?: string;
  squirrelFirstRun?: boolean;
}): AgentUpdateService {
  let current = snapshot("idle");
  let disposed = false;
  let liveStartReservations = 0;
  const origin = (() => {
    if (!dependencies.controlPlaneOrigin) return null;
    try {
      const parsed = new URL(dependencies.controlPlaneOrigin);
      return parsed.protocol === "https:" && !parsed.username && !parsed.password && parsed.pathname === "/"
        && !parsed.search && !parsed.hash ? parsed.origin : null;
    } catch { return null; }
  })();
  const platform = dependencies.platform === "darwin" && ["arm64", "x64"].includes(dependencies.arch)
    ? `darwin-${dependencies.arch}` : dependencies.platform === "win32" && dependencies.arch === "x64"
      ? "win32-x64" : null;
  if (!dependencies.packaged) current = snapshot("disabled", null, "not-packaged");
  else if (!origin) current = snapshot("disabled", null, "origin-unavailable");
  else if (!platform || !VERSION.test(dependencies.currentVersion)) current = snapshot("disabled", null, "unsupported-platform");
  else if (dependencies.squirrelFirstRun) current = snapshot("blocked", null, "squirrel-first-run");

  const listeners: Record<UpdateEvent, Listener> = {
    "checking-for-update": () => { if (!disposed) current = snapshot("checking"); },
    "update-available": (...args) => { if (!disposed) {
      const candidate = args[0] as { version?: unknown } | undefined;
      current = snapshot("downloading", typeof candidate?.version === "string" && VERSION.test(candidate.version)
        ? candidate.version : null);
    } },
    "update-not-available": () => { if (!disposed) current = snapshot("not-available"); },
    "update-downloaded": (...args) => { if (!disposed) {
      const releaseName = args.find((value) => typeof value === "string" && VERSION.test(value)) as string | undefined;
      current = snapshot("downloaded", releaseName ?? current.version);
    } },
    error: () => { if (!disposed) current = snapshot("error"); },
  };
  for (const [event, listener] of Object.entries(listeners) as [UpdateEvent, Listener][]) {
    dependencies.updater.on(event, listener);
  }

  const liveRunning = async (): Promise<boolean> => {
    const record = await dependencies.runStore.restore();
    return record?.definition.mode === "live" && record.status === "running";
  };

  return {
    status: () => current,
    async check() {
      if (disposed) throw new Error("Update service is disposed");
      if (["disabled", "checking", "downloading", "downloaded"].includes(current.state)) return current;
      if (liveStartReservations > 0) { current = snapshot("blocked", null, "live-running"); return current; }
      current = snapshot("checking");
      if (await liveRunning()) { current = snapshot("blocked", null, "live-running"); return current; }
      const url = `${origin}/api/agent-updates/${platform}/${dependencies.currentVersion}/${platform!.startsWith("darwin-") ? "feed" : ""}`;
      dependencies.updater.setFeedURL(platform!.startsWith("darwin-") ? { url, serverType: "json" } : { url });
      try { await dependencies.updater.checkForUpdates(); }
      catch { current = snapshot("error"); }
      return current;
    },
    async install() {
      if (disposed || current.state !== "downloaded") throw new Error("A verified update is not ready");
      if (await liveRunning()) { current = snapshot("blocked", current.version, "live-running");
        throw new Error("Live execution must be paused before update installation"); }
      dependencies.updater.quitAndInstall();
    },
    canStartLive: () => !["checking", "downloading", "downloaded"].includes(current.state),
    beginLiveStart() {
      if (disposed || ["checking", "downloading", "downloaded"].includes(current.state)) return null;
      liveStartReservations += 1; let released = false;
      return () => { if (!released) { released = true; liveStartReservations -= 1; } };
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const [event, listener] of Object.entries(listeners) as [UpdateEvent, Listener][]) {
        dependencies.updater.removeListener(event, listener);
      }
    },
  };
}
