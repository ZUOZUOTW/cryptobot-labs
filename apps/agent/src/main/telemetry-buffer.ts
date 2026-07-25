import { createHash } from "node:crypto";

import {
  createNodeVaultFileStore,
  type AsyncSafeStorage,
  type VaultFileStore,
} from "./vault";

/** Must remain wire-compatible with lib/server/device-events.ts. */
export const DEVICE_EVENT_TYPES = [
  "heartbeat",
  "connection-verified",
  "signal",
  "risk-block",
  "order-state",
  "fill",
  "deployment-state",
  "key-rotated",
  "key-erased",
  "agent-error",
] as const;

export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

/** Exact event envelope accepted by POST /api/agent/events. */
export interface TelemetryEventEnvelope {
  readonly version: 1;
  readonly id: string;
  readonly type: DeviceEventType;
  readonly deploymentId: string;
  readonly expectedDeploymentVersion: number;
  readonly correlationId: string;
  readonly occurredAt: number;
  readonly payload: JsonObject;
}

export type TelemetryPriority = "low" | "normal" | "high" | "critical";

export interface TelemetryBatch {
  /** Local acknowledgement handle. It is not part of the server request body. */
  readonly batchId: string;
  /** These are the exact wire envelopes; local priority metadata is removed. */
  readonly events: readonly TelemetryEventEnvelope[];
}

export interface TelemetryBuffer {
  enqueue(event: TelemetryEventEnvelope, options?: { readonly priority?: TelemetryPriority }): Promise<TelemetryEventEnvelope>;
  nextBatch(limit?: number): Promise<TelemetryBatch | null>;
  acknowledge(batchId: string, eventIds?: readonly string[]): Promise<boolean>;
  count(): Promise<number>;
  erase(): Promise<void>;
}

export interface TelemetryBufferOptions { readonly maxDiskBytes?: number }

interface StoredEvent {
  event: TelemetryEventEnvelope;
  priority: TelemetryPriority;
}

interface PersistedBatch { batchId: string; eventIds: string[] }
interface PersistedState {
  version: 1;
  events: StoredEvent[];
  inFlight: PersistedBatch | null;
}

const STORE_VERSION = 1;
const FILE_MODE = 0o600;
const MAX_EVENTS = 10_000;
const MAX_BATCH_SIZE = 50;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 2_048;
const MAX_PAYLOAD_BYTES = 65_536;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENVELOPE_KEYS = [
  "version", "id", "type", "deploymentId", "expectedDeploymentVersion",
  "correlationId", "occurredAt", "payload",
] as const;
const PRIORITIES = ["low", "normal", "high", "critical"] as const;
const PRIORITY_VALUE: Record<TelemetryPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};
const FORBIDDEN_NAMES = [
  "secret", "apikey", "accesskey", "passphrase", "accesssign", "signature",
  "credential", "authorization", "authentication", "cookie", "privatekey",
  "rawaccount", "header", "token",
] as const;

const emptyState = (): PersistedState => ({ version: STORE_VERSION, events: [], inFlight: null });

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${label} contains non-JSON symbol fields`);
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor) || !descriptor.enumerable) throw new Error(`${label} contains non-JSON properties`);
    Object.defineProperty(result, key, { enumerable: true, configurable: true, writable: true, value: descriptor.value });
  }
  return result;
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${label} is invalid`);
  scanSecretString(value);
  return value;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${label} is invalid`);
  return value as number;
}

function normalizedName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assertSafeName(name: string): void {
  const normalized = normalizedName(name);
  if (
    normalized !== "apikeysuffix"
    && normalized !== "maskedapikeysuffix"
    && normalized !== "haslocalcredential"
    && FORBIDDEN_NAMES.some((part) => normalized.includes(part))
  ) {
    throw new Error("Telemetry contains forbidden credential material");
  }
}

function scanSecretString(value: string): void {
  const scanned = value.normalize("NFKC");
  const lower = scanned.toLowerCase();
  const highEntropy = (scanned.match(/[A-Za-z0-9+/_=-]{32,}/g) ?? []).some((token) =>
    /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token) && new Set(token).size >= 16);
  if (
    /-----begin (?:rsa |ec |ed25519 )?private key-----/.test(lower)
    || /^(?:bearer|basic)\s+[a-z0-9+/_=-]{8,}$/i.test(scanned)
    || /(?:api[_ -]?(?:secret|key)|access[_ -]?key|secret[_ -]?key|pass[_ -]?phrase|weex[_ -]?(?:api[_ -]?)?key|weex[_ -]?access[_ -]?sign|access[_ -]?sign|authorization|set-cookie|cookie)\s*[:=]/i.test(scanned)
    || /\b(?:cred|bst)_[A-Za-z0-9_-]{16,}\b/.test(scanned)
    || /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}\b/.test(scanned)
    || highEntropy
  ) {
    throw new Error("Telemetry contains forbidden credential material");
  }
}

/** Detaches, bounds, cycle-checks and secret-scans arbitrary payload input. */
function safePayload(value: unknown): JsonObject {
  const active = new WeakSet<object>();
  let nodes = 0;

  function clone(item: unknown, depth: number): JsonValue {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new Error("Telemetry payload is too complex");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") { scanSecretString(item); return item; }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("Telemetry payload contains a non-finite number");
      return item;
    }
    if (typeof item !== "object") throw new Error("Telemetry payload contains a non-JSON value");
    if (active.has(item)) throw new Error("Telemetry payload cannot be cyclic");
    active.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || Object.getOwnPropertySymbols(item).length > 0) {
          throw new Error("Telemetry payload contains a non-JSON array");
        }
        const names = Object.getOwnPropertyNames(item).filter((key) => key !== "length");
        if (names.length !== item.length || names.some((key, index) => key !== String(index))) {
          throw new Error("Telemetry payload contains a sparse or extended array");
        }
        return names.map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error("Telemetry payload contains a non-JSON property");
          return clone(descriptor.value, depth + 1);
        });
      }

      const record = plainRecord(item, "Telemetry payload");
      const result = Object.create(null) as JsonObject;
      for (const [key, child] of Object.entries(record)) {
        if (key.length > 256 || /[\u0000-\u001f\u007f]/.test(key)) throw new Error("Telemetry payload key is invalid");
        assertSafeName(key);
        Object.defineProperty(result, key, {
          enumerable: true,
          configurable: true,
          writable: true,
          value: clone(child, depth + 1),
        });
      }
      return result;
    } finally {
      active.delete(item);
    }
  }

  const cloned = clone(value, 0);
  if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) throw new Error("Telemetry payload must be a plain object");
  const serialized = JSON.stringify(cloned);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) throw new Error("Telemetry payload exceeds the size limit");
  // JSON.parse creates a detached ordinary object, including safe own
  // `__proto__` properties, without retaining caller prototypes.
  return JSON.parse(serialized) as JsonObject;
}

function validateEnvelope(value: unknown): TelemetryEventEnvelope {
  const event = plainRecord(value, "Telemetry event");
  assertExactKeys(event, ENVELOPE_KEYS, "Telemetry event");
  if (event.version !== 1) throw new Error("Telemetry event version is unsupported");
  if (typeof event.type !== "string" || !DEVICE_EVENT_TYPES.includes(event.type as DeviceEventType)) {
    throw new Error("Telemetry event type is unsupported");
  }
  const parsed: TelemetryEventEnvelope = {
    version: 1,
    id: identifier(event.id, "Telemetry event id"),
    type: event.type as DeviceEventType,
    deploymentId: identifier(event.deploymentId, "Telemetry deployment id"),
    expectedDeploymentVersion: safeInteger(event.expectedDeploymentVersion, "Telemetry deployment version", 1),
    correlationId: identifier(event.correlationId, "Telemetry correlation id"),
    occurredAt: safeInteger(event.occurredAt, "Telemetry occurredAt"),
    payload: safePayload(event.payload),
  };
  return Object.freeze(parsed);
}

function parsePriority(value: unknown): TelemetryPriority {
  if (typeof value !== "string" || !PRIORITIES.includes(value as TelemetryPriority)) throw new Error("Telemetry priority is invalid");
  return value as TelemetryPriority;
}

function parseState(plaintext: string): PersistedState {
  let raw: unknown;
  try { raw = JSON.parse(plaintext); } catch { throw new Error("Telemetry store is corrupt"); }
  const state = plainRecord(raw, "Telemetry store");
  assertExactKeys(state, ["version", "events", "inFlight"], "Telemetry store");
  if (state.version !== STORE_VERSION || !Array.isArray(state.events) || state.events.length > MAX_EVENTS) throw new Error("Telemetry store is corrupt");
  const events = state.events.map((rawEvent): StoredEvent => {
    const stored = plainRecord(rawEvent, "Stored telemetry event");
    assertExactKeys(stored, ["event", "priority"], "Stored telemetry event");
    return { event: validateEnvelope(stored.event), priority: parsePriority(stored.priority) };
  });
  if (new Set(events.map(({ event }) => event.id)).size !== events.length) throw new Error("Telemetry store is corrupt");

  let inFlight: PersistedBatch | null = null;
  if (state.inFlight !== null) {
    const batch = plainRecord(state.inFlight, "Stored telemetry batch");
    assertExactKeys(batch, ["batchId", "eventIds"], "Stored telemetry batch");
    const batchId = identifier(batch.batchId, "Telemetry batch id");
    if (!Array.isArray(batch.eventIds) || batch.eventIds.length < 1 || batch.eventIds.length > MAX_BATCH_SIZE) throw new Error("Telemetry store is corrupt");
    const eventIds = batch.eventIds.map((id) => identifier(id, "Telemetry event id"));
    const available = new Set(events.map(({ event }) => event.id));
    if (new Set(eventIds).size !== eventIds.length || eventIds.some((id) => !available.has(id))) throw new Error("Telemetry store is corrupt");
    inFlight = { batchId, eventIds };
  }
  return { version: STORE_VERSION, events, inFlight };
}

async function ensureEncryption(storage: AsyncSafeStorage): Promise<void> {
  if (!(await storage.isAsyncEncryptionAvailable())) throw new Error("OS-backed telemetry encryption is unavailable");
}

async function encryptState(storage: AsyncSafeStorage, state: PersistedState): Promise<Uint8Array> {
  await ensureEncryption(storage);
  const operation = storage.encryptStringAsync ?? storage.encryptString;
  if (!operation) throw new Error("Asynchronous telemetry encryption is unavailable");
  const plaintext = Buffer.from(JSON.stringify(state), "utf8");
  try {
    const result = await operation.call(storage, plaintext.toString("utf8"));
    if (!(result instanceof Uint8Array) || result.byteLength === 0) throw new Error("Telemetry encryption returned an invalid result");
    return Uint8Array.from(result);
  } finally { plaintext.fill(0); }
}

async function readState(storage: AsyncSafeStorage, store: VaultFileStore): Promise<PersistedState> {
  await ensureEncryption(storage);
  const ciphertext = await store.read();
  if (!ciphertext) return emptyState();
  const copy = Uint8Array.from(ciphertext);
  try {
    const operation = storage.decryptStringAsync ?? storage.decryptString;
    if (!operation) throw new Error("Asynchronous telemetry decryption is unavailable");
    return parseState(await operation.call(storage, copy));
  } finally { copy.fill(0); }
}

function batchId(eventIds: readonly string[]): string {
  return `batch-${createHash("sha256").update(eventIds.join("\n")).digest("hex").slice(0, 32)}`;
}

export function createTelemetryBuffer(
  storage: AsyncSafeStorage,
  store: VaultFileStore,
  options: TelemetryBufferOptions = {},
): TelemetryBuffer {
  const maxDiskBytes = options.maxDiskBytes ?? 4 * 1024 * 1024;
  if (!Number.isSafeInteger(maxDiskBytes) || maxDiskBytes < 256) throw new Error("Invalid telemetry disk cap");
  let operationQueue: Promise<void> = Promise.resolve();

  function exclusively<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function persistWithinCap(
    state: PersistedState,
    protectedIds = new Set<string>(),
    evictionCeiling = PRIORITY_VALUE.critical,
  ): Promise<void> {
    let encrypted = await encryptState(storage, state);
    try {
      while (encrypted.byteLength > maxDiskBytes && state.events.length > 0) {
        let candidate = -1;
        for (let index = 0; index < state.events.length; index += 1) {
          const current = state.events[index]!;
          if (protectedIds.has(current.event.id)) continue;
          if (PRIORITY_VALUE[current.priority] > evictionCeiling) continue;
          if (candidate < 0 || PRIORITY_VALUE[current.priority] < PRIORITY_VALUE[state.events[candidate]!.priority]) candidate = index;
        }
        if (candidate < 0) throw new Error("Telemetry record exceeds the disk cap");
        const [removed] = state.events.splice(candidate, 1);
        if (state.inFlight?.eventIds.includes(removed!.event.id)) state.inFlight = null;
        encrypted.fill(0);
        encrypted = await encryptState(storage, state);
      }
      if (encrypted.byteLength > maxDiskBytes) throw new Error("Telemetry disk cap is too small");
      await store.writeAtomically(encrypted, FILE_MODE);
    } finally { encrypted.fill(0); }
  }

  return {
    enqueue(input, enqueueOptions = {}) {
      return exclusively(async () => {
        const event = validateEnvelope(input);
        const priority = enqueueOptions.priority ?? (event.type === "heartbeat" ? "low" : "normal");
        parsePriority(priority);
        const state = await readState(storage, store);
        if (state.events.length >= MAX_EVENTS) throw new Error("Telemetry event limit reached");
        if (state.events.some((stored) => stored.event.id === event.id)) throw new Error("Telemetry event ID collision");
        state.events.push({ event, priority });
        await persistWithinCap(state, new Set([event.id]), PRIORITY_VALUE[priority]);
        return event;
      });
    },

    nextBatch(limit = MAX_BATCH_SIZE) {
      return exclusively(async () => {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) throw new Error("Invalid telemetry batch limit");
        const state = await readState(storage, store);
        if (state.events.length === 0) return null;
        if (!state.inFlight) {
          const eventIds = state.events.slice(0, limit).map(({ event }) => event.id);
          state.inFlight = { batchId: batchId(eventIds), eventIds };
          // Creating an upload handle must never discard a queued event. The
          // enqueue path already enforces the disk cap by event priority.
          await persistWithinCap(state, new Set(eventIds), -1);
        }
        const byId = new Map(state.events.map(({ event }) => [event.id, event]));
        return Object.freeze({
          batchId: state.inFlight.batchId,
          events: Object.freeze(state.inFlight.eventIds.map((id) => byId.get(id)!)),
        });
      });
    },

    acknowledge(id, terminalEventIds) {
      return exclusively(async () => {
        identifier(id, "Telemetry batch id");
        const state = await readState(storage, store);
        if (!state.inFlight || state.inFlight.batchId !== id) return false;
        const terminalIds = terminalEventIds === undefined
          ? [...state.inFlight.eventIds]
          : [...terminalEventIds];
        if (terminalIds.length > MAX_BATCH_SIZE) throw new Error("Too many acknowledged telemetry event IDs");
        const inFlightIds = new Set(state.inFlight.eventIds);
        const acknowledged = new Set<string>();
        for (const eventId of terminalIds) {
          identifier(eventId, "Acknowledged telemetry event id");
          if (!inFlightIds.has(eventId)) throw new Error("Acknowledged telemetry event is not in flight");
          if (acknowledged.has(eventId)) throw new Error("Duplicate acknowledged telemetry event ID");
          acknowledged.add(eventId);
        }
        state.events = state.events.filter(({ event }) => !acknowledged.has(event.id));
        state.inFlight = null;
        if (state.events.length === 0) await store.erase();
        else await persistWithinCap(state);
        return true;
      });
    },

    count() { return exclusively(async () => (await readState(storage, store)).events.length); },
    erase() { return exclusively(() => store.erase()); },
  };
}

export function createNodeTelemetryFileStore(filePath: string): VaultFileStore {
  return createNodeVaultFileStore(filePath);
}
