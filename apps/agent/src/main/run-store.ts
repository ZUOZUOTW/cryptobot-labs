import type { ExecutionMode, Market } from "@cryptobot-labs/trading-core";

import {
  createNodeVaultFileStore,
  type AsyncSafeStorage,
  type VaultFileStore,
} from "./vault";

export type DurableRunStatus = "running" | "paused" | "stopped";

/** A restart record deliberately excludes strategy source and all credentials. */
export interface DurableRunDefinition {
  readonly deploymentId: string;
  readonly configurationVersion: string;
  readonly scriptHash: string;
  readonly mode: ExecutionMode;
  readonly market: Market;
  readonly symbol: string;
}

export interface AmbiguousOrderLatch {
  readonly at: number;
  readonly clientOrderId: string;
  readonly reason: "ambiguous-order";
}

export interface DurableRunState {
  readonly definition: DurableRunDefinition;
  readonly status: DurableRunStatus;
  readonly pausedReason: string | null;
  readonly ambiguousOrder: AmbiguousOrderLatch | null;
  readonly updatedAt: number;
}

export interface DurableRunRecord extends DurableRunState {
  readonly schemaVersion: 1;
  readonly recordVersion: number;
}

export interface RestoredRunState extends DurableRunRecord {
  /** Restart never authorizes automatic execution. */
  readonly resumeAllowed: false;
  readonly restoredStatus: "paused" | "stopped";
  readonly restoredReason: string | null;
}

export interface DurableRunStore {
  save(state: DurableRunState, expectedVersion: number | null): Promise<DurableRunRecord>;
  restore(): Promise<RestoredRunState | null>;
  erase(): Promise<void>;
}

const FILE_MODE = 0o600;
const MAX_PLAINTEXT_BYTES = 8 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SYMBOL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/u;
const REASON = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MODES: readonly ExecutionMode[] = ["paper", "futures-demo", "live"];
const MARKETS: readonly Market[] = ["spot", "futures"];

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is corrupt`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} is corrupt`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${label} is corrupt`);
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor) || !descriptor.enumerable) throw new Error(`${label} is corrupt`);
    result[key] = descriptor.value;
  }
  return result;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length ||
      actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${label} is corrupt`);
  }
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${label} is corrupt`);
  return value as number;
}

function stringMatching(value: unknown, expression: RegExp, label: string): string {
  if (typeof value !== "string" || !expression.test(value)) throw new Error(`${label} is corrupt`);
  return value;
}

function parseDefinition(value: unknown): DurableRunDefinition {
  const definition = plainRecord(value, "Run definition");
  exactKeys(
    definition,
    ["deploymentId", "configurationVersion", "scriptHash", "mode", "market", "symbol"],
    "Run definition",
  );
  if (typeof definition.mode !== "string" ||
      !MODES.includes(definition.mode as ExecutionMode)) throw new Error("Run definition is corrupt");
  if (typeof definition.market !== "string" ||
      !MARKETS.includes(definition.market as Market)) throw new Error("Run definition is corrupt");
  if (definition.mode === "futures-demo" && definition.market !== "futures") {
    throw new Error("Run definition is corrupt");
  }
  return Object.freeze({
    deploymentId: stringMatching(definition.deploymentId, ID, "Run deployment id"),
    configurationVersion: stringMatching(
      definition.configurationVersion,
      ID,
      "Run configuration version",
    ),
    scriptHash: stringMatching(definition.scriptHash, HASH, "Run script hash"),
    mode: definition.mode as ExecutionMode,
    market: definition.market as Market,
    symbol: stringMatching(definition.symbol, SYMBOL, "Run symbol"),
  });
}

function parseAmbiguousOrder(value: unknown): AmbiguousOrderLatch | null {
  if (value === null) return null;
  const latch = plainRecord(value, "Ambiguous order latch");
  exactKeys(latch, ["at", "clientOrderId", "reason"], "Ambiguous order latch");
  if (latch.reason !== "ambiguous-order") throw new Error("Ambiguous order latch is corrupt");
  return Object.freeze({
    at: safeInteger(latch.at, "Ambiguous order timestamp"),
    clientOrderId: stringMatching(latch.clientOrderId, ID, "Ambiguous client order id"),
    reason: "ambiguous-order",
  });
}

function parseRecord(value: unknown): DurableRunRecord {
  const record = plainRecord(value, "Run store");
  exactKeys(
    record,
    [
      "schemaVersion", "recordVersion", "definition", "status", "pausedReason",
      "ambiguousOrder", "updatedAt",
    ],
    "Run store",
  );
  if (record.schemaVersion !== 1) throw new Error("Run store version is unsupported");
  if (record.status !== "running" && record.status !== "paused" && record.status !== "stopped") {
    throw new Error("Run store is corrupt");
  }
  if (record.pausedReason !== null &&
      (typeof record.pausedReason !== "string" || !REASON.test(record.pausedReason))) {
    throw new Error("Run store is corrupt");
  }
  if (record.status === "paused" && record.pausedReason === null) throw new Error("Run store is corrupt");
  if (record.status !== "paused" && record.pausedReason !== null) throw new Error("Run store is corrupt");
  const ambiguousOrder = parseAmbiguousOrder(record.ambiguousOrder);
  if (ambiguousOrder !== null && record.status !== "paused") throw new Error("Run store is corrupt");
  return Object.freeze({
    schemaVersion: 1,
    recordVersion: safeInteger(record.recordVersion, "Run record version", 1),
    definition: parseDefinition(record.definition),
    status: record.status,
    pausedReason: record.pausedReason as string | null,
    ambiguousOrder,
    updatedAt: safeInteger(record.updatedAt, "Run update timestamp"),
  });
}

function parsePlaintext(plaintext: string): DurableRunRecord {
  if (Buffer.byteLength(plaintext, "utf8") > MAX_PLAINTEXT_BYTES) throw new Error("Run store is corrupt");
  let parsed: unknown;
  try { parsed = JSON.parse(plaintext); } catch { throw new Error("Run store is corrupt"); }
  return parseRecord(parsed);
}

async function ensureEncryption(storage: AsyncSafeStorage): Promise<void> {
  if (!(await storage.isAsyncEncryptionAvailable())) {
    throw new Error("OS-backed run-state encryption is unavailable");
  }
}

async function readRecord(
  storage: AsyncSafeStorage,
  fileStore: VaultFileStore,
): Promise<DurableRunRecord | null> {
  await ensureEncryption(storage);
  const ciphertext = await fileStore.read();
  if (!ciphertext) return null;
  const encryptedCopy = Uint8Array.from(ciphertext);
  try {
    const decrypt = storage.decryptStringAsync ?? storage.decryptString;
    if (!decrypt) throw new Error("Asynchronous run-state decryption is unavailable");
    return parsePlaintext(await decrypt.call(storage, encryptedCopy));
  } finally {
    encryptedCopy.fill(0);
  }
}

async function encryptRecord(
  storage: AsyncSafeStorage,
  record: DurableRunRecord,
): Promise<Uint8Array> {
  await ensureEncryption(storage);
  const encrypt = storage.encryptStringAsync ?? storage.encryptString;
  if (!encrypt) throw new Error("Asynchronous run-state encryption is unavailable");
  const plaintext = Buffer.from(JSON.stringify(record), "utf8");
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    plaintext.fill(0);
    throw new Error("Run state exceeds the size limit");
  }
  try {
    const encrypted = await encrypt.call(storage, plaintext.toString("utf8"));
    if (!(encrypted instanceof Uint8Array) || encrypted.byteLength === 0) {
      throw new Error("Run-state encryption returned an invalid payload");
    }
    return Uint8Array.from(encrypted);
  } finally {
    plaintext.fill(0);
  }
}

export function createDurableRunStore(
  storage: AsyncSafeStorage,
  fileStore: VaultFileStore,
): DurableRunStore {
  let operationQueue: Promise<void> = Promise.resolve();

  function exclusively<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  return {
    save(input, expectedVersion) {
      return exclusively(async () => {
        const current = await readRecord(storage, fileStore);
        if ((current?.recordVersion ?? null) !== expectedVersion) {
          throw new Error("Run record version conflict");
        }
        const state = plainRecord(input, "Run state");
        exactKeys(
          state,
          ["definition", "status", "pausedReason", "ambiguousOrder", "updatedAt"],
          "Run state",
        );
        const candidate = parseRecord({
          schemaVersion: 1,
          recordVersion: (current?.recordVersion ?? 0) + 1,
          definition: state.definition,
          status: state.status,
          pausedReason: state.pausedReason,
          ambiguousOrder: state.ambiguousOrder,
          updatedAt: state.updatedAt,
        });
        const encrypted = await encryptRecord(storage, candidate);
        try {
          await fileStore.writeAtomically(encrypted, FILE_MODE);
        } finally {
          encrypted.fill(0);
        }
        return candidate;
      });
    },

    restore() {
      return exclusively(async () => {
        const record = await readRecord(storage, fileStore);
        if (!record) return null;
        const stopped = record.status === "stopped";
        return Object.freeze({
          ...record,
          resumeAllowed: false,
          restoredStatus: stopped ? "stopped" : "paused",
          restoredReason: stopped
            ? null
            : record.ambiguousOrder !== null
              ? "ambiguous-order"
              : record.status === "paused"
                ? record.pausedReason
                : "restart-reconciliation-required",
        });
      });
    },

    erase() { return exclusively(() => fileStore.erase()); },
  };
}

export function createNodeRunFileStore(filePath: string): VaultFileStore {
  return createNodeVaultFileStore(filePath);
}
