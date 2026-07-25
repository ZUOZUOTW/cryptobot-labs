import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createCredentialVault,
  createNodeVaultFileStore,
  type AsyncSafeStorage,
  type VaultFileStore,
} from "../src/main/vault";

function fakeStorage(key: number, available = true): AsyncSafeStorage {
  return {
    async isAsyncEncryptionAvailable() {
      return available;
    },
    async encryptStringAsync(plaintext) {
      return Uint8Array.from(Buffer.from(plaintext), (byte) => byte ^ key);
    },
    async decryptStringAsync(ciphertext) {
      return Buffer.from(Uint8Array.from(ciphertext, (byte) => byte ^ key)).toString("utf8");
    },
  };
}

function memoryStore(): VaultFileStore & { bytes: Uint8Array | null; mode: number | null } {
  return {
    bytes: null,
    mode: null,
    async read() {
      return this.bytes && Uint8Array.from(this.bytes);
    },
    async writeAtomically(bytes, mode) {
      this.bytes = Uint8Array.from(bytes);
      this.mode = mode;
    },
    async erase() {
      this.bytes = null;
    },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("credential vault", () => {
  it("persists only ciphertext and returns masked metadata", async () => {
    const store = memoryStore();
    const vault = createCredentialVault(fakeStorage(0xa5), store);
    await vault.save({ apiKey: "weex-key-1234", secretKey: "very-secret", passphrase: "phrase" });

    expect(Buffer.from(store.bytes ?? []).toString()).not.toContain("very-secret");
    expect(store.mode).toBe(0o600);
    expect(await vault.metadata()).toEqual({ apiKeySuffix: "1234", configured: true });
  });

  it("fails closed if OS-backed async encryption is unavailable", async () => {
    const vault = createCredentialVault(fakeStorage(1, false), memoryStore());
    await expect(vault.save({ apiKey: "1234", secretKey: "secret", passphrase: "p" })).rejects.toThrow(
      "unavailable",
    );
  });

  it("erases and rotates encrypted credentials", async () => {
    const store = memoryStore();
    const vault = createCredentialVault(fakeStorage(0x11), store);
    await vault.save({ apiKey: "api-9876", secretKey: "secret", passphrase: "phrase" });
    const before = Buffer.from(store.bytes ?? []).toString("hex");

    await vault.rotate(fakeStorage(0x22));
    expect(Buffer.from(store.bytes ?? []).toString("hex")).not.toBe(before);
    await expect(vault.withCredentials((value) => value.secretKey)).resolves.toBe("secret");

    await vault.erase();
    await expect(vault.metadata()).resolves.toEqual({ apiKeySuffix: "", configured: false });
  });

  it("writes a real vault atomically with owner-only permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cbl-vault-"));
    const path = join(directory, "credentials.bin");
    const vault = createCredentialVault(fakeStorage(0x42), createNodeVaultFileStore(path));
    await vault.save({ apiKey: "api-1111", secretKey: "secret", passphrase: "phrase" });

    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    expect((await readFile(path)).toString()).not.toContain("secret");
  });

  it("replaces an existing real vault on a second save", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cbl-vault-replace-"));
    const path = join(directory, "credentials.bin");
    const vault = createCredentialVault(fakeStorage(0x42), createNodeVaultFileStore(path));

    await vault.save({ apiKey: "api-1111", secretKey: "first", passphrase: "phrase" });
    await vault.save({ apiKey: "api-2222", secretKey: "second", passphrase: "phrase" });

    await expect(vault.withCredentials((value) => ({ ...value }))).resolves.toEqual({
      apiKey: "api-2222",
      secretKey: "second",
      passphrase: "phrase",
    });
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it("serializes save, rotation, and erase so older work cannot revive an erased vault", async () => {
    const store = memoryStore();
    const vault = createCredentialVault(fakeStorage(0x11), store);
    await vault.save({ apiKey: "api-1111", secretKey: "initial", passphrase: "phrase" });

    const rotationStarted = deferred();
    const finishRotation = deferred();
    const rotatingStorage: AsyncSafeStorage = {
      ...fakeStorage(0x22),
      async encryptStringAsync(plaintext) {
        rotationStarted.resolve();
        await finishRotation.promise;
        return Uint8Array.from(Buffer.from(plaintext), (byte) => byte ^ 0x22);
      },
    };

    const rotation = vault.rotate(rotatingStorage);
    await rotationStarted.promise;
    const save = vault.save({ apiKey: "api-2222", secretKey: "queued", passphrase: "phrase" });
    const erase = vault.erase();
    finishRotation.resolve();

    await Promise.all([rotation, save, erase]);
    await expect(vault.metadata()).resolves.toEqual({ apiKeySuffix: "", configured: false });
  });

  it("keeps the previous vault when atomic replacement fails and cleans the temp file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cbl-vault-rollback-"));
    const path = join(directory, "credentials.bin");
    const originalStore = createNodeVaultFileStore(path);
    const originalVault = createCredentialVault(fakeStorage(0x42), originalStore);
    await originalVault.save({ apiKey: "api-1111", secretKey: "first", passphrase: "phrase" });

    let failReplacement = true;
    const failingStore = createNodeVaultFileStore(path, {
      async rename(source, destination) {
        if (failReplacement && source === `${path}.tmp` && destination === path) {
          failReplacement = false;
          const error = new Error("injected replacement failure") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }
        await rename(source, destination);
      },
    });
    const failingVault = createCredentialVault(fakeStorage(0x42), failingStore);

    await expect(
      failingVault.save({ apiKey: "api-2222", secretKey: "second", passphrase: "phrase" }),
    ).rejects.toThrow("injected replacement failure");
    await expect(originalVault.withCredentials((value) => ({ ...value }))).resolves.toEqual({
      apiKey: "api-1111",
      secretKey: "first",
      passphrase: "phrase",
    });
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    expect(await readdir(directory)).toEqual(["credentials.bin"]);
  });

  it("recovers both crash points using fixed backup and temp records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cbl-vault-crash-"));
    const path = join(directory, "credentials.bin");
    const vault = createCredentialVault(fakeStorage(0x42), createNodeVaultFileStore(path));
    await vault.save({ apiKey: "api-1111", secretKey: "first", passphrase: "phrase" });

    // Crash after canonical -> backup but before temp -> canonical.
    await rename(path, `${path}.bak`);
    await writeFile(`${path}.tmp`, "incomplete", { mode: 0o600 });
    await expect(vault.metadata()).resolves.toEqual({ apiKeySuffix: "1111", configured: true });
    expect(await readdir(directory)).toEqual(["credentials.bin"]);

    const oldCiphertext = await readFile(path);
    await vault.save({ apiKey: "api-2222", secretKey: "second", passphrase: "phrase" });
    // Crash after temp -> canonical but before backup cleanup.
    await writeFile(`${path}.bak`, oldCiphertext, { mode: 0o600 });
    await writeFile(`${path}.tmp`, "stale", { mode: 0o600 });
    await expect(vault.metadata()).resolves.toEqual({ apiKeySuffix: "2222", configured: true });
    expect(await readdir(directory)).toEqual(["credentials.bin"]);
  });

  it("does not reject a committed save when backup cleanup fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cbl-vault-cleanup-"));
    const path = join(directory, "credentials.bin");
    const vault = createCredentialVault(fakeStorage(0x42), createNodeVaultFileStore(path));
    await vault.save({ apiKey: "api-1111", secretKey: "first", passphrase: "phrase" });

    let failBackupCleanup = true;
    const storeWithCleanupFailure = createNodeVaultFileStore(path, {
      async rm(target, options) {
        if (failBackupCleanup && target === `${path}.bak`) {
          failBackupCleanup = false;
          const error = new Error("injected cleanup failure") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }
        await rm(target, options);
      },
    });
    const nextVault = createCredentialVault(fakeStorage(0x42), storeWithCleanupFailure);

    await expect(
      nextVault.save({ apiKey: "api-2222", secretKey: "second", passphrase: "phrase" }),
    ).resolves.toEqual({ apiKeySuffix: "2222", configured: true });
    expect((await readdir(directory)).sort()).toEqual(["credentials.bin", "credentials.bin.bak"]);

    await expect(nextVault.metadata()).resolves.toEqual({ apiKeySuffix: "2222", configured: true });
    expect(await readdir(directory)).toEqual(["credentials.bin"]);
  });

  it("erases recovered canonical, backup, and temp records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cbl-vault-erase-recovery-"));
    const path = join(directory, "credentials.bin");
    const vault = createCredentialVault(fakeStorage(0x42), createNodeVaultFileStore(path));
    await vault.save({ apiKey: "api-1111", secretKey: "first", passphrase: "phrase" });
    await rename(path, `${path}.bak`);
    await writeFile(`${path}.tmp`, "incomplete", { mode: 0o600 });

    await vault.erase();
    expect(await readdir(directory)).toEqual([]);
  });
});
