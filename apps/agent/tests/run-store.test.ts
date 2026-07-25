import { describe, expect, it } from "vitest";

import {
  createDurableRunStore,
  type DurableRunState,
} from "../src/main/run-store";
import type { AsyncSafeStorage, VaultFileStore } from "../src/main/vault";

function fakeStorage(key: number, available = true): AsyncSafeStorage {
  return {
    async isAsyncEncryptionAvailable() { return available; },
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
    async read() { return this.bytes && Uint8Array.from(this.bytes); },
    async writeAtomically(bytes, mode) {
      this.bytes = Uint8Array.from(bytes);
      this.mode = mode;
    },
    async erase() { this.bytes = null; },
  };
}

function state(overrides: Partial<DurableRunState> = {}): DurableRunState {
  return {
    definition: {
      deploymentId: "deploy-1",
      configurationVersion: "config-3",
      scriptHash: "a".repeat(64),
      mode: "live",
      market: "spot",
      symbol: "BTCUSDT",
    },
    status: "running",
    pausedReason: null,
    ambiguousOrder: null,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("durable run store", () => {
  it("encrypts minimal metadata and restores an active run fail-closed", async () => {
    const file = memoryStore();
    const store = createDurableRunStore(fakeStorage(0xa5), file);
    const saved = await store.save(state(), null);

    expect(saved.recordVersion).toBe(1);
    expect(file.mode).toBe(0o600);
    expect(Buffer.from(file.bytes ?? []).toString("utf8")).not.toContain("deploy-1");
    await expect(store.restore()).resolves.toMatchObject({
      status: "running",
      restoredStatus: "paused",
      restoredReason: "restart-reconciliation-required",
      resumeAllowed: false,
    });
  });

  it("preserves an ambiguous-order latch and never permits restart resume", async () => {
    const store = createDurableRunStore(fakeStorage(0x55), memoryStore());
    await store.save(state({
      status: "paused",
      pausedReason: "ambiguous-order",
      ambiguousOrder: {
        at: 1_700_000_000_100,
        clientOrderId: "cbl-order-9",
        reason: "ambiguous-order",
      },
    }), null);

    await expect(store.restore()).resolves.toMatchObject({
      restoredStatus: "paused",
      restoredReason: "ambiguous-order",
      ambiguousOrder: { clientOrderId: "cbl-order-9" },
      resumeAllowed: false,
    });
  });

  it("uses optimistic versions so stale writers cannot overwrite safety state", async () => {
    const store = createDurableRunStore(fakeStorage(0x11), memoryStore());
    await store.save(state(), null);
    const stopped = await store.save(state({
      status: "stopped",
      pausedReason: null,
      updatedAt: 1_700_000_000_200,
    }), 1);

    expect(stopped.recordVersion).toBe(2);
    await expect(store.save(state(), 1)).rejects.toThrow("version conflict");
    await expect(store.restore()).resolves.toMatchObject({
      recordVersion: 2,
      restoredStatus: "stopped",
      restoredReason: null,
    });
  });

  it("rejects extra strategy source, invalid state combinations, and corrupt records", async () => {
    const file = memoryStore();
    const store = createDurableRunStore(fakeStorage(0), file);
    const unsafe = state() as DurableRunState & { definition: DurableRunState["definition"] & { source: string } };
    unsafe.definition = { ...unsafe.definition, source: "apiKey = 'secret'" };
    await expect(store.save(unsafe, null)).rejects.toThrow("Run definition is corrupt");

    await expect(store.save({ ...state(), secretKey: "do-not-store" } as DurableRunState, null))
      .rejects.toThrow("Run state is corrupt");

    await expect(store.save(state({ status: "paused", pausedReason: null }), null))
      .rejects.toThrow("Run store is corrupt");

    file.bytes = Buffer.from("{not-json", "utf8");
    await expect(store.restore()).rejects.toThrow("Run store is corrupt");
  });

  it("fails closed when OS-backed encryption is unavailable", async () => {
    const store = createDurableRunStore(fakeStorage(1, false), memoryStore());
    await expect(store.save(state(), null)).rejects.toThrow("unavailable");
    await expect(store.restore()).rejects.toThrow("unavailable");
  });

  it("erases the durable restart record", async () => {
    const store = createDurableRunStore(fakeStorage(0x22), memoryStore());
    await store.save(state(), null);
    await store.erase();
    await expect(store.restore()).resolves.toBeNull();
  });
});
