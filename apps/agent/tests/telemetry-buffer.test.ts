import { mkdtemp, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEVICE_EVENT_TYPES,
  createNodeTelemetryFileStore,
  createTelemetryBuffer,
  type TelemetryEventEnvelope,
} from "../src/main/telemetry-buffer";
import type { AsyncSafeStorage, VaultFileStore } from "../src/main/vault";

function fakeStorage(key = 0xa5): AsyncSafeStorage {
  return {
    isAsyncEncryptionAvailable: () => true,
    async encryptStringAsync(value) { return Uint8Array.from(Buffer.from(value), (byte) => byte ^ key); },
    async decryptStringAsync(value) { return Buffer.from(Uint8Array.from(value, (byte) => byte ^ key)).toString("utf8"); },
  };
}

function memoryStore(): VaultFileStore & { bytes: Uint8Array | null; mode: number | null } {
  return {
    bytes: null,
    mode: null,
    async read() { return this.bytes && Uint8Array.from(this.bytes); },
    async writeAtomically(bytes, mode) { this.bytes = Uint8Array.from(bytes); this.mode = mode; },
    async erase() { this.bytes = null; },
  };
}

function event(id: string, type: TelemetryEventEnvelope["type"] = "deployment-state"): TelemetryEventEnvelope {
  return {
    version: 1,
    id,
    type,
    deploymentId: "deployment-1",
    expectedDeploymentVersion: 3,
    correlationId: `correlation-${id}`,
    occurredAt: 1_000,
    payload: type === "deployment-state" ? { state: "stopped", reason: "operator-stop" } : { code: "TEST", message: "safe message", retryable: false },
  };
}

describe("encrypted telemetry buffer", () => {
  it("emits the exact authoritative server envelope and event type vocabulary", async () => {
    expect(DEVICE_EVENT_TYPES).toEqual([
      "heartbeat", "connection-verified", "signal", "risk-block", "order-state", "fill",
      "deployment-state", "key-rotated", "key-erased", "agent-error",
    ]);
    const buffer = createTelemetryBuffer(fakeStorage(), memoryStore());
    await buffer.enqueue(event("event-1"), { priority: "critical" });
    const batch = await buffer.nextBatch();

    expect(Object.keys(batch!.events[0]!).sort()).toEqual([
      "correlationId", "deploymentId", "expectedDeploymentVersion", "id",
      "occurredAt", "payload", "type", "version",
    ]);
    expect(batch!.events[0]).toEqual(event("event-1"));
    // Resolve dynamically so the Electron-only typecheck does not import the
    // server's Cloudflare runtime declarations.
    const serverModulePath = new URL("../../../lib/server/device-events.ts", import.meta.url).href;
    const server = await import(serverModulePath) as {
      DEVICE_EVENT_TYPES: readonly string[];
      parseDeviceEvent(value: unknown): unknown;
    };
    expect(DEVICE_EVENT_TYPES).toEqual(server.DEVICE_EVENT_TYPES);
    expect(server.parseDeviceEvent(batch!.events[0])).toEqual(event("event-1"));
    expect(JSON.stringify({ events: batch!.events })).not.toContain("priority");
    expect(batch!.events[0]).not.toHaveProperty("eventId");
  });

  it("rejects unknown envelope fields and secret-bearing, cyclic, or non-JSON payloads", async () => {
    const buffer = createTelemetryBuffer(fakeStorage(), memoryStore());
    await expect(buffer.enqueue({ ...event("event-1"), eventId: "old-contract" } as never)).rejects.toThrow("fields");
    await expect(buffer.enqueue({ ...event("event-1"), payload: { secretKey: "do-not-store" } } as never)).rejects.toThrow("forbidden credential");
    await expect(buffer.enqueue({ ...event("event-1"), payload: { message: "Authorization: Bearer abcdefgh" } } as never)).rejects.toThrow("forbidden credential");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(buffer.enqueue({ ...event("event-1"), payload: cyclic } as never)).rejects.toThrow("cyclic");
    await expect(buffer.enqueue({ ...event("event-1"), payload: { amount: Number.NaN } } as never)).rejects.toThrow("non-finite");
    await expect(buffer.count()).resolves.toBe(0);
  });

  it("allows bounded masked metadata but never persists it in plaintext", async () => {
    const store = memoryStore();
    const buffer = createTelemetryBuffer(fakeStorage(), store);
    await buffer.enqueue({ ...event("event-1"), type: "key-rotated", payload: { apiKeySuffix: "****1234" } });
    expect(Buffer.from(store.bytes!).toString()).not.toContain("****1234");
    expect(store.mode).toBe(0o600);
  });

  it("stores owner-only ciphertext and recovers an interrupted atomic replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cbl-telemetry-"));
    const path = join(directory, "events.bin");
    const buffer = createTelemetryBuffer(fakeStorage(), createNodeTelemetryFileStore(path));
    await buffer.enqueue(event("event-1"));
    expect((await readFile(path)).toString()).not.toContain("operator-stop");
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }

    await rename(path, `${path}.bak`);
    await writeFile(`${path}.tmp`, "partial", { mode: 0o600 });
    await expect(buffer.count()).resolves.toBe(1);
    expect(await readdir(directory)).toEqual(["events.bin"]);
  });

  it("keeps stable wire IDs and an idempotent batch across retries and restarts", async () => {
    const store = memoryStore();
    const first = createTelemetryBuffer(fakeStorage(), store);
    await first.enqueue(event("event-1"));
    await first.enqueue(event("event-2"));
    const initial = await first.nextBatch(2);
    expect(await first.nextBatch(1)).toEqual(initial);

    const restarted = createTelemetryBuffer(fakeStorage(), store);
    expect(await restarted.nextBatch()).toEqual(initial);
    expect(initial!.events.map(({ id }) => id)).toEqual(["event-1", "event-2"]);
  });

  it("erases exactly an acknowledged batch and rejects stale acknowledgements", async () => {
    const buffer = createTelemetryBuffer(fakeStorage(), memoryStore());
    await buffer.enqueue(event("event-1"));
    await buffer.enqueue(event("event-2"));
    await buffer.enqueue(event("event-3"));
    const first = await buffer.nextBatch(2);
    await expect(buffer.acknowledge("batch-wrong")).resolves.toBe(false);
    await expect(buffer.acknowledge(first!.batchId)).resolves.toBe(true);
    await expect(buffer.count()).resolves.toBe(1);
    expect((await buffer.nextBatch())!.events.map(({ id }) => id)).toEqual(["event-3"]);
  });

  it("settles mixed 207 terminal IDs while retaining retryable events for a stable re-batch", async () => {
    const buffer = createTelemetryBuffer(fakeStorage(), memoryStore());
    await buffer.enqueue(event("accepted-event"));
    await buffer.enqueue(event("rejected-event"));
    await buffer.enqueue(event("retryable-event"));
    const first = await buffer.nextBatch(3);

    // Models accepted + permanently rejected as terminal, while internal
    // server failure remains retryable.
    await expect(buffer.acknowledge(first!.batchId, ["accepted-event", "rejected-event"])).resolves.toBe(true);
    const retry = await buffer.nextBatch();
    expect(retry!.events.map(({ id }) => id)).toEqual(["retryable-event"]);
    expect(await buffer.nextBatch()).toEqual(retry);

    await expect(buffer.acknowledge(retry!.batchId, ["not-in-flight"])).rejects.toThrow("not in flight");
    await expect(buffer.acknowledge(retry!.batchId, ["retryable-event", "retryable-event"])).rejects.toThrow("Duplicate");
    // Failed acknowledgement validation does not mutate the in-flight batch.
    expect(await buffer.nextBatch()).toEqual(retry);
  });

  it("releases an all-retryable batch without deleting its stable wire events", async () => {
    const buffer = createTelemetryBuffer(fakeStorage(), memoryStore());
    await buffer.enqueue(event("retryable-event"));
    const first = await buffer.nextBatch();
    await expect(buffer.acknowledge(first!.batchId, [])).resolves.toBe(true);
    const retry = await buffer.nextBatch();
    expect(retry!.batchId).toBe(first!.batchId);
    expect(retry!.events).toEqual(first!.events);
  });

  it("caps ciphertext and retains local critical stop evidence ahead of low-priority heartbeats", async () => {
    const probeStore = memoryStore();
    const probe = createTelemetryBuffer(fakeStorage(), probeStore);
    await probe.enqueue(event("critical-stop"), { priority: "critical" });
    const criticalBytes = probeStore.bytes!.byteLength;

    const store = memoryStore();
    const buffer = createTelemetryBuffer(fakeStorage(), store, { maxDiskBytes: criticalBytes + 100 });
    await buffer.enqueue(event("heartbeat-1", "heartbeat"), { priority: "low" });
    await buffer.enqueue(event("heartbeat-2", "heartbeat"), { priority: "low" });
    await buffer.enqueue(event("critical-stop"), { priority: "critical" });

    expect(store.bytes!.byteLength).toBeLessThanOrEqual(criticalBytes + 100);
    const ids = (await buffer.nextBatch())!.events.map(({ id }) => id);
    expect(ids).toContain("critical-stop");
    expect(ids.filter((id) => id.startsWith("heartbeat")).length).toBeLessThan(2);
  });

  it("does not let a new low-priority event evict existing critical evidence", async () => {
    const probeStore = memoryStore();
    const probe = createTelemetryBuffer(fakeStorage(), probeStore);
    await probe.enqueue(event("critical-stop"), { priority: "critical" });

    const store = memoryStore();
    // Enough room for the local in-flight marker, but not a second envelope.
    const buffer = createTelemetryBuffer(fakeStorage(), store, { maxDiskBytes: probeStore.bytes!.byteLength + 200 });
    await buffer.enqueue(event("critical-stop"), { priority: "critical" });
    await expect(buffer.enqueue(event("heartbeat-1", "heartbeat"), { priority: "low" })).rejects.toThrow("disk cap");
    expect((await buffer.nextBatch())!.events.map(({ id }) => id)).toEqual(["critical-stop"]);
  });

  it("rejects ID collisions and unavailable OS encryption", async () => {
    const buffer = createTelemetryBuffer(fakeStorage(), memoryStore());
    await buffer.enqueue(event("event-1"));
    await expect(buffer.enqueue(event("event-1"))).rejects.toThrow("collision");

    const unavailable = fakeStorage();
    unavailable.isAsyncEncryptionAvailable = () => false;
    await expect(createTelemetryBuffer(unavailable, memoryStore()).enqueue(event("event-2"))).rejects.toThrow("unavailable");
  });
});
