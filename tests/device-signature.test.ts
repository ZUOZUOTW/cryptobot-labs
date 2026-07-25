import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { webcrypto } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../db";
import {
  canonicalBootstrapProof,
  canonicalDeviceRequest,
  createBootstrapProofVerifier,
  createDeviceSignatureHeaders,
  createDeviceRequestVerifier,
  DeviceAuthenticationError,
  type DeviceCrypto,
  sha256Hex,
} from "../lib/server/device-signature";
import { createPairingService } from "../lib/server/pairing";

class Statement implements ControlPlaneStatement {
  constructor(private readonly statement: StatementSync, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.statement, values); }
  async first<T>() { return (this.statement.get(...this.values as Parameters<StatementSync["get"]>) as T | undefined) ?? null; }
  async all<T>() { return { results: this.statement.all(...this.values as Parameters<StatementSync["all"]>) as T[], success: true }; }
  async run() { const result = this.statement.run(...this.values as Parameters<StatementSync["run"]>); return { success: true, meta: { changes: Number(result.changes) } }; }
}

class Database implements ControlPlaneDatabase {
  readonly raw = new DatabaseSync(":memory:");
  private tail: Promise<void> = Promise.resolve();
  constructor() {
    this.raw.exec("PRAGMA foreign_keys=ON");
    const migration = readdirSync(resolve("drizzle")).find((file) => file.endsWith(".sql"))!;
    for (const sql of readFileSync(resolve("drizzle", migration), "utf8").split("--> statement-breakpoint")) {
      if (sql.trim()) this.raw.exec(sql);
    }
  }
  prepare(sql: string) { return new Statement(this.raw.prepare(sql)); }
  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolveTail) => { release = resolveTail; });
    await previous;
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    } finally { release(); }
  }
}

const subtle = webcrypto.subtle as unknown as DeviceCrypto;
const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const credential = `cred_${base64url(new Uint8Array(32).fill(7))}`;
const deviceId = "dev_signature_a";
const now = 1_700_000_000_000;
const url = "https://labs.example/api/device/heartbeat?b=2&a=%2F";
const body = encoder.encode('{"health":"ok"}');

type KeyPair = CryptoKeyPair & { publicKey: CryptoKey; privateKey: CryptoKey };
const keyPair = async (): Promise<{ pair: KeyPair; jwk: JsonWebKey; encoded: string }> => {
  const pair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as KeyPair;
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  // Node labels this experimental WebCrypto key "Ed25519"; the wire contract permits only standard EdDSA or omission.
  delete jwk.alg;
  return { pair, jwk, encoded: JSON.stringify(jwk) };
};

const signedHeaders = async (pair: KeyPair, options: { method?: string; url?: string; body?: Uint8Array;
  timestamp?: number; nonce?: string; credential?: string; deviceId?: string } = {}): Promise<Headers> => {
  const timestamp = options.timestamp ?? now;
  const nonce = options.nonce ?? "nonce_1234567890abcdef";
  const canonical = await canonicalDeviceRequest({ method: options.method ?? "POST", url: options.url ?? url,
    timestamp, nonce, body: options.body ?? body, crypto: subtle });
  const signature = new Uint8Array(await webcrypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, encoder.encode(canonical)));
  return createDeviceSignatureHeaders({
    credential: options.credential ?? credential,
    deviceId: options.deviceId ?? deviceId,
    timestamp,
    nonce,
    signature: base64url(signature),
  });
};

describe("device signature", () => {
  let database: Database;
  let keys: Awaited<ReturnType<typeof keyPair>>;
  beforeEach(async () => {
    database = new Database();
    keys = await keyPair();
    const credentialHash = await sha256Hex(credential, subtle);
    database.raw.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run("usr_a", "a@example.com", "A", 1, 1);
    database.raw.prepare("INSERT INTO devices VALUES (?,?,?,?,?,'active',?,NULL,NULL,?,?)")
      .run(deviceId, "usr_a", "Mac", "macos", keys.encoded, 1, 1, 1);
    database.raw.prepare("INSERT INTO device_credentials VALUES (?,?,?,?,NULL,?)")
      .run(deviceId, "usr_a", credentialHash, now + 1_000_000, 1);
  });

  it("uses one deterministic request canonicalization shared by server and agent", async () => {
    await expect(canonicalDeviceRequest({
      method: "POST",
      url,
      timestamp: now,
      nonce: "nonce_1234567890abcdef",
      body: new TextEncoder().encode("{}"),
      crypto: subtle,
    })).resolves.toBe(
      "POST\n/api/device/heartbeat?b=2&a=%2F\n1700000000000\nnonce_1234567890abcdef\n44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
    await expect(canonicalDeviceRequest({ method: "post", url, timestamp: now,
      nonce: "nonce_1234567890abcdef", body, crypto: subtle })).rejects.toBeInstanceOf(DeviceAuthenticationError);
    const reordered = await canonicalDeviceRequest({ method: "POST", url: "https://labs.example/api/device/heartbeat?a=%2F&b=2",
      timestamp: now, nonce: "nonce_1234567890abcdef", body, crypto: subtle });
    expect(reordered).not.toContain("?b=2&a=%2F");
  });

  it("verifies a credential-safe identity and atomically rejects concurrent nonce replay", async () => {
    const verify = createDeviceRequestVerifier({ database, capabilities: ["heartbeat.write"], crypto: subtle, now: () => now });
    const headers = await signedHeaders(keys.pair);
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => verify({
      headers, method: "POST", url, body, capability: "heartbeat.write",
    })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const accepted = results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<unknown>;
    expect(accepted.value).toEqual({ userId: "usr_a", deviceId, capability: "heartbeat.write" });
    expect(JSON.stringify(accepted.value)).not.toContain(credential);
    expect(database.raw.prepare("SELECT count(*) AS count FROM device_nonces").get()).toEqual({ count: 1 });
  });

  it("uses only the exact Device-prefixed timestamp, nonce, and signature headers", async () => {
    const verify = createDeviceRequestVerifier({ database, capabilities: ["heartbeat.write"], crypto: subtle, now: () => now });
    const exact = await signedHeaders(keys.pair, { nonce: "nonce_exact_headers_12" });
    expect([...exact.keys()]).toEqual(expect.arrayContaining([
      "authorization", "x-cbl-device-id", "x-cbl-device-timestamp", "x-cbl-device-nonce", "x-cbl-device-signature",
    ]));
    const legacy = new Headers({
      Authorization: exact.get("Authorization")!,
      "X-CBL-Device-Id": exact.get("X-CBL-Device-Id")!,
      "X-CBL-Timestamp": exact.get("X-CBL-Device-Timestamp")!,
      "X-CBL-Nonce": exact.get("X-CBL-Device-Nonce")!,
      "X-CBL-Signature": exact.get("X-CBL-Device-Signature")!,
    });
    await expect(verify({ headers: legacy, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
    exact.set("X-CBL-Nonce", exact.get("X-CBL-Device-Nonce")!);
    await expect(verify({ headers: exact, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
  });

  it("fails closed on unsafe windows and retains a nonce for the entire accepted replay window", async () => {
    const dependency = { database, capabilities: ["heartbeat.write"], crypto: subtle, now: () => now } as const;
    for (const config of [
      { maxPastMs: 0, maxFutureMs: 20, nonceTtlMs: 21 },
      { maxPastMs: 100, maxFutureMs: 0, nonceTtlMs: 101 },
      { maxPastMs: 100, maxFutureMs: 20, nonceTtlMs: 120 },
      { maxPastMs: Number.MAX_SAFE_INTEGER, maxFutureMs: 1, nonceTtlMs: Number.MAX_SAFE_INTEGER },
      { maxPastMs: 100.5, maxFutureMs: 20, nonceTtlMs: 122 },
    ]) expect(() => createDeviceRequestVerifier({ ...dependency, ...config })).toThrow(/bounds/i);

    let clock = now - 20;
    const verify = createDeviceRequestVerifier({ ...dependency, now: () => clock,
      maxPastMs: 100, maxFutureMs: 20, nonceTtlMs: 121 });
    const headers = await signedHeaders(keys.pair, { timestamp: now, nonce: "nonce_full_window_123" });
    await expect(verify({ headers, method: "POST", url, body, capability: "heartbeat.write" })).resolves.toBeTruthy();
    clock = now + 100;
    await expect(verify({ headers, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
    expect(database.raw.prepare("SELECT count(*) AS count FROM device_nonces").get()).toEqual({ count: 1 });

    database.raw.exec("DELETE FROM device_nonces");
    clock = Number.MAX_SAFE_INTEGER - 10;
    database.raw.prepare("UPDATE device_credentials SET expires_at=?").run(Number.MAX_SAFE_INTEGER);
    const overflow = await signedHeaders(keys.pair, { timestamp: clock, nonce: "nonce_expiry_overflow" });
    await expect(verify({ headers: overflow, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
    expect(database.raw.prepare("SELECT count(*) AS count FROM device_nonces").get()).toEqual({ count: 0 });
  });

  it("does not burn a nonce for a bad signature and signs method, path, query, and body", async () => {
    const verify = createDeviceRequestVerifier({ database, capabilities: ["heartbeat.write"], crypto: subtle, now: () => now });
    const nonce = "nonce_unburned_123456";
    const headers = await signedHeaders(keys.pair, { nonce });
    await expect(verify({ headers, method: "POST", url: `${url}&tampered=1`, body,
      capability: "heartbeat.write" })).rejects.toThrow("device authentication failed");
    expect(database.raw.prepare("SELECT count(*) AS count FROM device_nonces").get()).toEqual({ count: 0 });
    await expect(verify({ headers, method: "POST", url, body, capability: "heartbeat.write" }))
      .resolves.toMatchObject({ deviceId });
    for (const [field, value] of [
      ["method", "PUT"], ["url", url.replace("b=2", "b=3")], ["body", encoder.encode("tampered")],
    ] as const) {
      const freshHeaders = await signedHeaders(keys.pair, { nonce: `nonce_tamper_${field}_1234` });
      await expect(verify({ headers: freshHeaders, method: field === "method" ? value as string : "POST",
        url: field === "url" ? value as string : url, body: field === "body" ? value as Uint8Array : body,
        capability: "heartbeat.write" })).rejects.toBeInstanceOf(DeviceAuthenticationError);
    }
    const nonceTamper = await signedHeaders(keys.pair, { nonce: "nonce_signed_original12" });
    nonceTamper.set("X-CBL-Device-Nonce", "nonce_signed_tampered12");
    await expect(verify({ headers: nonceTamper, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
    const signatureTamper = await signedHeaders(keys.pair, { nonce: "nonce_signature_tamper" });
    const original = signatureTamper.get("X-CBL-Device-Signature")!;
    signatureTamper.set("X-CBL-Device-Signature", `${original[0] === "A" ? "B" : "A"}${original.slice(1)}`);
    await expect(verify({ headers: signatureTamper, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
  });

  it("enforces inclusive asymmetric clock windows and canonical timestamp text", async () => {
    const verify = createDeviceRequestVerifier({ database, capabilities: ["heartbeat.write"], crypto: subtle,
      now: () => now, maxPastMs: 100, maxFutureMs: 20 });
    for (const timestamp of [now - 100, now + 20]) {
      const headers = await signedHeaders(keys.pair, { timestamp, nonce: `nonce_boundary_${timestamp}` });
      await expect(verify({ headers, method: "POST", url, body, capability: "heartbeat.write" })).resolves.toBeTruthy();
    }
    for (const timestamp of [now - 101, now + 21]) {
      const headers = await signedHeaders(keys.pair, { timestamp, nonce: `nonce_outside_${timestamp}` });
      await expect(verify({ headers, method: "POST", url, body, capability: "heartbeat.write" })).rejects.toBeInstanceOf(DeviceAuthenticationError);
    }
    const leadingZero = await signedHeaders(keys.pair, { nonce: "nonce_leading_zero_123" });
    leadingZero.set("X-CBL-Device-Timestamp", `0${now}`);
    await expect(verify({ headers: leadingZero, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
  });

  it("fails closed for wrong or expired credentials, revoked devices, and unlisted capabilities", async () => {
    const verify = createDeviceRequestVerifier({ database, capabilities: ["heartbeat.write"], crypto: subtle, now: () => now });
    const wrong = await signedHeaders(keys.pair, { credential: `cred_${base64url(new Uint8Array(32).fill(8))}`,
      nonce: "nonce_wrong_credential" });
    await expect(verify({ headers: wrong, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toThrow("device authentication failed");
    const valid = await signedHeaders(keys.pair, { nonce: "nonce_capability_1234" });
    await expect(verify({ headers: valid, method: "POST", url, body, capability: "orders.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
    database.raw.prepare("UPDATE device_credentials SET expires_at=?").run(now);
    await expect(verify({ headers: valid, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
    database.raw.prepare("UPDATE device_credentials SET expires_at=?").run(now + 1_000_000);
    database.raw.prepare("UPDATE device_credentials SET revoked_at=?").run(now);
    await expect(verify({ headers: valid, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
    database.raw.prepare("UPDATE device_credentials SET revoked_at=NULL").run();
    database.raw.prepare("UPDATE devices SET status='revoked',revoked_at=?").run(now);
    await expect(verify({ headers: valid, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
  });

  it("rejects malformed headers, signatures, JWKs, and oversized bodies with one safe error", async () => {
    const verify = createDeviceRequestVerifier({ database, capabilities: ["heartbeat.write"], crypto: subtle, now: () => now });
    const cases = [
      ["Authorization", credential], ["X-CBL-Device-Nonce", "short"], ["X-CBL-Device-Signature", "A".repeat(86)],
      ["X-CBL-Device-Id", "bad device"],
    ] as const;
    for (const [name, value] of cases) {
      const headers = await signedHeaders(keys.pair, { nonce: `nonce_malformed_${name.replace(/-/g, "")}` });
      headers.set(name, value);
      const error = await verify({ headers, method: "POST", url, body, capability: "heartbeat.write" }).catch((reason: unknown) => reason);
      expect(error).toEqual(expect.objectContaining({ message: "device authentication failed" }));
      expect(JSON.stringify(error)).not.toContain(credential);
    }
    database.raw.prepare("UPDATE devices SET public_key_jwk=?").run('{"kty":"OKP","crv":"Ed25519","x":"_"}');
    const headers = await signedHeaders(keys.pair, { nonce: "nonce_malformed_jwk12" });
    await expect(verify({ headers, method: "POST", url, body, capability: "heartbeat.write" }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
    await expect(canonicalDeviceRequest({ method: "POST", url, timestamp: now,
      nonce: "nonce_large_body_123", body: new Uint8Array(1_048_577), crypto: subtle }))
      .rejects.toBeInstanceOf(DeviceAuthenticationError);
  });

  it("verifies a bootstrap challenge proof bound to key, token hash, challenge, expiry, and activates pairing", async () => {
    const pairing = createPairingService({ database, randomBytes: (() => { let fill = 20; return (length: number) => new Uint8Array(length).fill(fill++); })(),
      verifyBootstrapProof: createBootstrapProofVerifier(subtle) });
    const code = await pairing.issueCode({ userId: "usr_a", now: 10 });
    const boot = await pairing.consumeCode({ code: code.code, name: "Second Mac", platform: "macos", publicKeyJwk: keys.jwk, now: 11 });
    const row = database.raw.prepare(`SELECT d.public_key_jwk AS publicKeyJwk,b.bootstrap_hash AS bootstrapTokenHash,
      b.expires_at AS expiresAt FROM device_bootstraps b JOIN devices d ON d.id=b.device_id WHERE b.device_id=?`).get(boot.deviceId) as {
        publicKeyJwk: string; bootstrapTokenHash: string; expiresAt: number;
      };
    const canonical = await canonicalBootstrapProof({ deviceId: boot.deviceId, challenge: boot.challenge,
      publicKeyJwk: row.publicKeyJwk, bootstrapTokenHash: row.bootstrapTokenHash, expiresAt: row.expiresAt }, subtle);
    const signature = base64url(new Uint8Array(await webcrypto.subtle.sign({ name: "Ed25519" }, keys.pair.privateKey, encoder.encode(canonical))));
    await expect(pairing.completeActivation({ deviceId: boot.deviceId, bootstrapToken: boot.bootstrapToken,
      challenge: boot.challenge, proof: { signature }, now: 12 })).resolves.toMatchObject({ expiresAt: 2_592_000_012 });
    expect(database.raw.prepare("SELECT status FROM devices WHERE id=?").get(boot.deviceId)).toEqual({ status: "active" });
  });
});
