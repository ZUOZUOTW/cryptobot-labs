import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ControlClientRevokedError,
  createEncryptedCommandOutcomeStore,
  createControlClient,
  safeControlJson,
  type ControlCommand,
  type ControlDeviceIdentity,
  type PendingCommandAcknowledgement,
  type StoredCommandOutcome,
} from "../src/main/control-client";
import type { AsyncSafeStorage, VaultFileStore } from "../src/main/vault";
import type { TelemetryEventEnvelope } from "../src/main/telemetry-buffer";

const credential = `cred_${Buffer.alloc(32, 7).toString("base64url")}`;
const timestamp = 1_700_000_000_000;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmd_1",
    deploymentId: "dep_1",
    type: "pause",
    version: 1,
    correlationId: "corr_1",
    expectedDeploymentVersion: 2,
    payload: { reason: "operator" },
    createdAt: timestamp - 1_000,
    expiresAt: timestamp + 60_000,
    ...overrides,
  };
}

function identity(sign: (data: Uint8Array) => Promise<Uint8Array> = vi.fn(async (data: Uint8Array) => {
  void data;
  return new Uint8Array(64).fill(3);
})): ControlDeviceIdentity {
  return { deviceId: "dev_1", credential, credentialExpiresAt: timestamp + 3_600_000, sign };
}

function memoryOutcomes() {
  const values = new Map<string, PendingCommandAcknowledgement>();
  return {
    get: async (id: string) => values.get(id) ?? null,
    list: async (limit = 100) => [...values.values()].slice(0, limit),
    put: async (commandIdentity: { id: string; deploymentId: string; expectedDeploymentVersion: number; expiresAt: number }, outcome: StoredCommandOutcome) => {
      values.set(commandIdentity.id, structuredClone({ commandId: commandIdentity.id,
        deploymentId: commandIdentity.deploymentId,
        expectedDeploymentVersion: commandIdentity.expectedDeploymentVersion, expiresAt: commandIdentity.expiresAt, outcome }));
    },
    delete: async (id: string) => { values.delete(id); },
  };
}

function client(overrides: Partial<Parameters<typeof createControlClient>[0]> = {}) {
  return createControlClient({
    baseUrl: "https://labs.test",
    identity: identity(),
    now: () => timestamp,
    deploymentVersion: () => 2,
    execute: async () => ({ status: "ok", code: "applied" }),
    outcomeStore: memoryOutcomes(),
    onExpiredOutcome: async () => undefined,
    crypto: webcrypto as unknown as Crypto,
    fetch: vi.fn(async () => json({ commands: [], nextCursor: null })),
    ...overrides,
  });
}

describe("signed control client", () => {
  it("uses the server canonical vector and never serializes WEEX secrets", async () => {
    const sign = vi.fn(async (data: Uint8Array) => { void data; return new Uint8Array(64).fill(9); });
    const request = await client({ identity: identity(sign) }).createSignedRequest(
      "/api/agent/events?b=2&a=%2F",
      { type: "connection-verified", payload: { apiKeySuffix: "1234", permissions: ["read", "spot"] } },
      timestamp,
    );
    const nonce = request.headers.get("X-CBL-Device-Nonce")!;
    const body = request.body!;
    const digest = createHash("sha256").update(body).digest("hex");
    expect(new TextDecoder().decode(sign.mock.calls[0]![0])).toBe(
      `POST\n/api/agent/events?b=2&a=%2F\n${timestamp}\n${nonce}\n${digest}`,
    );
    expect(request.headers.get("X-CBL-Device-Signature")).toBe(Buffer.alloc(64, 9).toString("base64url"));
    expect(JSON.stringify(request)).not.toMatch(/authorization|credential|passphrase|secret/i);
    expect(() => safeControlJson({ payload: { passphrase: "NEVER_WRITE_ME" } })).toThrow(/credential/i);
    expect(() => safeControlJson({ payload: { secretKey: "NEVER_WRITE_ME" } })).toThrow(/credential/i);
    expect(() => safeControlJson({ payload: { apiKey: "NEVER_WRITE_ME" } })).toThrow(/credential/i);
    expect(() => safeControlJson({ payload: { detail: "Authorization: Bearer abcdefghijklmnop" } })).toThrow(/credential/i);
  });

  it("creates a unique signed nonce for every request even when randomness repeats", async () => {
    const deterministic = {
      subtle: webcrypto.subtle,
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        if (array) new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(1);
        return array;
      },
    } as Pick<Crypto, "subtle" | "getRandomValues">;
    const control = client({ crypto: deterministic });
    const first = await control.createSignedRequest("/api/agent/commands?limit=1");
    const second = await control.createSignedRequest("/api/agent/commands?limit=1");
    expect(first.headers.get("X-CBL-Device-Nonce")).not.toBe(second.headers.get("X-CBL-Device-Nonce"));
    expect(first.headers.get("X-CBL-Device-Nonce")).toMatch(/^nonce_[A-Za-z0-9_-]{32}_1$/);
    expect(second.headers.get("X-CBL-Device-Nonce")).toMatch(/_2$/);
  });

  it("permits only HTTPS or explicit loopback development origins", () => {
    expect(() => client({ baseUrl: "http://control.example" })).toThrow(/HTTPS/i);
    expect(() => client({ baseUrl: "http://localhost:3000" })).not.toThrow();
    expect(() => client({ baseUrl: "http://127.0.0.1:3000" })).not.toThrow();
  });

  it("bounds a stalled response body instead of waiting forever", async () => {
    const stream = new ReadableStream<Uint8Array>({ start() { /* Intentionally never enqueue or close. */ } });
    const pending = client({
      requestTimeoutMs: 100,
      fetch: vi.fn(async () => new Response(stream, { headers: { "content-type": "application/json" } })) as typeof fetch,
    }).pollOnce();
    await expect(pending).rejects.toThrow(/timed out/i);
  });

  it("validates and executes commands sequentially, then acknowledges each one", async () => {
    const order: string[] = [];
    const commands = [command(), command({ id: "cmd_2", correlationId: "corr_2" })];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/agent/commands") return json({ commands, nextCursor: null });
      const body = JSON.parse(String(init?.body));
      order.push(`ack:${body.id}:${body.status}`);
      const commandId = path.split("/").at(-2)!;
      return json({ commandId, status: "acknowledged", idempotent: false });
    });
    const execute = vi.fn(async (item: ControlCommand) => {
      order.push(`execute:${item.id}`);
      return { status: "ok" as const, code: "applied" };
    });
    const count = await client({ fetch: fetcher as typeof fetch, execute }).pollOnce();
    expect(count).toBe(2);
    expect(order).toEqual([
      "execute:cmd_1", expect.stringMatching(/^ack:ack_[a-f0-9]{64}:ok$/),
      "execute:cmd_2", expect.stringMatching(/^ack:ack_[a-f0-9]{64}:ok$/),
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/passphrase|secretkey/i);
  });

  it("rejects unsupported, expired, and deployment-fenced commands before execution and acknowledges them", async () => {
    const commands = [
      command({ id: "cmd_version", version: 2 }),
      command({ id: "cmd_expired", expiresAt: timestamp }),
      command({ id: "cmd_fenced", expectedDeploymentVersion: 3 }),
    ];
    const acknowledgements: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/agent/commands") return json({ commands, nextCursor: null });
      acknowledgements.push(JSON.parse(String(init?.body)));
      return json({ commandId: decodeURIComponent(url.pathname.split("/").at(-2)!), status: "acknowledged", idempotent: false });
    });
    const execute = vi.fn();
    expect(await client({ fetch: fetcher as typeof fetch, execute }).pollOnce()).toBe(3);
    expect(execute).not.toHaveBeenCalled();
    expect(acknowledgements.map((item) => [item.status, (item.payload as { code: string }).code])).toEqual([
      ["rejected", "invalid_command"], ["rejected", "expired_command"], ["rejected", "deployment_fence"],
    ]);
  });

  it("revalidates destructive confirmation correlation and freshness locally", async () => {
    const commands = [
      command({ id: "cmd_close", type: "close-positions", correlationId: "corr_close", payload: {
        scope: "all", symbol: null, confirmation: { id: "corr_other", confirmedAt: timestamp, phrase: "CLOSE POSITIONS" },
      } }),
      command({ id: "cmd_live", type: "request-live-unlock", correlationId: "corr_live", payload: {
        confirmationId: "corr_live", riskAcceptedAt: timestamp - 300_001,
        revalidate: { localConnection: true, permissions: true, fetchCurrentProductMetadata: true,
          connectionVersion: 1, deploymentConfigurationHash: "a".repeat(64), strategyMarket: "spot",
          allowedSymbols: ["BTCUSDT"], strategyVersionId: "sv_1",
          riskPolicy: { id: "risk_1", versionFence: { updatedAt: 1 }, hash: "b".repeat(64) } },
      } }),
    ];
    const ackCodes: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/agent/commands") return json({ commands, nextCursor: null });
      ackCodes.push(JSON.parse(String(init?.body)).payload.code);
      return json({ commandId: url.pathname.split("/").at(-2), status: "acknowledged", idempotent: false });
    });
    const execute = vi.fn();
    await client({ fetch: fetcher as typeof fetch, execute }).pollOnce();
    expect(execute).not.toHaveBeenCalled(); expect(ackCodes).toEqual(["invalid_command", "invalid_command"]);
  });

  it("rechecks expiry after awaited storage and reserves a durable acknowledgement window", async () => {
    let clock = timestamp;
    const outcomeStore = memoryOutcomes();
    outcomeStore.get = async () => { clock = timestamp + 55_000; return null; };
    let acknowledgement: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/agent/commands") return json({ commands: [command()], nextCursor: null });
      acknowledgement = JSON.parse(String(init?.body));
      return json({ commandId: "cmd_1", status: "acknowledged", idempotent: false });
    });
    const execute = vi.fn();
    await client({ now: () => clock, fetch: fetcher as typeof fetch, execute, outcomeStore }).pollOnce();
    expect(execute).not.toHaveBeenCalled();
    expect((acknowledgement!.payload as { code: string }).code).toBe("expired_command");
  });

  it("rechecks destructive consent after persisting the pre-execution crash marker", async () => {
    let clock = timestamp;
    const values = new Map<string, PendingCommandAcknowledgement>();
    const outcomeStore = {
      get: async (id: string) => values.get(id) ?? null,
      list: async (limit = 100) => [...values.values()].slice(0, limit),
      put: async (commandIdentity: { id: string; deploymentId: string; expectedDeploymentVersion: number; expiresAt: number }, outcome: StoredCommandOutcome) => {
        values.set(commandIdentity.id, { commandId: commandIdentity.id, deploymentId: commandIdentity.deploymentId,
          expectedDeploymentVersion: commandIdentity.expectedDeploymentVersion, expiresAt: commandIdentity.expiresAt, outcome });
        if (outcome.code === "execution_interrupted") clock = timestamp + 290_001;
      },
      delete: async (id: string) => { values.delete(id); },
    };
    const close = command({ type: "close-positions", expiresAt: timestamp + 3_600_000, correlationId: "corr_1",
      payload: { scope: "all", symbol: null,
        confirmation: { id: "corr_1", confirmedAt: timestamp, phrase: "CLOSE POSITIONS" } } });
    const fetcher = vi.fn(async (input: string | URL | Request) => new URL(String(input)).pathname === "/api/agent/commands"
      ? json({ commands: [close], nextCursor: null })
      : json({ commandId: "cmd_1", status: "acknowledged", idempotent: false }));
    const execute = vi.fn();
    await client({ now: () => clock, fetch: fetcher as typeof fetch, execute, outcomeStore }).pollOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it("uses hardened fetch controls and rejects cyclic pagination", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return json({ commands: [], nextCursor: { createdAt: 1, id: "cursor_1" } });
    });
    await expect(client({ fetch: fetcher as typeof fetch }).pollOnce()).rejects.toThrow(/cursor repeated/i);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("treats compressed Content-Length as a preflight bound, not decoded byte equality", async () => {
    const body = JSON.stringify({ commands: [], nextCursor: null });
    const fetcher = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "1" },
    }));
    await expect(client({ fetch: fetcher as typeof fetch }).pollOnce()).resolves.toBe(0);
  });

  it("does not execute a command twice when acknowledgement delivery must be retried", async () => {
    let poll = 0; let ack = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (new URL(String(input)).pathname === "/api/agent/commands") {
        poll += 1; return json({ commands: poll === 1 ? [command()] : [], nextCursor: null });
      }
      ack += 1;
      if (ack === 1) throw new Error("response lost");
      return json({ commandId: "cmd_1", status: "acknowledged", idempotent: true });
    });
    const execute = vi.fn(async () => ({ status: "ok" as const, code: "applied" }));
    const control = client({ fetch: fetcher as typeof fetch, execute });
    await expect(control.pollOnce()).rejects.toThrow(/request failed/i);
    await expect(control.pollOnce()).resolves.toBe(0);
    expect(poll).toBe(2); expect(ack).toBe(2); expect(execute).toHaveBeenCalledOnce();
  });

  it("drains a durable outcome after restart even when the command is no longer pollable", async () => {
    const outcomeStore = memoryOutcomes();
    const original = command();
    await outcomeStore.put(original, { status: "ok", code: "applied", message: "Command applied", applied: true });
    let ackBody: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/cmd_1/ack")) {
        ackBody = JSON.parse(String(init?.body));
        return json({ commandId: "cmd_1", status: "acknowledged", idempotent: false });
      }
      return json({ commands: [], nextCursor: null });
    });
    const execute = vi.fn();
    const restarted = client({ now: () => timestamp + 86_400_000, fetch: fetcher as typeof fetch, execute, outcomeStore,
      identity: { ...identity(), credentialExpiresAt: timestamp + 7 * 86_400_000 } });
    await expect(restarted.pollOnce()).resolves.toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(ackBody).toMatchObject({ deploymentId: "dep_1", expectedDeploymentVersion: 2, status: "ok" });
    await expect(outcomeStore.list()).resolves.toEqual([]);
  });

  it("dead-letters an outcome beyond server retention without poisoning newer outcomes or command polling", async () => {
    const outcomeStore = memoryOutcomes();
    const old = command({ id: "cmd_a_old", expiresAt: timestamp });
    const fresh = command({ id: "cmd_b_fresh", expiresAt: timestamp + 7 * 86_400_000 + 60_000 });
    const applied = { status: "ok" as const, code: "applied", message: "Command applied", applied: true };
    await outcomeStore.put(old, applied); await outcomeStore.put(fresh, applied);
    const expired: PendingCommandAcknowledgement[] = [];
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname; paths.push(path);
      if (path.includes("/ack")) return json({ commandId: "cmd_b_fresh", status: "acknowledged", idempotent: false });
      return json({ commands: [], nextCursor: null });
    });
    const clock = timestamp + 7 * 86_400_000;
    await client({ now: () => clock, identity: { ...identity(), credentialExpiresAt: clock + 60_000 },
      fetch: fetcher as typeof fetch, outcomeStore, onExpiredOutcome: async (item) => { expired.push(item); } }).pollOnce();
    expect(expired.map((item) => item.commandId)).toEqual(["cmd_a_old"]);
    expect(paths).toEqual(["/api/agent/commands/cmd_b_fresh/ack", "/api/agent/commands"]);
    await expect(outcomeStore.list()).resolves.toEqual([]);
  });

  it("retains a too-late outcome when its audit sink fails while still draining newer work", async () => {
    const outcomeStore = memoryOutcomes();
    const old = command({ id: "cmd_a_old", expiresAt: timestamp });
    const fresh = command({ id: "cmd_b_fresh", expiresAt: timestamp + 7 * 86_400_000 + 60_000 });
    const applied = { status: "ok" as const, code: "applied", message: "Command applied", applied: true };
    await outcomeStore.put(old, applied); await outcomeStore.put(fresh, applied);
    let failSink = true; const audited: string[] = []; const acked: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/ack")) { acked.push(path); return json({ commandId: "cmd_b_fresh", status: "acknowledged", idempotent: false }); }
      return json({ commands: [], nextCursor: null });
    });
    const clock = timestamp + 7 * 86_400_000;
    const control = client({ now: () => clock, identity: { ...identity(), credentialExpiresAt: clock + 60_000 },
      fetch: fetcher as typeof fetch, outcomeStore, onExpiredOutcome: async (item) => {
        if (failSink) throw new Error("disk full"); audited.push(item.commandId);
      } });
    await control.pollOnce();
    expect(acked).toEqual(["/api/agent/commands/cmd_b_fresh/ack"]);
    expect((await outcomeStore.list()).map((item) => item.commandId)).toEqual(["cmd_a_old"]);
    failSink = false;
    await control.pollOnce();
    expect(audited).toEqual(["cmd_a_old"]);
    await expect(outcomeStore.list()).resolves.toEqual([]);
  });

  it("scans past more than one hundred failed dead-letter sinks to ACK newer outcomes and poll commands", async () => {
    const outcomeStore = memoryOutcomes();
    const applied = { status: "ok" as const, code: "applied", message: "Command applied", applied: true };
    for (let index = 0; index < 101; index += 1) {
      await outcomeStore.put(command({ id: `cmd_a_${String(index).padStart(3, "0")}`, expiresAt: timestamp }), applied);
    }
    await outcomeStore.put(command({ id: "cmd_z_fresh", expiresAt: timestamp + 7 * 86_400_000 + 60_000 }), applied);
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname; paths.push(path);
      if (path.includes("/ack")) return json({ commandId: "cmd_z_fresh", status: "acknowledged", idempotent: false });
      return json({ commands: [], nextCursor: null });
    });
    const clock = timestamp + 7 * 86_400_000;
    await client({ now: () => clock, identity: { ...identity(), credentialExpiresAt: clock + 60_000 },
      fetch: fetcher as typeof fetch, outcomeStore, onExpiredOutcome: async () => { throw new Error("disk full"); } }).pollOnce();
    expect(paths).toEqual(["/api/agent/commands/cmd_z_fresh/ack", "/api/agent/commands"]);
    expect((await outcomeStore.list(2_048)).length).toBe(101);
  });

  it("persists replay outcomes as encrypted owner-only atomic state", async () => {
    const storage: AsyncSafeStorage = {
      isAsyncEncryptionAvailable: () => true,
      encryptStringAsync: async (value) => Uint8Array.from(Buffer.from(value), (byte) => byte ^ 0xa5),
      decryptStringAsync: async (value) => Buffer.from(Uint8Array.from(value, (byte) => byte ^ 0xa5)).toString("utf8"),
    };
    const file: VaultFileStore & { bytes: Uint8Array | null; mode: number | null } = {
      bytes: null, mode: null,
      async read() { return this.bytes && Uint8Array.from(this.bytes); },
      async writeAtomically(bytes, mode) { this.bytes = Uint8Array.from(bytes); this.mode = mode; },
      async erase() { this.bytes = null; },
    };
    const store = createEncryptedCommandOutcomeStore(storage, file);
    const outcome = { status: "failed" as const, code: "execution_interrupted", message: "Command execution interrupted", applied: false };
    await store.put({ id: "cmd_1", deploymentId: "dep_1", expectedDeploymentVersion: 2, expiresAt: timestamp + 60_000 }, outcome);
    expect(file.mode).toBe(0o600);
    expect(Buffer.from(file.bytes!).toString("utf8")).not.toContain("execution_interrupted");
    await expect(store.get("cmd_1")).resolves.toEqual({ commandId: "cmd_1", deploymentId: "dep_1",
      expectedDeploymentVersion: 2, expiresAt: timestamp + 60_000, outcome });
    await store.delete("cmd_1");
    await expect(store.get("cmd_1")).resolves.toBeNull();
  });

  it("fails closed permanently on credential revocation", async () => {
    const onRevoked = vi.fn();
    const signer = vi.fn(async () => new Uint8Array(64));
    const fetcher = vi.fn(async () => json({ code: "device_authentication_failed" }, 401));
    const control = client({ identity: identity(signer), fetch: fetcher as typeof fetch, onRevoked });
    await expect(control.pollOnce()).rejects.toBeInstanceOf(ControlClientRevokedError);
    expect(control.isRevoked()).toBe(true); expect(onRevoked).toHaveBeenCalledOnce();
    await expect(control.createSignedRequest("/api/agent/commands")).rejects.toBeInstanceOf(ControlClientRevokedError);
    expect(fetcher).toHaveBeenCalledOnce(); expect(signer).toHaveBeenCalledOnce();
  });

  it("uploads exact telemetry envelopes and settles terminal 207 results without dropping retryable events", async () => {
    const envelope = (id: string, type: TelemetryEventEnvelope["type"]): TelemetryEventEnvelope => ({ version: 1, id, type, deploymentId: "dep_1",
      expectedDeploymentVersion: 2, correlationId: `corr_${id}`, occurredAt: timestamp, payload: {} });
    const events = [
      envelope("evt_heart", "heartbeat"), envelope("evt_ok", "signal"),
      envelope("evt_bad", "agent-error"), envelope("evt_retry", "deployment-state"),
    ];
    const acknowledge = vi.fn(async () => true);
    const buffer = { nextBatch: vi.fn(async () => ({ batchId: "batch_1", events })), acknowledge };
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = JSON.parse(String(init?.body));
      if (url.pathname.endsWith("/heartbeat")) {
        expect(Object.keys(body).sort()).toEqual(["correlationId", "deploymentId", "expectedDeploymentVersion", "id", "occurredAt", "payload", "type", "version"]);
        return json({ accepted: [{ id: "evt_heart", status: "accepted" }] });
      }
      expect(body.events.map((event: { id: string }) => event.id)).toEqual(["evt_ok", "evt_bad", "evt_retry"]);
      return json({ results: [
        { index: 0, eventId: "evt_ok", status: "accepted", code: "accepted" },
        { index: 1, status: "rejected", code: "invalid_event" },
        { index: 2, status: "retryable", code: "internal" },
      ] }, 207);
    });
    await expect(client({ fetch: fetcher as typeof fetch }).uploadOnce(buffer)).resolves.toBe(4);
    expect(acknowledge).toHaveBeenCalledWith("batch_1", ["evt_heart", "evt_ok", "evt_bad"]);
  });

  it("backs polling off exponentially within configured bounds", async () => {
    const delays: number[] = [];
    const abort = new AbortController();
    const fetcher = vi.fn(async () => { throw new Error("offline"); });
    const sleep = vi.fn(async (delay: number) => {
      delays.push(delay);
      if (delays.length === 4) abort.abort();
    });
    await client({ fetch: fetcher as typeof fetch, sleep, minimumBackoffMs: 10, maximumBackoffMs: 25 }).run(abort.signal);
    expect(delays).toEqual([10, 20, 25, 25]);
  });
});
