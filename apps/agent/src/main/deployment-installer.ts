import type { CommandExecutionResult, ControlCommand } from "./control-client";
import type { DeploymentBundle } from "./deployment-client";
import type { DurableRunRecord, DurableRunStore } from "./run-store";

export interface DeploymentInstallerDependencies {
  readonly deployments: { fetchBundle(deploymentId: string, expectedVersion: number): Promise<DeploymentBundle> };
  readonly store: DurableRunStore;
  readonly runner?: {
    resume(bundle: DeploymentBundle): Promise<void>;
    pause(): Promise<void>;
  };
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
    if (command.type === "pause") return this.#pause(command);
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
    } catch (error) {
      await runner.pause().catch(() => undefined);
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
    const runner = this.#dependencies.runner;
    if (!runner) return { status: "rejected", code: "runtime_not_ready" };
    await runner.pause();
    this.#record = await this.#dependencies.store.save({ definition: record.definition, status: "paused",
      pausedReason: "operator-paused", ambiguousOrder: record.ambiguousOrder, updatedAt: this.#timestamp() }, record.recordVersion);
    return { status: "ok", code: "paused" };
  }

  #timestamp(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid deployment clock");
    return value;
  }
}
