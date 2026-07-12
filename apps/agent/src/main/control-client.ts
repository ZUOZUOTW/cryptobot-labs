import type { AsyncSafeStorage, VaultFileStore } from "./vault";
import { DEVICE_EVENT_TYPES, type TelemetryBuffer } from "./telemetry-buffer";

const DEVICE_HEADERS = Object.freeze({
  authorization: "Authorization",
  deviceId: "X-CBL-Device-Id",
  timestamp: "X-CBL-Device-Timestamp",
  nonce: "X-CBL-Device-Nonce",
  signature: "X-CBL-Device-Signature",
} as const);

const COMMAND_TYPES = new Set([
  "deploy", "pause", "resume-paper", "request-live-unlock", "stop-new-orders",
  "cancel-open-orders", "close-positions", "revalidate-connection", "erase-local-credentials",
]);
const DEVICE_EVENT_TYPE_SET = new Set<string>(DEVICE_EVENT_TYPES);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._:-]{1,63}$/;
const SAFE_CODE = /^[a-z][a-z0-9._-]{0,63}$/;
const FORBIDDEN_NAMES = [
  "secret", "apikey", "accesskey", "passphrase", "accesssign", "signature", "credential",
  "authorization", "authentication", "cookie", "privatekey", "rawaccount", "header", "token",
] as const;
const MAX_BODY_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 1_048_576;
/** Must match db/repositories/deployments.ts COMMAND_ACK_GRACE_MS. */
export const CONTROL_CLIENT_LATE_ACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const encoder = new TextEncoder();

export interface ControlDeviceIdentity {
  readonly deviceId: string;
  readonly credential: string;
  readonly credentialExpiresAt: number;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export interface ControlCommand {
  readonly id: string;
  readonly deploymentId: string;
  readonly type: string;
  readonly version: 1;
  readonly correlationId: string;
  readonly expectedDeploymentVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface CommandExecutionResult {
  /** `ok` means the command was durably applied. `rejected` is a safe local refusal. */
  readonly status: "ok" | "rejected";
  /** A bounded machine code only. Human/provider error messages are never accepted for serialization. */
  readonly code: string;
}

export interface StoredCommandOutcome {
  readonly status: "ok" | "rejected" | "failed";
  readonly code: string;
  readonly message: string;
  readonly applied: boolean;
}

export interface PendingCommandAcknowledgement {
  readonly commandId: string;
  readonly deploymentId: string;
  readonly expectedDeploymentVersion: number;
  readonly expiresAt: number;
  readonly outcome: StoredCommandOutcome;
}

/** Must be backed by encrypted durable storage in production. */
export interface CommandOutcomeStore {
  get(commandId: string): Promise<PendingCommandAcknowledgement | null>;
  list(limit?: number): Promise<readonly PendingCommandAcknowledgement[]>;
  put(command: { readonly id: string; readonly deploymentId: string; readonly expectedDeploymentVersion: number; readonly expiresAt: number },
    outcome: StoredCommandOutcome): Promise<void>;
  delete(commandId: string): Promise<void>;
}

export type TelemetryUploadBuffer = Pick<TelemetryBuffer, "nextBatch" | "acknowledge">;

export interface SignedDeviceRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  /** Headers intentionally use the platform object, whose JSON representation does not reveal authorization. */
  readonly headers: Headers;
  readonly body?: string;
}

export interface ControlClientOptions {
  baseUrl: string;
  identity: ControlDeviceIdentity | (() => ControlDeviceIdentity | Promise<ControlDeviceIdentity>);
  deploymentVersion(deploymentId: string): number | null | Promise<number | null>;
  execute(command: ControlCommand): CommandExecutionResult | Promise<CommandExecutionResult>;
  outcomeStore: CommandOutcomeStore;
  fetch?: typeof fetch;
  crypto?: Pick<Crypto, "subtle" | "getRandomValues">;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onRevoked?: () => void | Promise<void>;
  pollLimit?: number;
  idlePollMs?: number;
  minimumBackoffMs?: number;
  maximumBackoffMs?: number;
  requestTimeoutMs?: number;
  maximumPollPages?: number;
  /** Time reserved after local execution for a signed durable acknowledgement. */
  minimumAcknowledgementWindowMs?: number;
  /** Persist a bounded local audit/dead-letter before an outcome ages out. */
  onExpiredOutcome: (pending: PendingCommandAcknowledgement) => void | Promise<void>;
}

export class ControlClientError extends Error {
  constructor(message: string) { super(message); this.name = "ControlClientError"; }
}

export class ControlClientRevokedError extends ControlClientError {
  constructor() { super("device authorization is no longer valid"); this.name = "ControlClientRevokedError"; }
}

const OUTCOME_MESSAGES = new Set([
  "Command applied", "Command rejected locally", "Command execution failed", "Command execution interrupted",
  "Deployment version does not match", "Command expired before execution",
]);
const OUTCOME_CODES = new Set([
  "applied", "local_rejection", "deployment_fence", "expired_command", "execution_interrupted", "execution_failed",
]);

function parseStoredCommandOutcome(value: unknown): StoredCommandOutcome {
  const item = plain(value, "stored command outcome");
  exact(item, ["status", "code", "message", "applied"], "stored command outcome");
  if ((item.status !== "ok" && item.status !== "rejected" && item.status !== "failed")
    || typeof item.code !== "string" || !OUTCOME_CODES.has(item.code)
    || typeof item.message !== "string" || !OUTCOME_MESSAGES.has(item.message)
    || typeof item.applied !== "boolean" || (item.status === "ok") !== item.applied) {
    throw new ControlClientError("stored command outcome is invalid");
  }
  return Object.freeze({ status: item.status, code: item.code, message: item.message, applied: item.applied });
}

function parsePendingAcknowledgement(value: unknown): PendingCommandAcknowledgement {
  const item = plain(value, "pending command acknowledgement");
  exact(item, ["commandId", "deploymentId", "expectedDeploymentVersion", "expiresAt", "outcome"], "pending command acknowledgement");
  return Object.freeze({ commandId: identifier(item.commandId, "stored command id"),
    deploymentId: identifier(item.deploymentId, "stored deployment id"),
    expectedDeploymentVersion: safeInteger(item.expectedDeploymentVersion, "stored deployment version", 1),
    expiresAt: safeInteger(item.expiresAt, "stored command expiry"),
    outcome: parseStoredCommandOutcome(item.outcome) });
}

/** Encrypted, queued persistence for replay-safe command acknowledgements. */
export function createEncryptedCommandOutcomeStore(
  storage: AsyncSafeStorage,
  fileStore: VaultFileStore,
): CommandOutcomeStore {
  const version = 2;
  const maximumOutcomes = 2_048;
  const maximumPlaintextBytes = 512 * 1_024;
  let queue: Promise<void> = Promise.resolve();

  const exclusively = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const ensureAvailable = async (): Promise<void> => {
    if (!(await storage.isAsyncEncryptionAvailable())) throw new ControlClientError("encrypted outcome storage is unavailable");
  };
  const read = async (): Promise<Record<string, PendingCommandAcknowledgement>> => {
    await ensureAvailable();
    const ciphertext = await fileStore.read();
    if (ciphertext === null) return {};
    const copy = Uint8Array.from(ciphertext);
    let plaintext: string;
    try {
      const decrypt = storage.decryptStringAsync ?? storage.decryptString;
      if (!decrypt) throw new ControlClientError("encrypted outcome storage is unavailable");
      plaintext = await decrypt.call(storage, copy);
    } finally { copy.fill(0); }
    if (encoder.encode(plaintext).byteLength > maximumPlaintextBytes) throw new ControlClientError("command outcome store is corrupt");
    let parsed: unknown;
    try { parsed = JSON.parse(plaintext); } catch { throw new ControlClientError("command outcome store is corrupt"); }
    const state = plain(parsed, "command outcome store"); exact(state, ["version", "outcomes"], "command outcome store");
    if (state.version !== version) throw new ControlClientError("command outcome store is corrupt");
    if (!Array.isArray(state.outcomes) || state.outcomes.length > maximumOutcomes) {
      throw new ControlClientError("command outcome store is corrupt");
    }
    const result: Record<string, PendingCommandAcknowledgement> = {};
    for (const entry of state.outcomes) {
      const pending = parsePendingAcknowledgement(entry);
      if (Object.hasOwn(result, pending.commandId)) throw new ControlClientError("command outcome store is corrupt");
      Object.defineProperty(result, pending.commandId, { value: pending, enumerable: true, configurable: true, writable: true });
    }
    return result;
  };
  const write = async (outcomes: Record<string, PendingCommandAcknowledgement>): Promise<void> => {
    await ensureAvailable();
    const entries = Object.values(outcomes).sort((left, right) => left.commandId.localeCompare(right.commandId));
    const plaintext = safeControlJson({ version, outcomes: entries }, maximumPlaintextBytes);
    const plaintextBytes = Buffer.from(plaintext, "utf8");
    let encrypted: Uint8Array;
    try {
      const encrypt = storage.encryptStringAsync ?? storage.encryptString;
      if (!encrypt) throw new ControlClientError("encrypted outcome storage is unavailable");
      encrypted = await encrypt.call(storage, plaintextBytes.toString("utf8"));
      if (!(encrypted instanceof Uint8Array) || encrypted.byteLength === 0) throw new ControlClientError("outcome encryption failed");
    } finally { plaintextBytes.fill(0); }
    const copy = Uint8Array.from(encrypted!);
    try { await fileStore.writeAtomically(copy, 0o600); } finally { copy.fill(0); encrypted!.fill(0); }
  };

  return Object.freeze({
    get(commandId: string) {
      return exclusively(async () => {
        identifier(commandId, "command id"); return (await read())[commandId] ?? null;
      });
    },
    list(limit = maximumOutcomes) {
      return exclusively(async () => {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumOutcomes) throw new ControlClientError("outcome list limit is invalid");
        return Object.freeze(Object.values(await read()).sort((left, right) => left.commandId.localeCompare(right.commandId)).slice(0, limit));
      });
    },
    put(command: { readonly id: string; readonly deploymentId: string; readonly expectedDeploymentVersion: number; readonly expiresAt: number },
      outcome: StoredCommandOutcome) {
      return exclusively(async () => {
        const pending = parsePendingAcknowledgement({ commandId: command.id, deploymentId: command.deploymentId,
          expectedDeploymentVersion: command.expectedDeploymentVersion, expiresAt: command.expiresAt, outcome });
        const outcomes = await read();
        if (!Object.hasOwn(outcomes, pending.commandId) && Object.keys(outcomes).length >= maximumOutcomes) {
          throw new ControlClientError("command outcome store is full");
        }
        const existing = outcomes[pending.commandId];
        if (existing && (existing.deploymentId !== pending.deploymentId
          || existing.expectedDeploymentVersion !== pending.expectedDeploymentVersion || existing.expiresAt !== pending.expiresAt)) {
          throw new ControlClientError("command outcome identity conflict");
        }
        Object.defineProperty(outcomes, pending.commandId, { value: pending, enumerable: true, configurable: true, writable: true });
        await write(outcomes);
      });
    },
    delete(commandId: string) {
      return exclusively(async () => {
        identifier(commandId, "command id"); const outcomes = await read();
        if (!Object.hasOwn(outcomes, commandId)) return;
        delete outcomes[commandId]; await write(outcomes);
      });
    },
  });
}

class InvalidCommandError extends ControlClientError {
  constructor(readonly code: "invalid_command" | "expired_command" | "deployment_fence") {
    super(code); this.name = "InvalidCommandError";
  }
}

const plain = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new ControlClientError(`${label} is invalid`);
  return value as Record<string, unknown>;
};

const exact = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))) throw new ControlClientError(`${label} fields are invalid`);
};

const safeInteger = (value: unknown, label: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new ControlClientError(`${label} is invalid`);
  return value as number;
};

const identifier = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !ID.test(value)) throw new ControlClientError(`${label} is invalid`);
  return value;
};

const text = (value: unknown, label: string, maximum = 256): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum
    || /[\u0000-\u001f\u007f]/.test(value)) throw new ControlClientError(`${label} is invalid`);
  return value;
};

function normalizedFieldName(key: string): string {
  return key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assertSafeFieldName(key: string): void {
  const normalized = normalizedFieldName(key);
  if (normalized !== "apikeysuffix" && normalized !== "maskedapikeysuffix" && normalized !== "haslocalcredential"
    && FORBIDDEN_NAMES.some((part) => normalized.includes(part))) {
    throw new ControlClientError("credential material cannot be serialized");
  }
}

function assertSafeString(value: string): void {
  const scanned = value.normalize("NFKC");
  const lower = scanned.toLowerCase();
  const highEntropy = (scanned.match(/[A-Za-z0-9+/_=-]{32,}/g) ?? []).some((token) =>
    /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token) && new Set(token).size >= 16);
  if (/-----begin (?:rsa |ec |ed25519 )?private key-----/.test(lower)
    || /^(?:bearer|basic)\s+[a-z0-9+/_=-]{8,}$/i.test(scanned)
    || /(?:api[_ -]?(?:secret|key)|access[_ -]?key|secret[_ -]?key|pass[_ -]?phrase|weex[_ -]?(?:api[_ -]?)?key|weex[_ -]?access[_ -]?sign|access[_ -]?sign|authorization|set-cookie|cookie)\s*[:=]/i.test(scanned)
    || /\b(?:cred|bst)_[A-Za-z0-9_-]{16,}\b/.test(scanned)
    || /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}\b/.test(scanned)
    || highEntropy) throw new ControlClientError("credential material cannot be serialized");
}

function cloneSafeJson(value: unknown, depth = 0, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") { assertSafeString(value); return value; }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ControlClientError("non-finite JSON number is forbidden");
    return value;
  }
  if (depth > 24 || typeof value !== "object" || value === null || ancestors.has(value)) {
    throw new ControlClientError("unsafe JSON value is forbidden");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) throw new ControlClientError("unsafe JSON object is forbidden");
  if (Object.getOwnPropertySymbols(value).length > 0) throw new ControlClientError("JSON symbol fields are forbidden");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 1_000) throw new ControlClientError("JSON array is too large");
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const fields = Object.keys(descriptors).filter((key) => key !== "length");
      if (fields.length !== value.length) throw new ControlClientError("sparse or extended JSON arrays are forbidden");
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new ControlClientError("JSON array accessors are forbidden");
        }
        result.push(cloneSafeJson(descriptor.value, depth + 1, ancestors));
      }
      return result;
    }
    const result: Record<string, unknown> = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length > 1_000) throw new ControlClientError("JSON object is too large");
    for (const key of keys.sort()) {
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor) || !descriptor.enumerable || typeof key !== "string") {
        throw new ControlClientError("JSON accessors are forbidden");
      }
      assertSafeFieldName(key);
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new ControlClientError("unsafe JSON field is forbidden");
      }
      result[key] = cloneSafeJson(descriptor.value, depth + 1, ancestors);
    }
    return result;
  } finally { ancestors.delete(value); }
}

export function safeControlJson(value: unknown, maximumBytes = MAX_BODY_BYTES): string {
  const serialized = JSON.stringify(cloneSafeJson(value));
  if (encoder.encode(serialized).byteLength > maximumBytes) throw new ControlClientError("JSON body is too large");
  return serialized;
}

const bytesToBase64url = (value: Uint8Array): string => Buffer.from(value).toString("base64url");
const bytesToHex = (value: Uint8Array): string => [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function sha256(value: Uint8Array, implementation: Pick<Crypto, "subtle">): Promise<Uint8Array> {
  // TS models many Node-origin Uint8Arrays as ArrayBufferLike (and therefore
  // possibly SharedArrayBuffer). Own a fresh ArrayBuffer before WebCrypto.
  return new Uint8Array(await implementation.subtle.digest("SHA-256", Uint8Array.from(value)));
}

function validatePayload(type: string, raw: unknown, context: { correlationId: string; now: number }): Readonly<Record<string, unknown>> {
  const payload = plain(cloneSafeJson(raw), "command payload");
  switch (type) {
    case "deploy":
      exact(payload, ["configurationHash", "mode"], "deploy payload");
      if (typeof payload.configurationHash !== "string" || !HASH.test(payload.configurationHash)
        || !["paper", "futures-demo", "live"].includes(String(payload.mode))) throw new ControlClientError("deploy payload is invalid");
      break;
    case "pause": case "resume-paper": case "stop-new-orders": case "erase-local-credentials":
      exact(payload, ["reason"], `${type} payload`); text(payload.reason, "reason"); break;
    case "cancel-open-orders":
      exact(payload, ["scope", "reason"], "cancel payload");
      if (payload.scope !== "deployment") throw new ControlClientError("cancel scope is invalid");
      text(payload.reason, "reason"); break;
    case "close-positions": {
      exact(payload, ["scope", "symbol", "confirmation"], "close payload");
      if (payload.scope !== "all" && payload.scope !== "symbol") throw new ControlClientError("close scope is invalid");
      if (payload.scope === "symbol") {
        if (typeof payload.symbol !== "string" || !SYMBOL.test(payload.symbol)) throw new ControlClientError("close symbol is invalid");
      } else if (payload.symbol !== null) throw new ControlClientError("close symbol is invalid");
      const confirmation = plain(payload.confirmation, "close confirmation");
      exact(confirmation, ["id", "confirmedAt", "phrase"], "close confirmation");
      const confirmationId = identifier(confirmation.id, "confirmation id");
      const confirmedAt = safeInteger(confirmation.confirmedAt, "confirmedAt");
      if (confirmation.phrase !== "CLOSE POSITIONS" || confirmationId !== context.correlationId
        || confirmedAt > context.now || confirmedAt < context.now - 300_000) {
        throw new ControlClientError("close confirmation is invalid");
      }
      break;
    }
    case "revalidate-connection": exact(payload, [], "revalidation payload"); break;
    case "request-live-unlock": {
      exact(payload, ["confirmationId", "riskAcceptedAt", "revalidate"], "live unlock payload");
      const confirmationId = identifier(payload.confirmationId, "confirmation id");
      const riskAcceptedAt = safeInteger(payload.riskAcceptedAt, "riskAcceptedAt");
      if (confirmationId !== context.correlationId || riskAcceptedAt > context.now || riskAcceptedAt < context.now - 300_000) {
        throw new ControlClientError("live unlock confirmation is stale or mismatched");
      }
      const gate = plain(payload.revalidate, "revalidation requirements");
      exact(gate, ["localConnection", "permissions", "fetchCurrentProductMetadata", "connectionVersion",
        "deploymentConfigurationHash", "strategyMarket", "allowedSymbols", "strategyVersionId", "riskPolicy"], "revalidation requirements");
      if (gate.localConnection !== true || gate.permissions !== true || gate.fetchCurrentProductMetadata !== true
        || (gate.strategyMarket !== "spot" && gate.strategyMarket !== "futures")) throw new ControlClientError("revalidation requirements are invalid");
      safeInteger(gate.connectionVersion, "connectionVersion", 1);
      if (typeof gate.deploymentConfigurationHash !== "string" || !HASH.test(gate.deploymentConfigurationHash)) {
        throw new ControlClientError("configuration hash is invalid");
      }
      identifier(gate.strategyVersionId, "strategyVersionId");
      if (!Array.isArray(gate.allowedSymbols) || gate.allowedSymbols.length < 1 || gate.allowedSymbols.length > 100
        || gate.allowedSymbols.some((symbol) => typeof symbol !== "string" || !SYMBOL.test(symbol))
        || new Set(gate.allowedSymbols).size !== gate.allowedSymbols.length) throw new ControlClientError("allowed symbols are invalid");
      const risk = plain(gate.riskPolicy, "risk policy"); exact(risk, ["id", "versionFence", "hash"], "risk policy");
      identifier(risk.id, "risk policy id");
      if (typeof risk.hash !== "string" || !HASH.test(risk.hash)) throw new ControlClientError("risk policy hash is invalid");
      const fence = plain(risk.versionFence, "risk policy fence"); exact(fence, ["updatedAt"], "risk policy fence");
      safeInteger(fence.updatedAt, "risk policy updatedAt");
      break;
    }
    default: throw new ControlClientError("command type is unsupported");
  }
  return Object.freeze(payload);
}

function validateCommand(raw: unknown, now: number): ControlCommand {
  const item = plain(raw, "command");
  exact(item, ["id", "deploymentId", "type", "version", "correlationId", "expectedDeploymentVersion",
    "payload", "createdAt", "expiresAt"], "command");
  const type = text(item.type, "command type", 64);
  if (!COMMAND_TYPES.has(type)) throw new InvalidCommandError("invalid_command");
  if (item.version !== 1) throw new InvalidCommandError("invalid_command");
  const createdAt = safeInteger(item.createdAt, "createdAt");
  const expiresAt = safeInteger(item.expiresAt, "expiresAt");
  if (expiresAt <= now || expiresAt <= createdAt) throw new InvalidCommandError("expired_command");
  if (createdAt > now + 30_000 || expiresAt - createdAt > 86_400_000) throw new InvalidCommandError("invalid_command");
  const correlationId = identifier(item.correlationId, "correlation id");
  return Object.freeze({
    id: identifier(item.id, "command id"), deploymentId: identifier(item.deploymentId, "deployment id"), type,
    version: 1, correlationId,
    expectedDeploymentVersion: safeInteger(item.expectedDeploymentVersion, "expectedDeploymentVersion", 1),
    payload: validatePayload(type, item.payload, { correlationId, now }), createdAt, expiresAt,
  });
}

function hasFreshExecutionWindow(command: ControlCommand, observedAt: number, reserveMs: number): boolean {
  if (!Number.isSafeInteger(observedAt) || observedAt < 0 || command.expiresAt - observedAt <= reserveMs) return false;
  let confirmedAt: unknown;
  if (command.type === "close-positions") confirmedAt = (command.payload.confirmation as Record<string, unknown>).confirmedAt;
  if (command.type === "request-live-unlock") confirmedAt = command.payload.riskAcceptedAt;
  if (confirmedAt !== undefined) {
    if (!Number.isSafeInteger(confirmedAt) || observedAt < (confirmedAt as number)
      || 300_000 - (observedAt - (confirmedAt as number)) <= reserveMs) return false;
  }
  return true;
}

function ackIdentity(raw: unknown): { id: string; deploymentId: string; expectedDeploymentVersion: number } | null {
  try {
    const item = plain(raw, "command");
    return { id: identifier(item.id, "command id"), deploymentId: identifier(item.deploymentId, "deployment id"),
      expectedDeploymentVersion: safeInteger(item.expectedDeploymentVersion, "expectedDeploymentVersion", 1) };
  } catch { return null; }
}

function telemetryEnvelope(raw: unknown): Readonly<Record<string, unknown>> {
  const event = plain(cloneSafeJson(raw), "telemetry event");
  exact(event, ["version", "id", "type", "deploymentId", "expectedDeploymentVersion", "correlationId",
    "occurredAt", "payload"], "telemetry event");
  if (event.version !== 1 || typeof event.type !== "string" || !DEVICE_EVENT_TYPE_SET.has(event.type)) {
    throw new ControlClientError("telemetry event is invalid");
  }
  identifier(event.id, "event id"); identifier(event.deploymentId, "deployment id");
  identifier(event.correlationId, "correlation id");
  safeInteger(event.expectedDeploymentVersion, "expectedDeploymentVersion", 1);
  safeInteger(event.occurredAt, "occurredAt"); plain(event.payload, "event payload");
  return Object.freeze(event);
}

const defaultSleep = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

export function createControlClient(options: ControlClientOptions) {
  let base: URL;
  try { base = new URL(options.baseUrl); } catch { throw new ControlClientError("control-plane URL is invalid"); }
  const loopback = base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if ((base.protocol !== "https:" && !loopback) || base.username || base.password || base.hash || base.search) {
    throw new ControlClientError("control-plane URL must be HTTPS");
  }
  const fetcher = options.fetch ?? fetch;
  const implementation = options.crypto ?? crypto;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const limit = options.pollLimit ?? 50;
  const idlePollMs = options.idlePollMs ?? 2_000;
  const minimumBackoffMs = options.minimumBackoffMs ?? 500;
  const maximumBackoffMs = options.maximumBackoffMs ?? 30_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  const maximumPollPages = options.maximumPollPages ?? 20;
  const minimumAcknowledgementWindowMs = options.minimumAcknowledgementWindowMs ?? 10_000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || ![idlePollMs, minimumBackoffMs, maximumBackoffMs].every((value) => Number.isSafeInteger(value) && value >= 0)
    || maximumBackoffMs < minimumBackoffMs || maximumBackoffMs > 300_000
    || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 60_000
    || !Number.isSafeInteger(maximumPollPages) || maximumPollPages < 1 || maximumPollPages > 100
    || !Number.isSafeInteger(minimumAcknowledgementWindowMs) || minimumAcknowledgementWindowMs < 1_000
    || minimumAcknowledgementWindowMs > 300_000) {
    throw new ControlClientError("polling bounds are invalid");
  }
  if (!options.outcomeStore || typeof options.outcomeStore.get !== "function"
    || typeof options.outcomeStore.list !== "function" || typeof options.outcomeStore.put !== "function"
    || typeof options.outcomeStore.delete !== "function") {
    throw new ControlClientError("a durable command outcome store is required");
  }
  if (typeof options.onExpiredOutcome !== "function") throw new ControlClientError("an expired outcome audit sink is required");

  let nonceCounter = 0;
  let revoked = false;
  let revocationNotified = false;
  const responseTimeouts = new WeakMap<Response, ReturnType<typeof setTimeout>>();

  const resolveIdentity = async (): Promise<ControlDeviceIdentity> => {
    if (revoked) throw new ControlClientRevokedError();
    const identity = typeof options.identity === "function" ? await options.identity() : options.identity;
    if (!identity || !ID.test(identity.deviceId) || !/^cred_[A-Za-z0-9_-]{43}$/.test(identity.credential)
      || !Number.isSafeInteger(identity.credentialExpiresAt) || identity.credentialExpiresAt <= now()
      || typeof identity.sign !== "function") {
      await revoke(); throw new ControlClientRevokedError();
    }
    return identity;
  };

  const revoke = async (): Promise<void> => {
    revoked = true;
    if (!revocationNotified) {
      revocationNotified = true;
      try { await options.onRevoked?.(); } catch { /* Revocation remains fail-closed even if cleanup reporting fails. */ }
    }
  };

  const nextNonce = (): string => {
    nonceCounter += 1;
    if (!Number.isSafeInteger(nonceCounter)) throw new ControlClientError("nonce sequence exhausted");
    const random = new Uint8Array(24);
    implementation.getRandomValues(random);
    return `nonce_${bytesToBase64url(random)}_${nonceCounter.toString(36)}`;
  };

  const createSignedRequest = async (pathAndQuery: string, body?: unknown, timestamp = now(), method?: "GET" | "POST"):
  Promise<SignedDeviceRequest> => {
    const identity = await resolveIdentity();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new ControlClientError("timestamp is invalid");
    if (typeof pathAndQuery !== "string" || !pathAndQuery.startsWith("/") || pathAndQuery.startsWith("//") || pathAndQuery.includes("#")) {
      throw new ControlClientError("request path is invalid");
    }
    const url = new URL(pathAndQuery, base);
    if (url.origin !== base.origin) throw new ControlClientError("request origin is invalid");
    const actualMethod = method ?? (body === undefined ? "GET" : "POST");
    if (actualMethod === "GET" && body !== undefined) throw new ControlClientError("GET request body is forbidden");
    const serialized = body === undefined ? undefined : safeControlJson(body);
    const bodyBytes = serialized === undefined ? new Uint8Array() : encoder.encode(serialized);
    const nonce = nextNonce();
    const digest = bytesToHex(await sha256(bodyBytes, implementation));
    const canonical = `${actualMethod}\n${url.pathname}${url.search}\n${timestamp}\n${nonce}\n${digest}`;
    const signature = await identity.sign(encoder.encode(canonical));
    if (Object.prototype.toString.call(signature) !== "[object Uint8Array]" || signature.byteLength !== 64) {
      throw new ControlClientError("device signer returned an invalid signature");
    }
    const headers = new Headers({
      [DEVICE_HEADERS.authorization]: `Device ${identity.credential}`,
      [DEVICE_HEADERS.deviceId]: identity.deviceId,
      [DEVICE_HEADERS.timestamp]: String(timestamp),
      [DEVICE_HEADERS.nonce]: nonce,
      [DEVICE_HEADERS.signature]: bytesToBase64url(signature),
    });
    if (serialized !== undefined) headers.set("Content-Type", "application/json");
    return Object.freeze({ url: url.href, method: actualMethod, headers, ...(serialized === undefined ? {} : { body: serialized }) });
  };

  const send = async (request: SignedDeviceRequest): Promise<Response> => {
    if (revoked) throw new ControlClientRevokedError();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response: Response;
    try {
      response = await fetcher(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch { clearTimeout(timeout); throw new ControlClientError("control-plane request failed"); }
    if (response.status === 401 || response.status === 403) {
      clearTimeout(timeout);
      await revoke(); throw new ControlClientRevokedError();
    }
    if (!response.ok) { clearTimeout(timeout); throw new ControlClientError("control-plane request failed"); }
    // Keep the same deadline alive until the bounded response body has been
    // consumed; fetch may resolve as soon as headers arrive.
    responseTimeouts.set(response, timeout);
    return response;
  };

  const responseJson = async (response: Response): Promise<unknown> => {
    const timeout = responseTimeouts.get(response);
    try {
    const type = response.headers.get("content-type") ?? "";
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type)) throw new ControlClientError("control-plane response is invalid");
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^(?:0|[1-9]\d*)$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
      throw new ControlClientError(Number(declared) > MAX_RESPONSE_BYTES
        ? "control-plane response is too large" : "control-plane response is invalid");
    }
    if (!response.body) throw new ControlClientError("control-plane response is invalid");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    let bodyTimedOut = false;
    let bodyTimeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      bodyTimeout = setTimeout(() => {
        bodyTimedOut = true;
        reject(new ControlClientError("control-plane response timed out"));
        void reader.cancel("response deadline exceeded").catch(() => undefined);
      }, requestTimeoutMs);
    });
    try {
      while (true) {
        const chunk = await Promise.race([reader.read(), deadline]);
        if (bodyTimedOut) throw new ControlClientError("control-plane response timed out");
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel("response too large");
          throw new ControlClientError("control-plane response is too large");
        }
        chunks.push(Uint8Array.from(chunk.value));
      }
    } finally { clearTimeout(bodyTimeout!); reader.releaseLock(); }
    // Content-Length is the compressed wire length in common Fetch/Undici
    // stacks, while chunks are transparently decompressed. It is therefore a
    // preflight upper bound only; the streaming cap protects decoded bytes.
    if (size === 0) throw new ControlClientError("control-plane response is invalid");
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new ControlClientError("control-plane response is invalid"); }
    } finally {
      if (timeout) clearTimeout(timeout);
      responseTimeouts.delete(response);
    }
  };

  const acknowledgementId = async (commandId: string): Promise<string> =>
    `ack_${bytesToHex(await sha256(encoder.encode(commandId), implementation))}`;

  const acknowledge = async (identity: { id: string; deploymentId: string; expectedDeploymentVersion: number },
    outcome: { status: "ok" | "rejected" | "failed"; code: string; message: string; applied: boolean }): Promise<void> => {
    const body = { id: await acknowledgementId(identity.id), deploymentId: identity.deploymentId,
      expectedDeploymentVersion: identity.expectedDeploymentVersion, status: outcome.status,
      payload: { applied: outcome.applied, code: outcome.code, message: outcome.message } };
    const request = await createSignedRequest(`/api/agent/commands/${encodeURIComponent(identity.id)}/ack`, body, now(), "POST");
    const result = plain(await responseJson(await send(request)), "acknowledgement response");
    exact(result, ["commandId", "status", "idempotent"], "acknowledgement response");
    if (result.commandId !== identity.id || result.status !== "acknowledged" || typeof result.idempotent !== "boolean") {
      throw new ControlClientError("acknowledgement response is invalid");
    }
  };

  const drainOutcomes = async (): Promise<number> => {
    let drained = 0;
    // The store itself is capped at 2,048 records. Enumerate that complete
    // bounded set once so failed dead-letter sinks cannot keep the cursor on
    // the first 100 records and poison newer outcomes or emergency commands.
    const pending = await options.outcomeStore.list(2_048);
    if (pending.length > 2_048) throw new ControlClientError("pending outcome set is invalid");
    for (const raw of pending) {
      const item = parsePendingAcknowledgement(raw);
      const observedAt = now();
      if (observedAt >= item.expiresAt && observedAt - item.expiresAt >= CONTROL_CLIENT_LATE_ACK_WINDOW_MS) {
        // Server intentionally stops accepting outcomes at this exact
        // boundary. Audit locally, then discard so a terminal old record
        // cannot poison emergency-control polling forever.
        try { await options.onExpiredOutcome(item); }
        catch { continue; /* Retain for the next audit-sink retry, but do not poison newer work. */ }
        await options.outcomeStore.delete(item.commandId);
        drained += 1;
        continue;
      }
      await acknowledge({ id: item.commandId, deploymentId: item.deploymentId,
        expectedDeploymentVersion: item.expectedDeploymentVersion }, item.outcome);
      await options.outcomeStore.delete(item.commandId);
      drained += 1;
    }
    return drained;
  };

  const processCommand = async (raw: unknown): Promise<void> => {
    const bindable = ackIdentity(raw);
    if (!bindable) throw new ControlClientError("unacknowledgeable command is invalid");
    let command: ControlCommand;
    try { command = validateCommand(raw, now()); }
    catch (error) {
      const code = error instanceof InvalidCommandError ? error.code : "invalid_command";
      await acknowledge(bindable, { status: "rejected", code, message: "Command validation failed", applied: false });
      return;
    }
    const recovered = await options.outcomeStore.get(command.id);
    if (recovered && (recovered.commandId !== command.id || recovered.deploymentId !== command.deploymentId
      || recovered.expectedDeploymentVersion !== command.expectedDeploymentVersion)) {
      throw new ControlClientError("stored command outcome identity conflict");
    }
    let outcome = recovered === null ? null : parseStoredCommandOutcome(recovered.outcome);
    if (!outcome) {
      const currentVersion = await options.deploymentVersion(command.deploymentId);
      if (!Number.isSafeInteger(currentVersion) || currentVersion !== command.expectedDeploymentVersion) {
        outcome = { status: "rejected", code: "deployment_fence", message: "Deployment version does not match", applied: false };
      } else if (!hasFreshExecutionWindow(command, now(), minimumAcknowledgementWindowMs)) {
        outcome = { status: "rejected", code: "expired_command", message: "Command expired before execution", applied: false };
      } else {
        // Persist a fail-closed recovery marker before crossing the side-effect
        // boundary. A crash can therefore never cause blind re-execution.
        await options.outcomeStore.put(command, {
          status: "failed", code: "execution_interrupted", message: "Command execution interrupted", applied: false,
        });
        // Re-check after the durable write: disk/keychain waits can cross both
        // command expiry and the five-minute destructive-consent boundary.
        if (!hasFreshExecutionWindow(command, now(), minimumAcknowledgementWindowMs)) {
          outcome = { status: "rejected", code: "expired_command", message: "Command expired before execution", applied: false };
        } else {
          try {
            const result = await options.execute(command);
            if (!result || (result.status !== "ok" && result.status !== "rejected")
              || typeof result.code !== "string" || !SAFE_CODE.test(result.code)) throw new Error("invalid execution result");
            outcome = result.status === "ok"
              ? { status: "ok", code: "applied", message: "Command applied", applied: true }
              : { status: "rejected", code: "local_rejection", message: "Command rejected locally", applied: false };
          } catch {
            outcome = { status: "failed", code: "execution_failed", message: "Command execution failed", applied: false };
          }
        }
      }
      await options.outcomeStore.put(command, outcome);
    }
    await acknowledge(command, outcome);
    await options.outcomeStore.delete(command.id);
  };

  const pollOnce = async (): Promise<number> => {
    await drainOutcomes();
    let cursor: { createdAt: number; id: string } | null = null;
    let processed = 0; let pages = 0;
    const seenCursors = new Set<string>();
    const seenCommands = new Set<string>();
    do {
      pages += 1;
      if (pages > maximumPollPages) throw new ControlClientError("command pagination limit exceeded");
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor) { query.set("cursorCreatedAt", String(cursor.createdAt)); query.set("cursorId", cursor.id); }
      const request = await createSignedRequest(`/api/agent/commands?${query}`, undefined, now(), "GET");
      const response = plain(await responseJson(await send(request)), "command response");
      exact(response, ["commands", "nextCursor"], "command response");
      if (!Array.isArray(response.commands) || response.commands.length > limit) throw new ControlClientError("command response is invalid");
      for (const command of response.commands) {
        const identity = ackIdentity(command);
        if (!identity || seenCommands.has(identity.id)) throw new ControlClientError("command response contains duplicate or invalid ids");
        seenCommands.add(identity.id);
        await processCommand(command); processed += 1;
      }
      if (response.nextCursor === null) cursor = null;
      else {
        const next = plain(response.nextCursor, "command cursor"); exact(next, ["createdAt", "id"], "command cursor");
        cursor = { createdAt: safeInteger(next.createdAt, "cursor createdAt"), id: identifier(next.id, "cursor id") };
        const cursorKey = `${cursor.createdAt}\n${cursor.id}`;
        if (seenCursors.has(cursorKey)) throw new ControlClientError("command cursor repeated");
        seenCursors.add(cursorKey);
      }
    } while (cursor !== null);
    return processed;
  };

  const uploadOnce = async (buffer: TelemetryUploadBuffer, batchLimit = 50): Promise<number> => {
    if (!Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > 50
      || !buffer || typeof buffer.nextBatch !== "function" || typeof buffer.acknowledge !== "function") {
      throw new ControlClientError("telemetry upload bounds are invalid");
    }
    const batch = await buffer.nextBatch(batchLimit);
    if (batch === null) return 0;
    if (!ID.test(batch.batchId) || !Array.isArray(batch.events)
      || batch.events.length < 1 || batch.events.length > batchLimit) throw new ControlClientError("telemetry batch is invalid");
    const events = batch.events.map(telemetryEnvelope);
    if (new Set(events.map((event) => event.id)).size !== events.length) throw new ControlClientError("telemetry batch contains duplicate ids");
    const heartbeats = events.filter((event) => event.type === "heartbeat");
    const regular = events.filter((event) => event.type !== "heartbeat");
    const terminalEventIds: string[] = [];

    // Heartbeats have a dedicated server route and response contract.
    for (const event of heartbeats) {
      const request = await createSignedRequest("/api/agent/heartbeat", event, now(), "POST");
      const response = plain(await responseJson(await send(request)), "heartbeat response");
      exact(response, ["accepted"], "heartbeat response");
      if (!Array.isArray(response.accepted) || response.accepted.length !== 1) throw new ControlClientError("heartbeat response is invalid");
      const accepted = plain(response.accepted[0], "heartbeat result"); exact(accepted, ["id", "status"], "heartbeat result");
      if (accepted.id !== event.id || (accepted.status !== "accepted" && accepted.status !== "duplicate")) {
        throw new ControlClientError("heartbeat response is invalid");
      }
      terminalEventIds.push(event.id as string);
    }

    if (regular.length > 0) {
      const request = await createSignedRequest("/api/agent/events", { events: regular }, now(), "POST");
      const response = plain(await responseJson(await send(request)), "event response");
      exact(response, ["results"], "event response");
      if (!Array.isArray(response.results) || response.results.length !== regular.length) {
        throw new ControlClientError("event response is invalid");
      }
      const seen = new Set<number>();
      for (const raw of response.results) {
        const result = plain(raw, "event result");
        if (result.status === "accepted" || result.status === "duplicate") {
          exact(result, ["index", "eventId", "status", "code"], "event result");
        } else {
          exact(result, ["index", "status", "code"], "event result");
        }
        const index = safeInteger(result.index, "event result index");
        if (index >= regular.length || seen.has(index)) throw new ControlClientError("event response is invalid");
        seen.add(index);
        if (result.status === "accepted" || result.status === "duplicate") {
          if (result.eventId !== regular[index]!.id || result.code !== result.status) {
            throw new ControlClientError("event response is invalid");
          }
          terminalEventIds.push(regular[index]!.id as string);
        } else if (result.status === "rejected") {
          if (result.code !== "invalid_event" && result.code !== "deployment_fence" && result.code !== "event_conflict") {
            throw new ControlClientError("event response is invalid");
          }
          terminalEventIds.push(regular[index]!.id as string);
        } else if (result.status !== "retryable" || result.code !== "internal") {
          throw new ControlClientError("event response is invalid");
        }
      }
      if (seen.size !== regular.length) throw new ControlClientError("event response is invalid");
    }
    if (!await buffer.acknowledge(batch.batchId, terminalEventIds)) {
      throw new ControlClientError("telemetry acknowledgement fence failed");
    }
    return events.length;
  };

  const run = async (signal: AbortSignal): Promise<void> => {
    let backoff = minimumBackoffMs;
    while (!signal.aborted) {
      try {
        const count = await pollOnce();
        backoff = minimumBackoffMs;
        if (!signal.aborted) await sleep(count === 0 ? idlePollMs : 0, signal);
      } catch (error) {
        if (error instanceof ControlClientRevokedError) throw error;
        if (signal.aborted) return;
        await sleep(backoff, signal);
        backoff = Math.min(maximumBackoffMs, Math.max(minimumBackoffMs, backoff === 0 ? 1 : backoff * 2));
      }
    }
  };

  return Object.freeze({ createSignedRequest, pollOnce, uploadOnce, run, isRevoked: () => revoked });
}
