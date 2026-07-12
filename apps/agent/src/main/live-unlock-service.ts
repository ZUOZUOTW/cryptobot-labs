import { createHash } from "node:crypto";

import type { ControlCommand } from "./control-client";
import type { DeploymentBundle } from "./deployment-client";
import type { DurableRunDefinition } from "./run-store";
import type { VerifiedConnection } from "../shared/ipc-contract";
import type { ConnectionRegistry } from "./connections";
import type { PublicMarketService } from "./public-market-service";

type UnlockCommand = ControlCommand & { type: "request-live-unlock" };
const HASH = /^[a-f0-9]{64}$/;

function plain(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string,unknown>;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = plain(value, "canonical value");
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const sameStrings = (left: unknown, right: readonly string[]) => Array.isArray(left) &&
  left.length === right.length && left.every((item, index) => item === right[index]);

export interface LiveUnlockServiceOptions {
  readonly deployments: { fetchBundle(deploymentId: string, expectedVersion: number): Promise<DeploymentBundle> };
  readonly verifier: { verify(): Promise<VerifiedConnection> };
  readonly connection: Pick<ConnectionRegistry, "record">;
  readonly market: Pick<PublicMarketService, "collect">;
}

/** Performs every independent local gate and returns a paused live definition; it never starts execution. */
export function createLiveUnlockService(options: LiveUnlockServiceOptions) {
  return Object.freeze({ async prepare(command: UnlockCommand): Promise<DurableRunDefinition> {
    const gate = plain(command.payload.revalidate, "live revalidation requirements");
    const bundle = await options.deployments.fetchBundle(command.deploymentId, command.expectedDeploymentVersion);
    if (bundle.deployment.mode !== "paper" || bundle.deployment.state !== "stopped" || bundle.risk === null ||
        bundle.strategy.config === null || bundle.deployment.configurationHash !== gate.deploymentConfigurationHash ||
        bundle.strategy.market !== gate.strategyMarket || bundle.deployment.strategyVersionId !== gate.strategyVersionId ||
        !sameStrings(gate.allowedSymbols, bundle.risk.allowedSymbols) ||
        !bundle.risk.allowedSymbols.includes(bundle.strategy.symbol)) {
      throw new Error("Live unlock deployment fence failed");
    }
    const riskApproval = plain(gate.riskPolicy, "risk policy approval");
    const versionFence = plain(riskApproval.versionFence, "risk version fence");
    const riskSnapshot = {
      id: bundle.risk.id,
      versionFence: { updatedAt: bundle.risk.updatedAt },
      allowedSymbols: bundle.risk.allowedSymbols,
      maxOrderNotional: bundle.risk.maxOrderNotional,
      maxPositionNotional: bundle.risk.maxPositionNotional,
      maxTotalExposure: bundle.risk.maxTotalExposure,
      maxSimultaneousPositions: bundle.risk.maxSimultaneousPositions,
      maxDailyLoss: bundle.risk.maxDailyLoss,
      maxLeverage: bundle.risk.maxLeverage,
      maxSlippageBps: bundle.risk.maxSlippageBps,
      minSignalCooldownMs: bundle.risk.minSignalCooldownMs,
      maxConsecutiveFailures: bundle.risk.maxConsecutiveFailures,
      operationMode: bundle.risk.operationMode,
    };
    if (riskApproval.id !== bundle.risk.id || versionFence.updatedAt !== bundle.risk.updatedAt ||
        typeof riskApproval.hash !== "string" || !HASH.test(riskApproval.hash) ||
        digest(canonical(riskSnapshot)) !== riskApproval.hash) {
      throw new Error("Live unlock risk fence failed");
    }
    const verified = await options.verifier.verify();
    const verifiedAt = Date.parse(verified.verifiedAt);
    if (verified.provider !== "WEEX" || !Number.isSafeInteger(verifiedAt) || verifiedAt < 0 ||
        verified.permissions.read !== true || verified.permissions.withdrawal !== false ||
        (bundle.strategy.market === "spot" ? !verified.permissions.spotTrade : !verified.permissions.futuresTrade)) {
      throw new Error("Live unlock local permission verification failed");
    }
    options.connection.record({
      verifiedAt,
      apiKeySuffix: verified.apiKeySuffix,
      canTrade: true,
      withdrawalPermission: "absent",
      permissions: { read: true, spot: verified.permissions.spotTrade, futures: verified.permissions.futuresTrade },
    });
    const config = bundle.strategy.config as { timeframe?: unknown };
    if (typeof config.timeframe !== "string") throw new Error("Live unlock strategy timeframe is invalid");
    const metadata = await options.market.collect({
      market: bundle.strategy.market,
      symbol: bundle.strategy.symbol,
      timeframe: config.timeframe,
    });
    if (metadata.rules.market !== bundle.strategy.market || metadata.rules.symbol !== bundle.strategy.symbol) {
      throw new Error("Live unlock product metadata mismatch");
    }
    return Object.freeze({
      deploymentId: bundle.deployment.id,
      configurationVersion: `v${bundle.deployment.version}`,
      scriptHash: bundle.strategy.sourceHash ?? bundle.strategy.configHash,
      mode: "live",
      market: bundle.strategy.market,
      symbol: bundle.strategy.symbol,
    });
  } });
}
