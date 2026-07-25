import type { AsyncSafeStorage, VaultFileStore } from "./vault";

const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CREDENTIAL = /^cred_[A-Za-z0-9_-]{43}$/;
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const PRIVATE_BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;

export interface DeviceCrypto {
  digest(algorithm: "SHA-256", data: BufferSource): Promise<ArrayBuffer>;
  generateKey(
    algorithm: { name: "Ed25519" },
    extractable: true,
    keyUsages: ["sign", "verify"],
  ): Promise<CryptoKeyPair>;
  exportKey(format: "jwk", key: CryptoKey): Promise<JsonWebKey>;
  importKey(
    format: "jwk",
    keyData: JsonWebKey,
    algorithm: { name: "Ed25519" },
    extractable: false,
    keyUsages: ["sign"],
  ): Promise<CryptoKey>;
  sign(algorithm: { name: "Ed25519" }, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
}

export interface GeneratedDeviceKeyPair {
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  privateKey: CryptoKey;
}

export interface PersistedDeviceIdentity {
  deviceId: string;
  credential: string;
  credentialExpiresAt: number;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

export interface LoadedDeviceIdentity {
  readonly deviceId: string;
  readonly credential: string;
  readonly credentialExpiresAt: number;
  readonly publicKeyJwk: JsonWebKey;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export interface DeviceIdentityVault {
  load(): Promise<LoadedDeviceIdentity | null>;
  replace(identity: PersistedDeviceIdentity): Promise<void>;
  erase(): Promise<void>;
}

const defaultCrypto = (): DeviceCrypto => crypto.subtle as unknown as DeviceCrypto;

function publicJwk(value: JsonWebKey): JsonWebKey {
  if (value.kty !== "OKP" || value.crv !== "Ed25519" || typeof value.x !== "string"
    || !BASE64URL_32.test(value.x) || value.d !== undefined) {
    throw new Error("Device public key is invalid");
  }
  return Object.freeze({ kty: "OKP", crv: "Ed25519", x: value.x, ext: true, key_ops: ["verify"] });
}

function privateJwk(value: JsonWebKey, expectedX: string): JsonWebKey {
  if (value.kty !== "OKP" || value.crv !== "Ed25519" || value.x !== expectedX
    || typeof value.d !== "string" || !PRIVATE_BASE64URL_32.test(value.d)) {
    throw new Error("Device private key is invalid");
  }
  return { kty: "OKP", crv: "Ed25519", x: expectedX, d: value.d, ext: true, key_ops: ["sign"] };
}

function validateMetadata(value: Pick<PersistedDeviceIdentity, "deviceId" | "credential" | "credentialExpiresAt">): void {
  if (!DEVICE_ID.test(value.deviceId) || !CREDENTIAL.test(value.credential)
    || !Number.isSafeInteger(value.credentialExpiresAt) || value.credentialExpiresAt < 1) {
    throw new Error("Device identity is invalid");
  }
}

function parsePersistedIdentity(serialized: string): PersistedDeviceIdentity {
  let value: unknown;
  try { value = JSON.parse(serialized); }
  catch { throw new Error("Device identity vault is corrupt"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Device identity vault is corrupt");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "credential,credentialExpiresAt,deviceId,privateKeyJwk,publicKeyJwk") {
    throw new Error("Device identity vault is corrupt");
  }
  const identity = record as unknown as PersistedDeviceIdentity;
  validateMetadata(identity);
  const normalizedPublic = publicJwk(identity.publicKeyJwk);
  const normalizedPrivate = privateJwk(identity.privateKeyJwk, normalizedPublic.x!);
  return { ...identity, publicKeyJwk: normalizedPublic, privateKeyJwk: normalizedPrivate };
}

async function ensureEncryption(storage: AsyncSafeStorage): Promise<void> {
  if (!(await storage.isAsyncEncryptionAvailable())) throw new Error("OS-backed encryption is unavailable");
}

async function encrypt(storage: AsyncSafeStorage, plaintext: string): Promise<Uint8Array> {
  const operation = storage.encryptStringAsync ?? storage.encryptString;
  if (!operation) throw new Error("OS-backed encryption is unavailable");
  const encrypted = await operation.call(storage, plaintext);
  if (!(encrypted instanceof Uint8Array) || encrypted.byteLength < 1) throw new Error("OS-backed encryption failed");
  return encrypted;
}

async function decrypt(storage: AsyncSafeStorage, ciphertext: Uint8Array): Promise<string> {
  const operation = storage.decryptStringAsync ?? storage.decryptString;
  if (!operation) throw new Error("OS-backed encryption is unavailable");
  return operation.call(storage, ciphertext);
}

export async function generateDeviceKeyPair(
  implementation: DeviceCrypto = defaultCrypto(),
): Promise<GeneratedDeviceKeyPair> {
  const pair = await implementation.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyJwk = publicJwk(await implementation.exportKey("jwk", pair.publicKey));
  const privateKeyJwk = privateJwk(await implementation.exportKey("jwk", pair.privateKey), publicKeyJwk.x!);
  const privateKey = await implementation.importKey("jwk", privateKeyJwk, { name: "Ed25519" }, false, ["sign"]);
  return { publicKeyJwk, privateKeyJwk, privateKey };
}

export function createDeviceIdentityVault(
  storage: AsyncSafeStorage,
  fileStore: VaultFileStore,
  implementation: DeviceCrypto = defaultCrypto(),
): DeviceIdentityVault {
  let queue: Promise<void> = Promise.resolve();
  const exclusively = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    load() {
      return exclusively(async () => {
        await ensureEncryption(storage);
        const stored = await fileStore.read();
        if (!stored) return null;
        const ciphertext = Uint8Array.from(stored);
        let parsed: PersistedDeviceIdentity | undefined;
        try {
          parsed = parsePersistedIdentity(await decrypt(storage, ciphertext));
          const signingKey = await implementation.importKey(
            "jwk", parsed.privateKeyJwk, { name: "Ed25519" }, false, ["sign"],
          );
          const { deviceId, credential, credentialExpiresAt, publicKeyJwk } = parsed;
          return Object.freeze({
            deviceId,
            credential,
            credentialExpiresAt,
            publicKeyJwk,
            async sign(data: Uint8Array) {
              if (!(data instanceof Uint8Array)) throw new TypeError("Signing input must be bytes");
              return new Uint8Array(await implementation.sign({ name: "Ed25519" }, signingKey, Uint8Array.from(data)));
            },
          });
        } finally {
          ciphertext.fill(0);
          if (parsed?.privateKeyJwk.d) parsed.privateKeyJwk.d = "";
        }
      });
    },

    replace(input) {
      const snapshot: PersistedDeviceIdentity = {
        deviceId: input.deviceId,
        credential: input.credential,
        credentialExpiresAt: input.credentialExpiresAt,
        publicKeyJwk: { ...input.publicKeyJwk },
        privateKeyJwk: { ...input.privateKeyJwk },
      };
      return exclusively(async () => {
        let encrypted: Uint8Array | undefined;
        let writeCopy: Uint8Array | undefined;
        let persisted: PersistedDeviceIdentity | undefined;
        try {
          await ensureEncryption(storage);
          validateMetadata(snapshot);
          const normalizedPublic = publicJwk(snapshot.publicKeyJwk);
          const normalizedPrivate = privateJwk(snapshot.privateKeyJwk, normalizedPublic.x!);
          persisted = { ...snapshot, publicKeyJwk: normalizedPublic, privateKeyJwk: normalizedPrivate };
          encrypted = await encrypt(storage, JSON.stringify(persisted));
          writeCopy = Uint8Array.from(encrypted);
          await fileStore.writeAtomically(writeCopy, 0o600);
        } finally {
          encrypted?.fill(0);
          writeCopy?.fill(0);
          if (persisted?.privateKeyJwk.d) persisted.privateKeyJwk.d = "";
          if (snapshot.privateKeyJwk.d) snapshot.privateKeyJwk.d = "";
          snapshot.credential = "";
        }
      });
    },

    erase() { return exclusively(() => fileStore.erase()); },
  };
}
