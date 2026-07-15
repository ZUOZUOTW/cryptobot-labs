import type { CommandExecutionResult, ControlCommand } from "./control-client";
import type { DeploymentBundle } from "./deployment-client";
import type { DurableRunRecord, DurableRunStore } from "./run-store";

export interface DeploymentInstallerDependencies {
  readonly deployments: { fetchBundle(deploymentId: string, expectedVersion: number): Promise<DeploymentBundle> };
  readonly store: DurableRunStore;
  readonly runner?: {
    resume(bundle: DeploymentBundle): Promise<void>;
    activate?(): Promise<void>;
    pause(): Promise<void>;
  };
  readonly liveRunner?: {
    resume(bundle: DeploymentBundle): Promise<void>;
    activate?(): Promise<void>;
    pause(): Promise<void>;
    stopNewOrders?(deploymentId: string): void | Promise<void>;
    cancelOpenOrders?(deploymentId: string): Promise<{ rejected: number; unresolved: number }>;
    closePositions?(deploymentId: string, symbol: string | null, commandId: string): Promise<
      { closed: 0; reason: "flat" | "risk-rejected" } | { closed: 1 }>;
  };
  readonly liveUnlock?: {
    prepare(command: ControlCommand & { type: "request-live-unlock" }): Promise<DurableRunRecord["definition"]>;
  };
  readonly connectionControl?: {
    revalidate(command: ControlCommand): Promise<void>;
    erase(command: ControlCommand): Promise<void>;
  };
  readonly beginLiveStart?: () => (() => void) | null;
  readonly now?: () => number;
}

const versionText = (version: number): string => `v${version}`;

function storedVersion(record: DurableRunRecord | null, deploymentId: string): number | null {
  if (!record || record.definition.deploymentId !== deploymentId) return null;
  const match = /^v([1-9]\d*)$/.exec(record.definition.configurationVersion);
  if (!match) throw new Error("Stored deployment version is invalid");
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) throw new Error("Stored deployment version is invalid");
  return version;
}

/** Installs authenticated deployment metadata; starting execution remains a separate command. */
export class DeploymentInstaller {
  readonly #dependencies: DeploymentInstallerDependencies;
  readonly #now: () => number;
  #record: DurableRunRecord | null = null;
  #initialization: Promise<void> | null = null;

  constructor(dependencies: DeploymentInstallerDependencies) {
    this.#dependencies = dependencies;
    this.#now = dependencies.now ?? Date.now;
  }

  async initialize(): Promise<void> {
    if (!this.#initialization) {
      this.#initialization = this.#dependencies.store.restore().then((record) => { this.#record = record; });
    }
    return this.#initialization;
  }

  async deploymentVersion(deploymentId: string): Promise<number | null> {
    await this.initialize();
    return storedVersion(this.#record, deploymentId);
  }

  async execute(command: ControlCommand): Promise<CommandExecutionResult> {
    await this.initialize();
    if (command.type === "resume-paper") return this.#resume(command);
    if (command.type === "resume-demo") return this.#resumePrivate(command, "futures-demo");
    if (command.type === "resume-live") return this.#resumePrivate(command, "live");
    if (command.type === "enable-futures-demo") return this.#enableDemo(command);
    if (command.type === "pause") return this.#pause(command);
    if (command.type === "request-live-unlock") {
      return this.#unlock(command as ControlCommand & { type: "request-live-unlock" });
    }
    if (command.type === "stop-new-orders") return this.#stopNewOrders(command);
    if (command.type === "cancel-open-orders") return this.#cancelOpenOrders(command);
    if (command.type === "close-positions") return this.#closePositions(command);
    if (command.type === "revalidate-connection") return this.#revalidateConnection(command);
    if (command.type === "erase-local-credentials") return this.#eraseCredentials(command);
    if (command.type !== "deploy") return { status: "rejected", code: "command_not_ready" };
    const payload = command.payload;
    if (payload.mode !== "paper" || typeof payload.configurationHash !== "string") {
      return { status: "rejected", code: "invalid_deployment" };
    }
    const currentVersion = storedVersion(this.#record, command.deploymentId);
    if (currentVersion !== null && currentVersion > command.expectedDeploymentVersion) {
      return { status: "rejected", code: "deployment_fence" };
    }
    const bundle = await this.#dependencies.deployments.fetchBundle(
      command.deploymentId,
      command.expectedDeploymentVersion,
    );
    if (bundle.deployment.mode !== "paper" || bundle.deployment.state !== "stopped" ||
        bundle.deployment.configurationHash !== payload.configurationHash || bundle.risk === null ||
        !bundle.risk.allowedSymbols.includes(bundle.strategy.symbol)) {
      return { status: "rejected", code: "invalid_deployment" };
    }
    const scriptHash = bundle.strategy.sourceHash ?? bundle.strategy.configHash;
    const definition = Object.freeze({
      deploymentId: bundle.deployment.id,
      configurationVersion: versionText(bundle.deployment.version),
      scriptHash,
      mode: bundle.deployment.mode,
      market: bundle.strategy.market,
      symbol: bundle.strategy.symbol,
    });
    if (this.#record && this.#record.definition.deploymentId !== command.deploymentId &&
        this.#record.status !== "stopped") {
      return { status: "rejected", code: "agent_capacity" };
    }
    if (currentVersion === command.expectedDeploymentVersion) {
      const existing = this.#record!.definition;
      return existing.configurationVersion === definition.configurationVersion &&
        existing.scriptHash === definition.scriptHash && existing.mode === definition.mode &&
        existing.market === definition.market && existing.symbol === definition.symbol
        ? { status: "ok", code: "already_installed" }
        : { status: "rejected", code: "deployment_fence" };
    }
    const updatedAt = this.#now();
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) throw new Error("Invalid deployment clock");
    this.#record = await this.#dependencies.store.save({
      definition,
      status: "paused",
      pausedReason: "deployment-installed",
      ambiguousOrder: null,
      updatedAt,
    }, this.#record?.recordVersion ?? null);
    return { status: "ok", code: "installed" };
  }

  async #resume(command: ControlCommand): Promise<CommandExecutionResult> {
    const record = this.#record;
    if (!record || storedVersion(record, command.deploymentId) !== command.expectedDeploymentVersion ||
        record.definition.mode !== "paper" || record.status !== "paused" || record.ambiguousOrder !== null) {
      return { status: "rejected", code: "deployment_fence" };
    }
    const runner = this.#dependencies.runner;
    if (!runner) return { status: "rejected", code: "runtime_not_ready" };
    const bundle = await this.#dependencies.deployments.fetchBundle(command.deploymentId, command.expectedDeploymentVersion);
    if (bundle.deployment.mode !== "paper" || bundle.strategy.market !== record.definition.market ||
        bundle.strategy.symbol !== record.definition.symbol ||
        (bundle.strategy.sourceHash ?? bundle.strategy.configHash) !== record.definition.scriptHash ||
        bundle.risk === null || !bundle.risk.allowedSymbols.includes(bundle.strategy.symbol)) {
      return { status: "rejected", code: "deployment_fence" };
    }
    await runner.resume(bundle);
    try {
      this.#record = await this.#dependencies.store.save({ definition: record.definition, status: "running",
        pausedReason: null, ambiguousOrder: null, updatedAt: this.#timestamp() }, record.recordVersion);
      await runner.activate?.();
    } catch (error) {
      await runner.pause().catch(() => undefined);
      if (this.#record?.status === "running") {
        this.#record = await this.#dependencies.store.save({ definition: this.#record.definition, status: "paused",
          pausedReason: "runtime-start-failed", ambiguousOrder: null, updatedAt: this.#timestamp() }, this.#record.recordVersion);
      }
      throw error;
    }
    return { status: "ok", code: "paper_resumed" };
  }

  async #pause(command: ControlCommand): Promise<CommandExecutionResult> {
    const record = this.#record;
    if (!record || storedVersion(record, command.deploymentId) !== command.expectedDeploymentVersion) {
      return { status: "rejected", code: "deployment_fence" };
    }
    if (record.status === "paused") return { status: "ok", code: "already_paused" };
    const runner = record.definition.mode === "paper" ? this.#dependencies.runner : this.#dependencies.liveRunner;
    if (!runner) return { status: "rejected", code: "runtime_not_ready" };
    await runner.pause();
    this.#record = await this.#dependencies.store.save({ definition: record.definition, status: "paused",
      pausedReason: "operator-paused", ambiguousOrder: record.ambiguousOrder, updatedAt: this.#timestamp() }, record.recordVersion);
    return { status: "ok", code: "paused" };
  }

  async #resumePrivate(command: ControlCommand, mode: "live" | "futures-demo"): Promise<CommandExecutionResult> {
    const record = this.#record;
    if (!record || storedVersion(record, command.deploymentId) !== command.expectedDeploymentVersion ||
        record.definition.mode !== mode || record.status !== "paused" || record.ambiguousOrder !== null) {
      return { status: "rejected", code: "deployment_fence" };
    }
    const runner = this.#dependencies.liveRunner;
    if (!runner) return { status: "rejected", code: "runtime_not_ready" };
    const releaseLiveStart = mode === "live" && this.#dependencies.beginLiveStart
      ? this.#dependencies.beginLiveStart() : () => undefined;
    if (!releaseLiveStart) return { status: "rejected", code: "update_pending" };
    try {
      const bundle = await this.#dependencies.deployments.fetchBundle(command.deploymentId, command.expectedDeploymentVersion);
      if (bundle.deployment.mode !== mode || bundle.deployment.state !== "paused" ||
          bundle.strategy.market !== record.definition.market || bundle.strategy.symbol !== record.definition.symbol ||
          (bundle.strategy.sourceHash ?? bundle.strategy.configHash) !== record.definition.scriptHash ||
          bundle.risk === null || !bundle.risk.allowedSymbols.includes(bundle.strategy.symbol)) {
        return { status: "rejected", code: "deployment_fence" };
      }
      await runner.resume(bundle);
      try {
        this.#record = await this.#dependencies.store.save({ definition: record.definition, status: "running",
          pausedReason: null, ambiguousOrder: null, updatedAt: this.#timestamp() }, record.recordVersion);
        await runner.activate?.();
      } catch (error) {
        await runner.pause().catch(() => undefined);
        if (this.#record?.status === "running") {
          this.#record = await this.#dependencies.store.save({ definition: this.#record.definition, status: "paused",
            pausedReason: "runtime-start-failed", ambiguousOrder: null, updatedAt: this.#timestamp() }, this.#record.recordVersion);
        }
        throw error;
      }
      return { status: "ok", code: mode === "live" ? "live_resumed" : "demo_resumed" };
    } finally { releaseLiveStart(); }
  }

  async #enableDemo(command: ControlCommand): Promise<CommandExecutionResult> {
    const record = this.#record;
    if (!record || storedVersion(record, command.deploymentId) !== command.expectedDeploymentVersion
      || record.definition.mode !== "paper" || record.definition.market !== "futures"
      || record.status !== "paused" || record.ambiguousOrder !== null) {
      return { status: "rejected", code: "deployment_fence" };
    }
    const bundle = await this.#dependencies.deployments.fetchBundle(command.deploymentId, command.expectedDeploymentVersion);
    if (bundle.deployment.mode !== "paper" || (bundle.deployment.state !== "stopped" && bundle.deployment.state !== "paused")
      || bundle.strategy.market !== "futures" || bundle.strategy.symbol !== record.definition.symbol
      || (bundle.strategy.sourceHash ?? bundle.strategy.configHash) !== record.definition.scriptHash
      || bundle.risk === null || !bundle.risk.allowedSymbols.includes(bundle.strategy.symbol)) {
      return { status: "rejected", code: "deployment_fence" };
    }
    this.#record = await this.#dependencies.store.save({ definition: { ...record.definition, mode: "futures-demo" },
      status: "paused", pausedReason: "demo-enable-pending", ambiguousOrder: null,
      updatedAt: this.#timestamp() }, record.recordVersion);
    return { status: "ok", code: "demo_enabled" };
  }

  async #unlock(command: ControlCommand & { type: "request-live-unlock" }): Promise<CommandExecutionResult> {
    const record = this.#record;
    const unlock = this.#dependencies.liveUnlock;
    if (!record || !unlock ||
        storedVersion(record, command.deploymentId) !== command.expectedDeploymentVersion ||
        record.definition.mode !== "paper" || record.status !== "paused" || record.ambiguousOrder !== null) {
      return { status: "rejected", code: "deployment_fence" };
    }
    const definition = await unlock.prepare(command);
    if (definition.deploymentId !== record.definition.deploymentId ||
        definition.configurationVersion !== record.definition.configurationVersion ||
        definition.scriptHash !== record.definition.scriptHash || definition.market !== record.definition.market ||
        definition.symbol !== record.definition.symbol || definition.mode !== "live") {
      return { status: "rejected", code: "deployment_fence" };
    }
    this.#record = await this.#dependencies.store.save({
      definition,
      status: "paused",
      pausedReason: "live-unlock-pending",
      ambiguousOrder: null,
      updatedAt: this.#timestamp(),
    }, record.recordVersion);
    return { status: "ok", code: "live_unlock_staged" };
  }

  async #stopNewOrders(command: ControlCommand): Promise<CommandExecutionResult> {
    const record = this.#record; const runner = this.#dependencies.liveRunner;
    if (!record || storedVersion(record, command.deploymentId) !== command.expectedDeploymentVersion
      || (record.definition.mode !== "live" && record.definition.mode !== "futures-demo")
      || record.status !== "running" || !runner?.stopNewOrders) {
      return { status: "rejected", code: "deployment_fence" };
    }
    await runner.stopNewOrders(command.deploymentId);
    return { status: "ok", code: "new_orders_stopped" };
  }

  async #cancelOpenOrders(command: ControlCommand): Promise<CommandExecutionResult> {
    const record = this.#record; const runner = this.#dependencies.liveRunner;
    if (record?.definition.mode === "futures-demo") return { status: "rejected", code: "demo_cancel_unsupported" };
    if (!record || storedVersion(record, command.deploymentId) !== command.expectedDeploymentVersion
      || record.definition.mode !== "live" || record.status !== "running" || !runner?.cancelOpenOrders
      || command.payload.scope !== "deployment") return { status: "rejected", code: "deployment_fence" };
    const result = await runner.cancelOpenOrders(command.deploymentId);
    if (result.rejected > 0 || result.unresolved > 0) throw new Error("Live order cancellation is unresolved");
    return { status: "ok", code: "open_orders_cancelled" };
  }

  async #closePositions(command: ControlCommand): Promise<CommandExecutionResult> {
    const record = this.#record; const runner = this.#dependencies.liveRunner;
    const symbol = command.payload.symbol;
    if (!record || storedVersion(record, command.deploymentId) !== command.expectedDeploymentVersion
      || (record.definition.mode !== "live" && record.definition.mode !== "futures-demo")
      || record.status !== "running" || !runner?.closePositions
      || (command.payload.scope !== "all" && command.payload.scope !== "symbol")
      || (symbol !== null && typeof symbol !== "string")) return { status: "rejected", code: "deployment_fence" };
    const result = await runner.closePositions(command.deploymentId, symbol, command.id);
    if (result.closed === 0 && result.reason === "risk-rejected") return { status: "rejected", code: "close_risk_rejected" };
    return { status: "ok", code: result.closed === 0 ? "already_flat" : "close_submitted" };
  }

  async #revalidateConnection(command: ControlCommand): Promise<CommandExecutionResult> {
    if (storedVersion(this.#record, command.deploymentId) !== command.expectedDeploymentVersion
      || !this.#dependencies.connectionControl) return { status: "rejected", code: "deployment_fence" };
    await this.#dependencies.connectionControl.revalidate(command);
    return { status: "ok", code: "connection_revalidated" };
  }

  async #eraseCredentials(command: ControlCommand): Promise<CommandExecutionResult> {
    const record = this.#record;
    if (!record || storedVersion(record, command.deploymentId) !== command.expectedDeploymentVersion
      || !this.#dependencies.connectionControl) return { status: "rejected", code: "deployment_fence" };
    if (record.status !== "stopped") {
      const runner = record.definition.mode === "paper" ? this.#dependencies.runner : this.#dependencies.liveRunner;
      if (!runner) return { status: "rejected", code: "runtime_not_ready" };
      await runner.pause();
      if (record.status !== "paused" || record.pausedReason !== "credentials-erased") {
        this.#record = await this.#dependencies.store.save({ definition: record.definition, status: "paused",
          pausedReason: "credentials-erased", ambiguousOrder: record.ambiguousOrder,
          updatedAt: this.#timestamp() }, record.recordVersion);
      }
    }
    await this.#dependencies.connectionControl.erase(command);
    return { status: "ok", code: "credentials_erased" };
  }

  #timestamp(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid deployment clock");
    return value;
  }
}
