import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createDeviceIdentityVault, type DeviceCrypto } from "../src/main/device-identity";
import { createPairingClient } from "../src/main/pairing-client";
import { createPairingExpiryGuard } from "../src/main/pairing-expiry";
import type { AsyncSafeStorage, VaultFileStore } from "../src/main/vault";

const subtle = webcrypto.subtle as unknown as DeviceCrypto;
const base64url = (size: number, fill: number): string => Buffer.from(new Uint8Array(size).fill(fill)).toString("base64url");
const code = `CBL-${base64url(16, 1)}`;
const bootstrapToken = `bst_${base64url(16, 2)}`;
const challenge = `chl_${base64url(32, 3)}`;
const credential = `cred_${base64url(32, 4)}`;
const deviceId = "dev_pairing_test";

function storage(): AsyncSafeStorage {
  return {
    isAsyncEncryptionAvailable: () => true,
    async encryptStringAsync(plaintext) {
      return Uint8Array.from(Buffer.from(plaintext), (byte) => byte ^ 0xa5);
    },
    async decryptStringAsync(ciphertext) {
      return Buffer.from(Uint8Array.from(ciphertext, (byte) => byte ^ 0xa5)).toString("utf8");
    },
  };
}

function fileStore(): VaultFileStore & { bytes: Uint8Array | null; writes: number } {
  return {
    bytes: null,
    writes: 0,
    async read() { return this.bytes ? Uint8Array.from(this.bytes) : null; },
    async writeAtomically(bytes) { this.bytes = Uint8Array.from(bytes); this.writes += 1; },
    async erase() { this.bytes = null; },
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

const sha256 = async (value: string): Promise<string> => Buffer.from(
  await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
).toString("hex");

describe("agent pairing client", () => {
  it("fails closed at local credential expiry even while the control plane is offline", async () => {
    let clock = 1_000;
    const callbacks: Array<() => void> = [];
    const onExpired = vi.fn(async () => undefined);
    const guard = createPairingExpiryGuard({
      now: () => clock,
      onExpired,
      setTimer: (callback) => { callbacks.push(callback); return callbacks.length as unknown as ReturnType<typeof setTimeout>; },
      clearTimer: () => undefined,
    });

    await guard.schedule(2_000);
    expect(onExpired).not.toHaveBeenCalled();
    clock = 2_000;
    callbacks.shift()?.();
    await vi.waitFor(() => expect(onExpired).toHaveBeenCalledOnce());
  });

  it("uploads only a public Ed25519 JWK, proves possession, and encrypts the private identity", async () => {
    const store = fileStore();
    const identityVault = createDeviceIdentityVault(storage(), store, subtle);
    const requests: Array<{ url: string; body: Record<string, unknown>; init: RequestInit }> = [];
    let uploadedPublicJwk: JsonWebKey | undefined;
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url: String(url), body, init: init! });
      if (String(url).endsWith("/pairings/consume")) {
        uploadedPublicJwk = body.publicKeyJwk as JsonWebKey;
        return json({ deviceId, bootstrapToken, challenge, expiresAt: 60_000 });
      }
      const publicJson = JSON.stringify(uploadedPublicJwk);
      const canonical = `CBL-BOOTSTRAP-V1\n${deviceId}\n${await sha256(publicJson)}\n${await sha256(bootstrapToken)}\n${challenge}\n60000`;
      const verificationKey = await webcrypto.subtle.importKey(
        "jwk", uploadedPublicJwk!, { name: "Ed25519" }, false, ["verify"],
      );
      const signature = Buffer.from(String(body.signature), "base64url");
      expect(await webcrypto.subtle.verify("Ed25519", verificationKey, signature, new TextEncoder().encode(canonical))).toBe(true);
      return json({ deviceId, credential, expiresAt: 2_592_000_000 });
    }) as unknown as typeof fetch;

    const client = createPairingClient({ baseUrl: "https://labs.example", identityVault, fetch: fetcher,
      crypto: subtle, now: () => 1_000 });
    await expect(client.pair({ code, deviceName: "Trading Mac", platform: "macos" })).resolves.toEqual({
      deviceId, credentialExpiresAt: 2_592_000_000,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://labs.example/api/agent/pairings/consume");
    expect(requests[0]?.body.publicKeyJwk).toMatchObject({ kty: "OKP", crv: "Ed25519", key_ops: ["verify"] });
    expect(requests[0]?.body.publicKeyJwk).not.toHaveProperty("d");
    expect(requests[1]?.url).toBe("https://labs.example/api/agent/bootstrap/complete");
    expect(JSON.stringify(requests)).not.toMatch(/secretKey|passphrase|apiKey/i);
    expect(store.writes).toBe(1);
    expect(Buffer.from(store.bytes ?? []).toString("utf8")).not.toContain(credential);
    expect(Buffer.from(store.bytes ?? []).toString("utf8")).not.toContain('"d"');

    const loaded = await identityVault.load();
    expect(loaded).toMatchObject({ deviceId, credential, credentialExpiresAt: 2_592_000_000 });
    const proof = new TextEncoder().encode("proof of key possession");
    const signed = await loaded!.sign(proof);
    const verificationKey = await webcrypto.subtle.importKey("jwk", loaded!.publicKeyJwk, "Ed25519", false, ["verify"]);
    await expect(webcrypto.subtle.verify("Ed25519", verificationKey, signed, proof)).resolves.toBe(true);
  });

  it("fails closed when bootstrap material is expired and never persists a partial identity", async () => {
    const store = fileStore();
    const fetcher = vi.fn(async () => json({ deviceId, bootstrapToken, challenge, expiresAt: 1_000 })) as unknown as typeof fetch;
    const client = createPairingClient({ baseUrl: "https://labs.example",
      identityVault: createDeviceIdentityVault(storage(), store, subtle), fetch: fetcher, crypto: subtle, now: () => 1_000 });

    await expect(client.pair({ code, deviceName: "Mac", platform: "macos" })).rejects.toThrow(/invalid|expired/i);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.writes).toBe(0);
  });

  it("rejects a mismatched activation before replacing the previous identity", async () => {
    const store = fileStore();
    const identityVault = createDeviceIdentityVault(storage(), store, subtle);
    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      return call === 1
        ? json({ deviceId, bootstrapToken, challenge, expiresAt: 61_000 })
        : json({ deviceId: "dev_attacker", credential, expiresAt: 2_592_000_000 });
    }) as unknown as typeof fetch;
    const client = createPairingClient({ baseUrl: "https://labs.example", identityVault, fetch: fetcher,
      crypto: subtle, now: () => 1_000 });

    await expect(client.pair({ code, deviceName: "Mac", platform: "macos" })).rejects.toThrow(/invalid/i);
    expect(store.writes).toBe(0);
  });

  it("rejects accidental secret-bearing input before any serialization", async () => {
    const fetcher = vi.fn(async () => json({})) as unknown as typeof fetch;
    const client = createPairingClient({ baseUrl: "https://labs.example",
      identityVault: createDeviceIdentityVault(storage(), fileStore(), subtle), fetch: fetcher, crypto: subtle });
    const unsafe = { code, deviceName: "Mac", platform: "macos", secretKey: "must-never-leave-device" };

    await expect(client.pair(unsafe as never)).rejects.toThrow(/input/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not persist identity material when OS-backed encryption is unavailable", async () => {
    const store = fileStore();
    const unavailable = { ...storage(), isAsyncEncryptionAvailable: () => false };
    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      return call === 1
        ? json({ deviceId, bootstrapToken, challenge, expiresAt: 61_000 })
        : json({ deviceId, credential, expiresAt: 2_592_000_000 });
    }) as unknown as typeof fetch;
    const client = createPairingClient({ baseUrl: "https://labs.example",
      identityVault: createDeviceIdentityVault(unavailable, store, subtle), fetch: fetcher, crypto: subtle, now: () => 1_000 });

    await expect(client.pair({ code, deviceName: "Mac", platform: "macos" })).rejects.toThrow(/unavailable/i);
    expect(store.writes).toBe(0);
  });

  it("allows only one pairing transaction per singleton client", async () => {
    let releaseConsume!: () => void;
    const consumeGate = new Promise<void>((resolve) => { releaseConsume = resolve; });
    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        await consumeGate;
        return json({ deviceId, bootstrapToken, challenge, expiresAt: 61_000 });
      }
      return json({ deviceId, credential, expiresAt: 2_592_000_000 });
    }) as unknown as typeof fetch;
    const client = createPairingClient({ baseUrl: "https://labs.example",
      identityVault: createDeviceIdentityVault(storage(), fileStore(), subtle), fetch: fetcher, crypto: subtle, now: () => 1_000 });

    const first = client.pair({ code, deviceName: "Mac", platform: "macos" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await expect(client.pair({ code, deviceName: "Second", platform: "macos" })).rejects.toThrow(/already in progress/i);
    releaseConsume();
    await expect(first).resolves.toMatchObject({ deviceId });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("requires HTTPS except for an explicit loopback development origin", () => {
    const vault = createDeviceIdentityVault(storage(), fileStore(), subtle);
    expect(() => createPairingClient({ baseUrl: "http://labs.example", identityVault: vault })).toThrow(/HTTPS/i);
    expect(() => createPairingClient({ baseUrl: "http://localhost:3000", identityVault: vault })).not.toThrow();
    expect(() => createPairingClient({ baseUrl: "https://user:pass@labs.example", identityVault: vault })).toThrow(/HTTPS/i);
  });
});
