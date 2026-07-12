import type { ExecutionTarget } from "@cryptobot-labs/trading-core";

export type LocalConnectionErrorCode = "missing" | "stale" | "permission" | "unsafe-withdrawal" | "invalid";

export class LocalConnectionError extends Error {
  constructor(readonly code: LocalConnectionErrorCode, message: string) {
    super(message);
    this.name = "LocalConnectionError";
  }
}

export interface LocalPermissionSummary {
  readonly read: boolean;
  readonly spot: boolean;
  readonly futures: boolean;
}

export interface VerifiedLocalConnection {
  readonly verifiedAt: number;
  readonly apiKeySuffix: string;
  readonly canTrade: boolean | "unknown";
  readonly withdrawalPermission: "absent" | "present" | "unknown";
  readonly permissions: LocalPermissionSummary;
}

function validate(snapshot: VerifiedLocalConnection): VerifiedLocalConnection {
  if (!Number.isSafeInteger(snapshot.verifiedAt) || snapshot.verifiedAt < 0 ||
      !/^[\w-]{1,16}$/.test(snapshot.apiKeySuffix) ||
      ![true, false, "unknown"].includes(snapshot.canTrade) ||
      !["absent", "present", "unknown"].includes(snapshot.withdrawalPermission) ||
      typeof snapshot.permissions?.read !== "boolean" ||
      typeof snapshot.permissions.spot !== "boolean" ||
      typeof snapshot.permissions.futures !== "boolean") {
    throw new LocalConnectionError("invalid", "Invalid verified connection snapshot");
  }
  return Object.freeze({
    verifiedAt: snapshot.verifiedAt,
    apiKeySuffix: snapshot.apiKeySuffix,
    canTrade: snapshot.canTrade,
    withdrawalPermission: snapshot.withdrawalPermission,
    permissions: Object.freeze({ ...snapshot.permissions }),
  });
}

/** Metadata-only connection state. API secrets remain exclusively in CredentialVault. */
export class ConnectionRegistry {
  #verified: VerifiedLocalConnection | null = null;

  record(snapshot: VerifiedLocalConnection): void {
    this.#verified = validate(snapshot);
  }

  revoke(): void {
    this.#verified = null;
  }

  snapshot(): VerifiedLocalConnection | null {
    return this.#verified;
  }

  requireFresh(
    target: ExecutionTarget,
    now: number,
    maximumAgeMs = 5 * 60_000,
  ): VerifiedLocalConnection {
    if (!Number.isSafeInteger(now) || now < 0 ||
        !Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 0) {
      throw new LocalConnectionError("invalid", "Invalid connection freshness check");
    }
    const current = this.#verified;
    if (!current) throw new LocalConnectionError("missing", "A verified local WEEX connection is required");
    const age = now - current.verifiedAt;
    if (age < 0 || age > maximumAgeMs) {
      throw new LocalConnectionError("stale", "Verified connection is stale");
    }
    if (!current.permissions.read) {
      throw new LocalConnectionError("permission", "Verified connection lacks read permission");
    }
    if (target.market === "spot" && !current.permissions.spot) {
      throw new LocalConnectionError("permission", "Verified connection lacks spot permission");
    }
    if (target.market === "futures" && !current.permissions.futures) {
      throw new LocalConnectionError("permission", "Verified connection lacks futures permission");
    }
    if (current.canTrade === false) {
      throw new LocalConnectionError("permission", "Verified connection cannot trade");
    }
    if (target.mode === "live" && current.withdrawalPermission !== "absent") {
      throw new LocalConnectionError(
        "unsafe-withdrawal",
        "Live execution requires withdrawal permission to be verifiably absent",
      );
    }
    return current;
  }
}
