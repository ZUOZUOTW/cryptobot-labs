import { createHash } from "node:crypto";

import type { VerifiedConnection } from "../shared/ipc-contract";
import type { ControlCommand } from "./control-client";
import type { ConnectionVersionStore } from "./connection-version-store";
import type { ConnectionRegistry } from "./connections";
import type { TelemetryEventEnvelope } from "./telemetry-buffer";
import type { CredentialVault } from "./vault";

interface ConnectionControlDependencies {
  verifier: { verify(): Promise<VerifiedConnection> };
  registry: Pick<ConnectionRegistry, "record" | "revoke">;
  vault: Pick<CredentialVault, "erase">;
  versions: ConnectionVersionStore;
  enqueue(event: TelemetryEventEnvelope): Promise<unknown>;
  now?: () => number;
}

export interface ConnectionControl {
  revalidate(command: ControlCommand): Promise<void>;
  erase(command: ControlCommand): Promise<void>;
}

const eventId = (type: string, commandId: string): string =>
  `connection-${createHash("sha256").update(`${type}:${commandId}`).digest("hex").slice(0, 48)}`;

export function createConnectionControl(dependencies: ConnectionControlDependencies): ConnectionControl {
  const now = dependencies.now ?? Date.now;
  const envelope = (command: ControlCommand, type: "connection-verified" | "key-erased",
    payload: TelemetryEventEnvelope["payload"]): TelemetryEventEnvelope => {
    const occurredAt = now();
    if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) throw new Error("Invalid connection clock");
    return { version: 1, id: eventId(type, command.id), type, deploymentId: command.deploymentId,
      expectedDeploymentVersion: command.expectedDeploymentVersion, correlationId: command.correlationId,
      occurredAt, payload };
  };

  return {
    async revalidate(command) {
      const verified = await dependencies.verifier.verify();
      const verifiedAt = Date.parse(verified.verifiedAt);
      if (!Number.isSafeInteger(verifiedAt) || verifiedAt < 0) throw new Error("Invalid verification time");
      dependencies.registry.record({ verifiedAt, apiKeySuffix: verified.apiKeySuffix,
        canTrade: verified.permissions.spotTrade || verified.permissions.futuresTrade,
        withdrawalPermission: "absent", permissions: { read: verified.permissions.read,
          spot: verified.permissions.spotTrade, futures: verified.permissions.futuresTrade } });
      const connectionVersion = await dependencies.versions.next();
      await dependencies.enqueue(envelope(command, "connection-verified", { provider: "WEEX",
        maskedApiKeySuffix: `****${verified.apiKeySuffix}`, permissions: verified.permissions, connectionVersion }));
    },

    async erase(command) {
      dependencies.registry.revoke();
      const connectionVersion = await dependencies.versions.next();
      await dependencies.vault.erase();
      const reason = typeof command.payload.reason === "string" ? command.payload.reason : "operator-requested";
      await dependencies.enqueue(envelope(command, "key-erased", { reason, connectionVersion }));
    },
  };
}
