export const IPC_CHANNELS = {
  getStatus: "agent:get-status",
  saveCredentials: "agent:save-credentials",
  verifyCredentials: "agent:verify-credentials",
  eraseCredentials: "agent:erase-credentials",
  pair: "agent:pair",
  setStartAtLogin: "agent:set-start-at-login",
  emergencyStop: "agent:emergency-stop",
  getUpdateStatus: "agent:get-update-status",
  checkForUpdates: "agent:check-for-updates",
  installUpdate: "agent:install-update",
} as const;

export const IPC_EVENTS = { pairingSuggestion: "agent:pairing-suggestion" } as const;

export interface CredentialInput {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

export interface CredentialMetadata {
  apiKeySuffix: string;
  configured: boolean;
}

export interface VerifiedConnection {
  provider: "WEEX";
  apiKeySuffix: string;
  verifiedAt: string;
  permissions: {
    read: boolean;
    spotTrade: boolean;
    futuresTrade: boolean;
    withdrawal: false;
  };
}

export interface PairingInput {
  code: string;
  deviceName: string;
}

export interface PairingResult {
  paired: boolean;
  deviceId: string;
}

export interface AgentStatus {
  state: "unconfigured" | "ready" | "verifying" | "offline" | "error";
  credential: CredentialMetadata;
  paired: boolean;
  pairingState: "unpaired" | "paired" | "expired" | "revoked";
  startAtLogin: boolean;
}

export interface AgentUpdateStatus {
  state: "disabled" | "idle" | "checking" | "downloading" | "downloaded" | "not-available" | "blocked" | "error";
  version: string | null;
  reason: "not-packaged" | "origin-unavailable" | "unsupported-platform" | "squirrel-first-run" | "live-running" | null;
}

export interface AgentRendererApi {
  getStatus(): Promise<AgentStatus>;
  saveCredentials(input: CredentialInput): Promise<CredentialMetadata>;
  verifyCredentials(): Promise<VerifiedConnection>;
  eraseCredentials(): Promise<void>;
  pair(input: PairingInput): Promise<PairingResult>;
  setStartAtLogin(enabled: boolean): Promise<void>;
  emergencyStop(): Promise<void>;
  getUpdateStatus(): Promise<AgentUpdateStatus>;
  checkForUpdates(): Promise<AgentUpdateStatus>;
  installUpdate(): Promise<void>;
  onPairingSuggestion(listener: (code: string) => void): () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function boundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max && value.trim() === value;
}

export function parseAgentUpdateStatus(value: unknown): AgentUpdateStatus {
  if (!isRecord(value) || !hasExactKeys(value, ["state", "version", "reason"])) {
    throw new TypeError("Invalid Agent update status");
  }
  const states: AgentUpdateStatus["state"][] = ["disabled", "idle", "checking", "downloading", "downloaded",
    "not-available", "blocked", "error"];
  const reasons: Exclude<AgentUpdateStatus["reason"], null>[] = ["not-packaged", "origin-unavailable",
    "unsupported-platform", "squirrel-first-run", "live-running"];
  if (!states.includes(value.state as AgentUpdateStatus["state"])
    || (value.version !== null && (typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version)))
    || (value.reason !== null && !reasons.includes(value.reason as Exclude<AgentUpdateStatus["reason"], null>))) {
    throw new TypeError("Invalid Agent update status");
  }
  return { state: value.state as AgentUpdateStatus["state"], version: value.version as string | null,
    reason: value.reason as AgentUpdateStatus["reason"] };
}

export function parseCredentialInput(value: unknown): CredentialInput {
  if (!isRecord(value) || !hasExactKeys(value, ["apiKey", "secretKey", "passphrase"])) {
    throw new TypeError("Invalid credential input");
  }
  if (!boundedString(value.apiKey, 4, 256) || !boundedString(value.secretKey, 8, 512) || !boundedString(value.passphrase, 1, 256)) {
    throw new TypeError("Invalid credential input");
  }
  return { apiKey: value.apiKey, secretKey: value.secretKey, passphrase: value.passphrase };
}

export function parsePairingInput(value: unknown): PairingInput {
  if (!isRecord(value) || !hasExactKeys(value, ["code", "deviceName"])) throw new TypeError("Invalid pairing input");
  if (typeof value.code !== "string" || !/^CBL-[A-Za-z0-9_-]{22}$/.test(value.code) || !boundedString(value.deviceName, 1, 80)) {
    throw new TypeError("Invalid pairing input");
  }
  return { code: value.code, deviceName: value.deviceName };
}

export function parsePairingSuggestion(value: unknown): string {
  if (typeof value !== "string" || !/^CBL-[A-Za-z0-9_-]{22}$/.test(value)) throw new TypeError("Invalid pairing suggestion");
  return value;
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError("Expected boolean");
  return value;
}

export function assertNoArguments(args: readonly unknown[]): void {
  if (args.length !== 0) throw new TypeError("This method accepts no arguments");
}

export function parseCredentialMetadata(value: unknown): CredentialMetadata {
  if (!isRecord(value) || !hasExactKeys(value, ["apiKeySuffix", "configured"]) || typeof value.configured !== "boolean") {
    throw new TypeError("Invalid credential metadata");
  }
  if (typeof value.apiKeySuffix !== "string" || !/^.{0,4}$/.test(value.apiKeySuffix)) throw new TypeError("Invalid credential metadata");
  return { apiKeySuffix: value.apiKeySuffix, configured: value.configured };
}

export function parsePairingResult(value: unknown): PairingResult {
  if (!isRecord(value) || !hasExactKeys(value, ["paired", "deviceId"]) || typeof value.paired !== "boolean" || !boundedString(value.deviceId, 1, 128)) {
    throw new TypeError("Invalid pairing result");
  }
  return { paired: value.paired, deviceId: value.deviceId };
}

export function parseVerifiedConnection(value: unknown): VerifiedConnection {
  if (!isRecord(value) || !hasExactKeys(value, ["provider", "apiKeySuffix", "verifiedAt", "permissions"]) || value.provider !== "WEEX") {
    throw new TypeError("Invalid verification result");
  }
  const permissions = value.permissions;
  if (!isRecord(permissions) || !hasExactKeys(permissions, ["read", "spotTrade", "futuresTrade", "withdrawal"]) ||
    typeof permissions.read !== "boolean" || typeof permissions.spotTrade !== "boolean" || typeof permissions.futuresTrade !== "boolean" || permissions.withdrawal !== false ||
    typeof value.apiKeySuffix !== "string" || !/^.{1,4}$/.test(value.apiKeySuffix) || typeof value.verifiedAt !== "string" || !Number.isFinite(Date.parse(value.verifiedAt))) {
    throw new TypeError("Invalid verification result");
  }
  return {
    provider: "WEEX",
    apiKeySuffix: value.apiKeySuffix,
    verifiedAt: value.verifiedAt,
    permissions: { read: permissions.read, spotTrade: permissions.spotTrade, futuresTrade: permissions.futuresTrade, withdrawal: false },
  };
}

export function parseAgentStatus(value: unknown): AgentStatus {
  if (!isRecord(value) || !hasExactKeys(value, ["state", "credential", "paired", "pairingState", "startAtLogin"])) throw new TypeError("Invalid agent status");
  if (!["unconfigured", "ready", "verifying", "offline", "error"].includes(String(value.state))
    || !["unpaired", "paired", "expired", "revoked"].includes(String(value.pairingState))
    || typeof value.paired !== "boolean" || value.paired !== (value.pairingState === "paired")
    || typeof value.startAtLogin !== "boolean") {
    throw new TypeError("Invalid agent status");
  }
  return { state: value.state as AgentStatus["state"], credential: parseCredentialMetadata(value.credential), paired: value.paired,
    pairingState: value.pairingState as AgentStatus["pairingState"], startAtLogin: value.startAtLogin };
}
