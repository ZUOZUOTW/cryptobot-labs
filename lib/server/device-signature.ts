import type { ControlPlaneDatabase } from "../../db";
import { createDeviceNonceRepository } from "../../db/repositories/devices";
import { publicKeyJwkJson } from "../../db/repositories/shared";

export const DEVICE_SIGNATURE_MAX_BODY_BYTES = 1_048_576;
export const DEVICE_SIGNATURE_MAX_PAST_MS = 300_000;
export const DEVICE_SIGNATURE_MAX_FUTURE_MS = 30_000;

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const CREDENTIAL = /^cred_[A-Za-z0-9_-]{43}$/;
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NONCE = /^[A-Za-z0-9._~-]{16,256}$/;
const CHALLENGE = /^chl_[A-Za-z0-9_-]{43}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,15})$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const ASCII = /^[\x20-\x7e]+$/;
const encoder = new TextEncoder();

export class DeviceAuthenticationError extends Error {
  constructor() {
    super("device authentication failed");
    this.name = "DeviceAuthenticationError";
  }
}

export interface DeviceCrypto {
  digest(algorithm: "SHA-256", data: BufferSource): Promise<ArrayBuffer>;
  importKey(
    format: "jwk",
    keyData: JsonWebKey,
    algorithm: { name: "Ed25519" },
    extractable: false,
    keyUsages: ["verify"],
  ): Promise<CryptoKey>;
  verify(algorithm: { name: "Ed25519" }, key: CryptoKey, signature: BufferSource, data: BufferSource): Promise<boolean>;
}

export interface CanonicalDeviceRequestInput {
  method: string;
  url: string | URL;
  timestamp: number;
  nonce: string;
  /** Exact bytes transported on the wire. Streams must be read once, bounded, before calling this helper. */
  body: Uint8Array;
  crypto?: Pick<DeviceCrypto, "digest">;
}

const defaultCrypto = (): DeviceCrypto => crypto.subtle as unknown as DeviceCrypto;

const bytesToHex = (value: Uint8Array): string => [...value]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Bytes = async (value: Uint8Array, implementation: Pick<DeviceCrypto, "digest">): Promise<Uint8Array> =>
  new Uint8Array(await implementation.digest("SHA-256", value));

export const sha256Hex = async (value: Uint8Array | string, implementation: Pick<DeviceCrypto, "digest"> = defaultCrypto()): Promise<string> =>
  bytesToHex(await sha256Bytes(typeof value === "string" ? encoder.encode(value) : value, implementation));

const strictMethod = (method: string): string => {
  if (typeof method !== "string" || !METHODS.has(method)) throw new DeviceAuthenticationError();
  return method;
};

const strictBody = (body: Uint8Array): Uint8Array => {
  if (Object.prototype.toString.call(body) !== "[object Uint8Array]"
    || body.byteLength > DEVICE_SIGNATURE_MAX_BODY_BYTES) {
    throw new DeviceAuthenticationError();
  }
  return Uint8Array.from(body);
};

const strictTimestamp = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new DeviceAuthenticationError();
  return value;
};

/**
 * Canonical URL semantics are the WHATWG URL serialized pathname followed by its unchanged serialized search.
 * Query order, duplicate keys, empty values, and percent-escape spelling/case are therefore significant; values
 * are never decoded, sorted, or re-encoded by this helper. Fragments and URL credentials are rejected.
 */
export async function canonicalDeviceRequest(input: CanonicalDeviceRequestInput): Promise<string> {
  const method = strictMethod(input.method);
  const timestamp = strictTimestamp(input.timestamp);
  if (typeof input.nonce !== "string" || !NONCE.test(input.nonce)) throw new DeviceAuthenticationError();
  const body = strictBody(input.body);
  let url: URL;
  try { url = input.url instanceof URL ? input.url : new URL(input.url); }
  catch { throw new DeviceAuthenticationError(); }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.hash) {
    throw new DeviceAuthenticationError();
  }
  const bodyHash = await sha256Hex(body, input.crypto ?? defaultCrypto());
  return `${method}\n${url.pathname}${url.search}\n${timestamp}\n${input.nonce}\n${bodyHash}`;
}

const decodeBase64url = (value: string, expectedBytes: number): Uint8Array => {
  if (!SIGNATURE.test(value)) throw new DeviceAuthenticationError();
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "==";
    const decoded = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const canonical = btoa(String.fromCharCode(...decoded)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (decoded.byteLength !== expectedBytes || canonical !== value) throw new Error("noncanonical");
    return decoded;
  } catch { throw new DeviceAuthenticationError(); }
};

const constantTimeEqual = (left: string, right: string): boolean => {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index % Math.max(left.length, 1)) || 0)
      ^ (right.charCodeAt(index % Math.max(right.length, 1)) || 0);
  }
  return mismatch === 0;
};

const header = (headers: Headers, name: string, maximum: number): string => {
  const value = headers.get(name);
  if (value === null || value.length < 1 || value.length > maximum || !ASCII.test(value)) {
    throw new DeviceAuthenticationError();
  }
  return value;
};

const strictVerificationJwk = (encoded: string): JsonWebKey => {
  if (typeof encoded !== "string" || encoded.length > 2_048) throw new DeviceAuthenticationError();
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); }
  catch { throw new DeviceAuthenticationError(); }
  let canonical: string;
  try { canonical = publicKeyJwkJson(parsed); }
  catch { throw new DeviceAuthenticationError(); }
  const jwk = JSON.parse(canonical) as JsonWebKey;
  const x = jwk.x;
  if (typeof x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(x)) throw new DeviceAuthenticationError();
  try {
    const decoded = Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/") + "="), (item) => item.charCodeAt(0));
    const roundTrip = btoa(String.fromCharCode(...decoded)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (decoded.byteLength !== 32 || roundTrip !== x) throw new Error("invalid");
  } catch { throw new DeviceAuthenticationError(); }
  return jwk;
};

export interface VerifyDeviceRequestInput {
  headers: Headers;
  method: string;
  url: string | URL;
  body: Uint8Array;
  capability: string;
}

export interface VerifiedDeviceIdentity {
  userId: string;
  deviceId: string;
  capability: string;
}

export interface DeviceRequestVerifierDependencies {
  database: ControlPlaneDatabase;
  capabilities: readonly string[];
  crypto?: DeviceCrypto;
  now?: () => number;
  maxPastMs?: number;
  maxFutureMs?: number;
  nonceTtlMs?: number;
  noncePurgeLimit?: number;
}

interface AuthenticationRow {
  userId: string;
  deviceId: string;
  publicKeyJwk: string;
  status: string;
  revokedAt: number | null;
  credentialHash: string;
  credentialExpiresAt: number;
  credentialRevokedAt: number | null;
}

export function createDeviceRequestVerifier(dependencies: DeviceRequestVerifierDependencies) {
  const implementation = dependencies.crypto ?? defaultCrypto();
  const now = dependencies.now ?? Date.now;
  const maxPastMs = dependencies.maxPastMs ?? DEVICE_SIGNATURE_MAX_PAST_MS;
  const maxFutureMs = dependencies.maxFutureMs ?? DEVICE_SIGNATURE_MAX_FUTURE_MS;
  const nonceTtlMs = dependencies.nonceTtlMs ?? DEVICE_SIGNATURE_MAX_PAST_MS + DEVICE_SIGNATURE_MAX_FUTURE_MS + 1;
  const purgeLimit = dependencies.noncePurgeLimit ?? 25;
  const allowed = new Set(dependencies.capabilities);
  const nonces = createDeviceNonceRepository(dependencies.database);
  if (allowed.size !== dependencies.capabilities.length || [...allowed].some((item) => !/^[a-z][a-z0-9.-]{0,63}$/.test(item))) {
    throw new Error("device capability allowlist is invalid");
  }
  if (![maxPastMs, maxFutureMs, nonceTtlMs, purgeLimit].every(Number.isSafeInteger)
    || maxPastMs < 0 || maxFutureMs < 0 || nonceTtlMs < 1 || purgeLimit < 1 || purgeLimit > 100) {
    throw new Error("device verifier bounds are invalid");
  }

  return async (input: VerifyDeviceRequestInput): Promise<VerifiedDeviceIdentity> => {
    try {
      if (!allowed.has(input.capability)) throw new DeviceAuthenticationError();
      const authorization = header(input.headers, "authorization", 128);
      const match = /^Device (cred_[A-Za-z0-9_-]{43})$/.exec(authorization);
      if (!match || !CREDENTIAL.test(match[1])) throw new DeviceAuthenticationError();
      const credential = match[1];
      const deviceId = header(input.headers, "x-cbl-device-id", 128);
      if (!DEVICE_ID.test(deviceId)) throw new DeviceAuthenticationError();
      const timestampText = header(input.headers, "x-cbl-timestamp", 16);
      if (!DECIMAL.test(timestampText)) throw new DeviceAuthenticationError();
      const timestamp = Number(timestampText);
      strictTimestamp(timestamp);
      const observedNow = strictTimestamp(now());
      if (observedNow - timestamp > maxPastMs || timestamp - observedNow > maxFutureMs) throw new DeviceAuthenticationError();
      const nonce = header(input.headers, "x-cbl-nonce", 256);
      if (!NONCE.test(nonce)) throw new DeviceAuthenticationError();
      const signature = decodeBase64url(header(input.headers, "x-cbl-signature", 86), 64);
      const credentialHash = await sha256Hex(credential, implementation);
      const row = await dependencies.database.prepare(`SELECT d.id AS deviceId,d.user_id AS userId,
        d.public_key_jwk AS publicKeyJwk,d.status,d.revoked_at AS revokedAt,
        c.credential_hash AS credentialHash,c.expires_at AS credentialExpiresAt,c.revoked_at AS credentialRevokedAt
        FROM devices d JOIN device_credentials c ON c.device_id=d.id AND c.user_id=d.user_id WHERE d.id=?`)
        .bind(deviceId).first<AuthenticationRow>();
      if (!row || !SHA256_HEX.test(row.credentialHash) || row.status !== "active"
        || row.revokedAt !== null || row.credentialRevokedAt !== null
        || row.credentialExpiresAt <= observedNow || !constantTimeEqual(credentialHash, row.credentialHash)) {
        throw new DeviceAuthenticationError();
      }
      const canonical = await canonicalDeviceRequest({ ...input, timestamp, nonce, crypto: implementation });
      const key = await implementation.importKey("jwk", strictVerificationJwk(row.publicKeyJwk), { name: "Ed25519" }, false, ["verify"]);
      if (!await implementation.verify({ name: "Ed25519" }, key, signature, encoder.encode(canonical))) {
        throw new DeviceAuthenticationError();
      }
      const nonceHash = await sha256Hex(`${row.userId}\n${row.deviceId}\n${nonce}`, implementation);
      await nonces.purgeExpired(row.userId, row.deviceId, observedNow, purgeLimit);
      const claimed = await nonces.claim({ id: `nonce_${nonceHash}`, userId: row.userId, deviceId: row.deviceId,
        nonce, timestamp, expiresAt: Math.max(observedNow + 1, timestamp + nonceTtlMs), now: observedNow });
      if (!claimed) throw new DeviceAuthenticationError();
      return { userId: row.userId, deviceId: row.deviceId, capability: input.capability };
    } catch (error) {
      if (error instanceof DeviceAuthenticationError) throw error;
      throw new DeviceAuthenticationError();
    }
  };
}

export interface BootstrapProofInput {
  deviceId: string;
  challenge: string;
  publicKeyJwk: string;
  bootstrapTokenHash: string;
  expiresAt: number;
  proof: unknown;
}

export async function canonicalBootstrapProof(input: Omit<BootstrapProofInput, "proof">,
  implementation: Pick<DeviceCrypto, "digest"> = defaultCrypto()): Promise<string> {
  if (!DEVICE_ID.test(input.deviceId) || !CHALLENGE.test(input.challenge)
    || !SHA256_HEX.test(input.bootstrapTokenHash) || !Number.isSafeInteger(input.expiresAt) || input.expiresAt < 0) {
    throw new DeviceAuthenticationError();
  }
  strictVerificationJwk(input.publicKeyJwk);
  const keyHash = await sha256Hex(input.publicKeyJwk, implementation);
  return `CBL-BOOTSTRAP-V1\n${input.deviceId}\n${keyHash}\n${input.bootstrapTokenHash}\n${input.challenge}\n${input.expiresAt}`;
}

export function createBootstrapProofVerifier(implementation: DeviceCrypto = defaultCrypto()) {
  return async (input: BootstrapProofInput): Promise<boolean> => {
    try {
      if (Object.getPrototypeOf(input.proof) !== Object.prototype) return false;
      const descriptors = Object.getOwnPropertyDescriptors(input.proof as object);
      if (Object.keys(descriptors).length !== 1 || !("signature" in descriptors)
        || !("value" in descriptors.signature) || !descriptors.signature.enumerable
        || typeof descriptors.signature.value !== "string") return false;
      const signature = decodeBase64url(descriptors.signature.value, 64);
      const key = await implementation.importKey("jwk", strictVerificationJwk(input.publicKeyJwk), { name: "Ed25519" }, false, ["verify"]);
      const canonical = await canonicalBootstrapProof(input, implementation);
      return implementation.verify({ name: "Ed25519" }, key, signature, encoder.encode(canonical));
    } catch { return false; }
  };
}
