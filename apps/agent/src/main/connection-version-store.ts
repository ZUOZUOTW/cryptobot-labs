import type { AsyncSafeStorage, VaultFileStore } from "./vault";

export interface ConnectionVersionStore { next(): Promise<number> }

async function encryptionAvailable(storage: AsyncSafeStorage): Promise<void> {
  if (!(await storage.isAsyncEncryptionAvailable())) throw new Error("OS-backed encryption is unavailable");
}

async function encrypt(storage: AsyncSafeStorage, value: string): Promise<Uint8Array> {
  const operation = storage.encryptStringAsync ?? storage.encryptString;
  if (!operation) throw new Error("OS-backed encryption is unavailable");
  const encrypted = await operation.call(storage, value);
  if (!(encrypted instanceof Uint8Array) || encrypted.byteLength < 1) throw new Error("OS-backed encryption failed");
  return encrypted;
}

async function decrypt(storage: AsyncSafeStorage, value: Uint8Array): Promise<string> {
  const operation = storage.decryptStringAsync ?? storage.decryptString;
  if (!operation) throw new Error("OS-backed encryption is unavailable");
  return operation.call(storage, value);
}

/** Encrypted, atomic monotonic counter used to fence website connection state. */
export function createConnectionVersionStore(
  storage: AsyncSafeStorage,
  fileStore: VaultFileStore,
): ConnectionVersionStore {
  let queue: Promise<void> = Promise.resolve();
  return {
    next() {
      const result = queue.then(async () => {
        await encryptionAvailable(storage);
        const stored = await fileStore.read();
        let current = 0;
        if (stored) {
          const ciphertext = Uint8Array.from(stored);
          try {
            const parsed = JSON.parse(await decrypt(storage, ciphertext)) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
              || Object.keys(parsed).sort().join(",") !== "version"
              || !Number.isSafeInteger((parsed as { version?: unknown }).version)
              || Number((parsed as { version: number }).version) < 0) {
              throw new Error("Connection version store is corrupt");
            }
            current = (parsed as { version: number }).version;
          } catch (error) {
            if (error instanceof Error && error.message === "Connection version store is corrupt") throw error;
            throw new Error("Connection version store is corrupt");
          } finally { ciphertext.fill(0); }
        }
        if (current >= Number.MAX_SAFE_INTEGER) throw new Error("Connection version is exhausted");
        const next = current + 1;
        let encrypted: Uint8Array | undefined;
        let copy: Uint8Array | undefined;
        try {
          encrypted = await encrypt(storage, JSON.stringify({ version: next }));
          copy = Uint8Array.from(encrypted);
          await fileStore.writeAtomically(copy, 0o600);
        } finally { encrypted?.fill(0); copy?.fill(0); }
        return next;
      }, async () => { throw new Error("Connection version queue failed"); });
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
