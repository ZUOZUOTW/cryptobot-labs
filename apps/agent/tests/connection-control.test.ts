import { describe, expect, it, vi } from "vitest";

import { createConnectionControl } from "../src/main/connection-control";
import { createConnectionVersionStore } from "../src/main/connection-version-store";
import { ConnectionRegistry } from "../src/main/connections";
import type { ControlCommand } from "../src/main/control-client";
import type { AsyncSafeStorage, VaultFileStore } from "../src/main/vault";

const command = (type: string, payload: Record<string, unknown> = {}): ControlCommand => ({ id: `cmd_${type}`,
  deploymentId: "dep_1", type, version: 1, correlationId: "corr_1", expectedDeploymentVersion: 2,
  payload, createdAt: 1, expiresAt: 2 });

function encryptedMemory(): { storage: AsyncSafeStorage; file: VaultFileStore; bytes: () => Uint8Array | null } {
  let value: Uint8Array | null = null;
  return { storage: { isAsyncEncryptionAvailable: () => true,
    encryptStringAsync: async (text) => Uint8Array.from(Buffer.from(`encrypted:${text}`)),
    decryptStringAsync: async (bytes) => Buffer.from(bytes).toString().replace(/^encrypted:/, "") },
  file: { read: async () => value && Uint8Array.from(value), writeAtomically: async (next) => { value = Uint8Array.from(next); },
    erase: async () => { value = null; } }, bytes: () => value };
}

describe("connection control", () => {
  it("persists monotonic versions without plaintext and emits safe connection state", async () => {
    const memory = encryptedMemory();
    const versions = createConnectionVersionStore(memory.storage, memory.file);
    await expect(versions.next()).resolves.toBe(1);
    const restarted = createConnectionVersionStore(memory.storage, memory.file);
    await expect(restarted.next()).resolves.toBe(2);
    expect(Buffer.from(memory.bytes()!).toString()).not.toBe('{"version":2}');

    const registry = new ConnectionRegistry(); const events: unknown[] = [];
    const control = createConnectionControl({ verifier: { verify: async () => ({ provider: "WEEX", apiKeySuffix: "A1B2",
      verifiedAt: "2026-07-13T00:00:00.000Z", permissions: { read: true, spotTrade: true,
        futuresTrade: true, withdrawal: false } }) }, registry, vault: { erase: vi.fn() }, versions: restarted,
    enqueue: async (event) => { events.push(event); }, now: () => 123 });
    await control.revalidate(command("revalidate-connection"));
    expect(registry.snapshot()).toMatchObject({ apiKeySuffix: "A1B2", permissions: { spot: true, futures: true } });
    expect(events[0]).toMatchObject({ type: "connection-verified", payload: { maskedApiKeySuffix: "****A1B2",
      connectionVersion: 3 } });
    expect(JSON.stringify(events)).not.toMatch(/secret|passphrase/i);
  });

  it("revokes local metadata, erases the vault, then emits a versioned event", async () => {
    const memory = encryptedMemory(); const registry = new ConnectionRegistry(); const order: string[] = [];
    registry.record({ verifiedAt: 1, apiKeySuffix: "A1B2", canTrade: true, withdrawalPermission: "absent",
      permissions: { read: true, spot: true, futures: true } });
    const control = createConnectionControl({ verifier: { verify: vi.fn() }, registry,
      vault: { erase: async () => { order.push("erase"); } }, versions: createConnectionVersionStore(memory.storage, memory.file),
      enqueue: async (event) => { order.push(String(event.type)); }, now: () => 456 });
    await control.erase(command("erase-local-credentials", { reason: "operator" }));
    expect(registry.snapshot()).toBeNull();
    expect(order).toEqual(["erase", "key-erased"]);
  });
});
