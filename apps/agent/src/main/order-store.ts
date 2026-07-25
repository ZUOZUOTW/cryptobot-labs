import {
  parseTrackedOrder,
  sameExecutionTarget,
  type OrderRepository,
  type ProposalClaim,
  type TrackedOrder,
} from "@cryptobot-labs/trading-core";

import type { AsyncSafeStorage, VaultFileStore } from "./vault";

const MAX_ORDERS = 1_024;
const MAX_PLAINTEXT_BYTES = 2 * 1024 * 1024;
const ACTIVE = new Set(["proposed", "submitting", "acknowledged", "partially-filled", "cancel-pending", "unknown", "reconciled"]);
const ID = /^[A-Za-z0-9_.:@/+\-]{1,128}$/u;

interface StoredOrders { readonly schemaVersion: 1; readonly orders: readonly TrackedOrder[] }

function sameIntent(left: TrackedOrder["approvedIntent"], right: TrackedOrder["approvedIntent"]): boolean {
  return left.symbol === right.symbol && left.side === right.side && left.quantity === right.quantity &&
    left.price === right.price && left.expectedSlippageBps === right.expectedSlippageBps &&
    left.reduceOnly === right.reduceOnly;
}

function sameIdentity(left: TrackedOrder, right: TrackedOrder): boolean {
  return left.clientOrderId === right.clientOrderId && left.deploymentId === right.deploymentId &&
    sameExecutionTarget(left.executionTarget, right.executionTarget) && sameIntent(left.approvedIntent, right.approvedIntent);
}

function parsePlaintext(plaintext: string): StoredOrders {
  if (Buffer.byteLength(plaintext, "utf8") > MAX_PLAINTEXT_BYTES) throw new Error("Order store is corrupt");
  let value: unknown;
  try { value = JSON.parse(plaintext); } catch { throw new Error("Order store is corrupt"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("Order store is corrupt");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "orders,schemaVersion" || record.schemaVersion !== 1 ||
      !Array.isArray(record.orders) || record.orders.length > MAX_ORDERS) throw new Error("Order store is corrupt");
  const orders = record.orders.map((order) => parseTrackedOrder(order));
  if (new Set(orders.map(({ clientOrderId }) => clientOrderId)).size !== orders.length) {
    throw new Error("Order store is corrupt");
  }
  return Object.freeze({ schemaVersion: 1, orders: Object.freeze(orders) });
}

async function read(storage: AsyncSafeStorage, file: VaultFileStore): Promise<StoredOrders> {
  if (!(await storage.isAsyncEncryptionAvailable())) throw new Error("OS-backed order encryption is unavailable");
  const encrypted = await file.read();
  if (!encrypted) return { schemaVersion: 1, orders: [] };
  const decrypt = storage.decryptStringAsync ?? storage.decryptString;
  if (!decrypt) throw new Error("Order decryption is unavailable");
  const copy = Uint8Array.from(encrypted);
  try { return parsePlaintext(await decrypt.call(storage, copy)); }
  finally { copy.fill(0); }
}

async function write(storage: AsyncSafeStorage, file: VaultFileStore, orders: readonly TrackedOrder[]): Promise<void> {
  if (!(await storage.isAsyncEncryptionAvailable())) throw new Error("OS-backed order encryption is unavailable");
  const encrypt = storage.encryptStringAsync ?? storage.encryptString;
  if (!encrypt) throw new Error("Order encryption is unavailable");
  const plaintext = Buffer.from(JSON.stringify({ schemaVersion: 1, orders }), "utf8");
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) { plaintext.fill(0); throw new Error("Order store exceeds size limit"); }
  let encrypted: Uint8Array | undefined;
  try {
    encrypted = Uint8Array.from(await encrypt.call(storage, plaintext.toString("utf8")));
    if (encrypted.byteLength === 0) throw new Error("Order encryption returned an invalid payload");
    await file.writeAtomically(encrypted, 0o600);
  } finally { plaintext.fill(0); encrypted?.fill(0); }
}

/** Encrypted, atomic OrderRepository shared by paper, demo, and live execution. */
export function createDurableOrderRepository(storage: AsyncSafeStorage, file: VaultFileStore): OrderRepository & {
  listForDeployment(deploymentId: string, symbol?: string): Promise<readonly TrackedOrder[]>;
} {
  let tail: Promise<void> = Promise.resolve();
  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  return {
    getByClientOrderId(clientOrderId) {
      return exclusive(async () => {
        if (!ID.test(clientOrderId)) throw new TypeError("Invalid client order id");
        return (await read(storage, file)).orders.find((order) => order.clientOrderId === clientOrderId) ?? null;
      });
    },
    listActive(deploymentId, symbol) {
      return exclusive(async () => {
        if (!ID.test(deploymentId) || (symbol !== undefined && (symbol.length < 3 || symbol.length > 64))) {
          throw new TypeError("Invalid active order query");
        }
        return (await read(storage, file)).orders.filter((order) => order.deploymentId === deploymentId &&
          (symbol === undefined || order.approvedIntent.symbol === symbol) && ACTIVE.has(order.status));
      });
    },
    listForDeployment(deploymentId, symbol) {
      return exclusive(async () => {
        if (!ID.test(deploymentId) || (symbol !== undefined && (symbol.length < 3 || symbol.length > 64))) {
          throw new TypeError("Invalid deployment order query");
        }
        return (await read(storage, file)).orders.filter((order) => order.deploymentId === deploymentId &&
          (symbol === undefined || order.approvedIntent.symbol === symbol));
      });
    },
    claim(candidate): Promise<ProposalClaim> {
      return exclusive(async () => {
        const order = parseTrackedOrder(candidate);
        if (order.status !== "proposed" || order.version !== 0) throw new TypeError("Invalid order proposal");
        const current = await read(storage, file);
        const duplicate = current.orders.find(({ clientOrderId }) => clientOrderId === order.clientOrderId);
        if (duplicate) return { claimed: false, reason: "client-order-id-exists", order: duplicate };
        if (current.orders.some((active) => active.deploymentId === order.deploymentId &&
            active.approvedIntent.symbol === order.approvedIntent.symbol && ACTIVE.has(active.status))) {
          return { claimed: false, reason: "active-order-conflict" };
        }
        if (current.orders.length >= MAX_ORDERS) throw new Error("Order store capacity exceeded");
        await write(storage, file, [...current.orders, order]);
        return { claimed: true, order };
      });
    },
    save(candidate, expectedVersion) {
      return exclusive(async () => {
        const order = parseTrackedOrder(candidate);
        const current = await read(storage, file);
        const index = current.orders.findIndex(({ clientOrderId }) => clientOrderId === order.clientOrderId);
        const existing = index < 0 ? null : current.orders[index]!;
        if ((existing?.version ?? null) !== expectedVersion || !existing || !sameIdentity(existing, order) ||
            order.version <= existing.version) throw new Error("Order version conflict");
        const next = [...current.orders]; next[index] = order;
        await write(storage, file, next);
        return order;
      });
    },
  };
}
