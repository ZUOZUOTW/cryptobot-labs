import { safeJsonStringify } from "../../lib/control-plane/schemas";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[A-Fa-f0-9]{64}$|^[A-Za-z0-9_-]{43}$/;
const NONCE = /^[A-Za-z0-9._~-]{16,256}$/;

export const id = (value: string, label: string): string => {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${label} is invalid`);
  return value;
};

export const time = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
};

export const expiry = (value: number, now: number): number => {
  time(value, "expiresAt");
  if (value <= now) throw new Error("expiresAt must be later than now");
  return value;
};

export const hash = (value: string): string => {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error("hash must be a SHA-256 hex or base64url digest");
  return value;
};

export const nonce = (value: string): string => {
  if (typeof value !== "string" || !NONCE.test(value)) throw new Error("nonce is invalid");
  return value;
};

export const limit = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error("limit must be between 1 and 100");
  return value;
};

export const displayName = (value: string, label = "displayName"): string => {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 100 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
};

export const publicKeyJwkJson = (value: unknown): string => {
  const encoded = safeJsonStringify(value, "public JWK", 2_048);
  const parsed = JSON.parse(encoded) as Record<string, unknown>;
  const allowed = new Set(["kty", "crv", "x", "ext", "key_ops", "alg", "use"]);
  if (Object.keys(parsed).some((key) => !allowed.has(key)) || "d" in parsed) {
    throw new Error("public JWK must not contain private or unknown fields");
  }
  if (parsed.kty !== "OKP" || parsed.crv !== "Ed25519"
    || typeof parsed.x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(parsed.x)) {
    throw new Error("public JWK must be an Ed25519 verification key");
  }
  if (parsed.ext !== undefined && parsed.ext !== true) throw new Error("public JWK ext must be true");
  if (parsed.alg !== undefined && parsed.alg !== "EdDSA") throw new Error("public JWK alg must be EdDSA");
  if (parsed.use !== undefined && parsed.use !== "sig") throw new Error("public JWK use must be sig");
  if (parsed.key_ops !== undefined
    && (!Array.isArray(parsed.key_ops) || parsed.key_ops.length !== 1 || parsed.key_ops[0] !== "verify")) {
    throw new Error("public JWK key_ops must contain only verify");
  }
  return encoded;
};

export const changed = (result: { success: boolean; meta: { changes?: number } }): boolean =>
  result.success && (result.meta.changes ?? 0) > 0;

export const exactInput = (value: object, allowed: readonly string[]): void => {
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error("repository input must be a plain object");
  }
  const known = new Set(allowed);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!known.has(key)) throw new Error(`unknown or sensitive repository field: ${key}`);
    if (!("value" in descriptor) || !descriptor.enumerable) throw new Error("repository input fields must be plain values");
  }
};
