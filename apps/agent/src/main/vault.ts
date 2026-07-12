import { access, chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export interface CredentialInput {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

export interface CredentialMetadata {
  apiKeySuffix: string;
  configured: boolean;
}

/**
 * Electron safeStorage is wrapped behind this deliberately asynchronous
 * interface so callers cannot accidentally fall back to plaintext storage.
 */
export interface AsyncSafeStorage {
  isAsyncEncryptionAvailable(): boolean | Promise<boolean>;
  encryptStringAsync?(plaintext: string): Promise<Uint8Array>;
  decryptStringAsync?(ciphertext: Uint8Array): Promise<string>;
  encryptString?(plaintext: string): Promise<Uint8Array>;
  decryptString?(ciphertext: Uint8Array): Promise<string>;
}

export interface VaultFileStore {
  read(): Promise<Uint8Array | null>;
  writeAtomically(bytes: Uint8Array, mode: number): Promise<void>;
  erase(): Promise<void>;
}

export interface NodeVaultFileOperations {
  access: typeof access;
  chmod: typeof chmod;
  mkdir: typeof mkdir;
  open: typeof open;
  readFile: typeof readFile;
  rename: typeof rename;
  rm: typeof rm;
}

export interface CredentialVault {
  save(input: CredentialInput): Promise<CredentialMetadata>;
  metadata(): Promise<CredentialMetadata>;
  erase(): Promise<void>;
  rotate(nextStorage?: AsyncSafeStorage): Promise<void>;
  /** Main-process only. Secrets live only for the duration of the callback. */
  withCredentials<T>(consume: (credentials: Readonly<CredentialInput>) => T | Promise<T>): Promise<T>;
}

const EMPTY_METADATA: CredentialMetadata = Object.freeze({
  apiKeySuffix: "",
  configured: false,
});

function assertCredentialInput(input: CredentialInput): void {
  for (const [field, value] of Object.entries(input)) {
    if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
      throw new Error(`Invalid credential field: ${field}`);
    }
  }
}

async function ensureAvailable(storage: AsyncSafeStorage): Promise<void> {
  if (!(await storage.isAsyncEncryptionAvailable())) {
    throw new Error("OS-backed asynchronous encryption is unavailable");
  }
}

async function encrypt(storage: AsyncSafeStorage, plaintext: string): Promise<Uint8Array> {
  const operation = storage.encryptStringAsync ?? storage.encryptString;
  if (!operation) throw new Error("Asynchronous encryption is unavailable");
  const encrypted = await operation.call(storage, plaintext);
  if (!(encrypted instanceof Uint8Array) || encrypted.byteLength === 0) {
    throw new Error("OS-backed encryption returned an invalid payload");
  }
  return encrypted;
}

async function decrypt(storage: AsyncSafeStorage, ciphertext: Uint8Array): Promise<string> {
  const operation = storage.decryptStringAsync ?? storage.decryptString;
  if (!operation) throw new Error("Asynchronous decryption is unavailable");
  return operation.call(storage, ciphertext);
}

function parseCredentials(plaintext: string): CredentialInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error("Credential vault is corrupt");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Credential vault is corrupt");
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "apiKey,passphrase,secretKey") {
    throw new Error("Credential vault is corrupt");
  }
  const credentials = {
    apiKey: record.apiKey,
    secretKey: record.secretKey,
    passphrase: record.passphrase,
  } as CredentialInput;
  assertCredentialInput(credentials);
  return credentials;
}

export function createCredentialVault(
  initialStorage: AsyncSafeStorage,
  fileStore: VaultFileStore,
): CredentialVault {
  let currentStorage = initialStorage;
  let operationQueue: Promise<void> = Promise.resolve();

  function exclusively<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function decryptStored(storage = currentStorage): Promise<CredentialInput> {
    await ensureAvailable(storage);
    const encrypted = await fileStore.read();
    if (!encrypted) throw new Error("Credentials are not configured");
    const encryptedCopy = Uint8Array.from(encrypted);
    try {
      return parseCredentials(await decrypt(storage, encryptedCopy));
    } finally {
      encryptedCopy.fill(0);
    }
  }

  async function encryptAndWrite(input: CredentialInput, storage = currentStorage): Promise<void> {
    assertCredentialInput(input);
    await ensureAvailable(storage);
    const serialized = Buffer.from(JSON.stringify(input), "utf8");
    let encrypted: Uint8Array | undefined;
    let writeCopy: Uint8Array | undefined;
    try {
      encrypted = await encrypt(storage, serialized.toString("utf8"));
      writeCopy = Uint8Array.from(encrypted);
      await fileStore.writeAtomically(writeCopy, 0o600);
    } finally {
      serialized.fill(0);
      encrypted?.fill(0);
      writeCopy?.fill(0);
    }
  }

  return {
    save(input) {
      const snapshot = { ...input };
      return exclusively(async () => {
        try {
          await encryptAndWrite(snapshot);
          return { apiKeySuffix: snapshot.apiKey.slice(-4), configured: true };
        } finally {
          snapshot.apiKey = "";
          snapshot.secretKey = "";
          snapshot.passphrase = "";
        }
      });
    },

    metadata() {
      return exclusively(async () => {
        const encrypted = await fileStore.read();
        if (!encrypted) return { ...EMPTY_METADATA };
        const credentials = await decryptStored();
        try {
          return { apiKeySuffix: credentials.apiKey.slice(-4), configured: true };
        } finally {
          credentials.apiKey = "";
          credentials.secretKey = "";
          credentials.passphrase = "";
        }
      });
    },

    erase() {
      return exclusively(() => fileStore.erase());
    },

    rotate(nextStorage = currentStorage) {
      return exclusively(async () => {
        const credentials = await decryptStored(currentStorage);
        try {
          await encryptAndWrite(credentials, nextStorage);
          currentStorage = nextStorage;
        } finally {
          credentials.apiKey = "";
          credentials.secretKey = "";
          credentials.passphrase = "";
        }
      });
    },

    withCredentials(consume) {
      return exclusively(async () => {
        const credentials = await decryptStored();
        try {
          return await consume(credentials);
        } finally {
          credentials.apiKey = "";
          credentials.secretKey = "";
          credentials.passphrase = "";
        }
      });
    },
  };
}

const NODE_VAULT_FILE_OPERATIONS: NodeVaultFileOperations = {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
};

export function createNodeVaultFileStore(
  filePath: string,
  operationOverrides: Partial<NodeVaultFileOperations> = {},
): VaultFileStore {
  const operations = { ...NODE_VAULT_FILE_OPERATIONS, ...operationOverrides };
  const tempPath = `${filePath}.tmp`;
  const backupPath = `${filePath}.bak`;

  async function exists(path: string): Promise<boolean> {
    try {
      await operations.access(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async function recoverInterruptedReplacement(strictCleanup: boolean): Promise<void> {
    const hasCanonical = await exists(filePath);
    const hasBackup = await exists(backupPath);

    // A missing canonical with a backup means the process stopped after moving
    // the old vault aside but before committing the new one.
    if (!hasCanonical && hasBackup) {
      await operations.rename(backupPath, filePath);
    } else if (hasCanonical && hasBackup) {
      // Both files means the new canonical was committed and only cleanup was
      // interrupted. Reads remain valid even if cleanup must be retried later.
      try {
        await operations.rm(backupPath, { force: true });
      } catch (error) {
        if (strictCleanup) throw error;
      }
    }

    try {
      await operations.rm(tempPath, { force: true });
    } catch (error) {
      if (strictCleanup) throw error;
    }
  }

  return {
    async read() {
      await recoverInterruptedReplacement(false);
      try {
        return await operations.readFile(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async writeAtomically(bytes, mode) {
      await operations.mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      await recoverInterruptedReplacement(true);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      let hasBackup = false;
      let committed = false;
      try {
        handle = await operations.open(tempPath, "wx", mode);
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        await operations.chmod(tempPath, mode);

        try {
          await operations.rename(filePath, backupPath);
          hasBackup = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }

        try {
          await operations.rename(tempPath, filePath);
          committed = true;
        } catch (replacementError) {
          await operations.rm(filePath, { force: true }).catch(() => undefined);
          if (hasBackup) {
            try {
              await operations.rename(backupPath, filePath);
              hasBackup = false;
            } catch (rollbackError) {
              throw new AggregateError(
                [replacementError, rollbackError],
                "Vault replacement and rollback both failed",
              );
            }
          }
          throw replacementError;
        }

        if (hasBackup) {
          // The canonical rename above is the commit point. A cleanup failure
          // must not make callers retry a save that already succeeded; the
          // fixed backup path is a recovery record for the next operation.
          await operations.rm(backupPath, { force: true }).catch(() => undefined);
        }
      } catch (error) {
        await handle?.close().catch(() => undefined);
        if (!committed) await operations.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    },

    async erase() {
      await recoverInterruptedReplacement(false);
      await operations.rm(filePath, { force: true });
      await operations.rm(backupPath, { force: true });
      await operations.rm(tempPath, { force: true });
    },
  };
}
