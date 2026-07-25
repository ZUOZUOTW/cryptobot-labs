import { WeexCredentials } from "./private-client";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface EnvelopeDataKey {
  readonly plaintext: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly keyId: string;
}

/** Production implementations must be backed by a non-exportable cloud KMS key. */
export interface CredentialEnvelopeKms {
  generateDataKey(context: Readonly<Record<string, string>>): Promise<EnvelopeDataKey>;
  decryptDataKey(ciphertext: Uint8Array, context: Readonly<Record<string, string>>): Promise<Uint8Array>;
}

export interface EncryptedWeexCredentials {
  readonly version: 1;
  readonly keyId: string;
  readonly encryptedDataKey: Uint8Array;
  readonly initializationVector: Uint8Array;
  readonly ciphertext: Uint8Array;
}

function contextBytes(context: Readonly<Record<string, string>>): Uint8Array<ArrayBuffer> {
  const entries = Object.entries(context).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length < 1 || entries.length > 16 || entries.some(([key, value]) =>
    !/^[a-z][a-z0-9_.-]{0,63}$/.test(key) || value.length < 1 || value.length > 256)) {
    throw new TypeError("Invalid credential encryption context");
  }
  return encoder.encode(JSON.stringify(Object.fromEntries(entries)));
}

function randomIv(implementation: Pick<Crypto, "getRandomValues">): Uint8Array<ArrayBuffer> {
  const value = new Uint8Array(12);
  implementation.getRandomValues(value);
  return value;
}

function zero(value: Uint8Array): void {
  value.fill(0);
}

function owned(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

export async function encryptWeexCredentials(input: {
  readonly credentials: WeexCredentials;
  readonly context: Readonly<Record<string, string>>;
  readonly kms: CredentialEnvelopeKms;
  readonly crypto?: Pick<Crypto, "getRandomValues" | "subtle">;
}): Promise<EncryptedWeexCredentials> {
  const implementation = input.crypto ?? crypto;
  const additionalData = contextBytes(input.context);
  const dataKey = await input.kms.generateDataKey(input.context);
  if (dataKey.plaintext.byteLength !== 32 || dataKey.ciphertext.byteLength < 1 || dataKey.keyId.length < 1) {
    zero(dataKey.plaintext);
    throw new TypeError("KMS returned an invalid data key");
  }
  const initializationVector = randomIv(implementation);
  let plaintext: Uint8Array | undefined;
  try {
    plaintext = input.credentials.use((value) => encoder.encode(JSON.stringify(value)));
    const key = await implementation.subtle.importKey("raw", owned(dataKey.plaintext), "AES-GCM", false, ["encrypt"]);
    const ciphertext = new Uint8Array(await implementation.subtle.encrypt({ name: "AES-GCM", iv: initializationVector,
      additionalData, tagLength: 128 }, key, owned(plaintext)));
    return Object.freeze({ version: 1, keyId: dataKey.keyId,
      encryptedDataKey: Uint8Array.from(dataKey.ciphertext), initializationVector: Uint8Array.from(initializationVector),
      ciphertext });
  } finally {
    zero(dataKey.plaintext);
    if (plaintext) zero(plaintext);
  }
}

export async function decryptWeexCredentials(input: {
  readonly envelope: EncryptedWeexCredentials;
  readonly context: Readonly<Record<string, string>>;
  readonly kms: CredentialEnvelopeKms;
  readonly crypto?: Pick<Crypto, "subtle">;
}): Promise<WeexCredentials> {
  if (input.envelope.version !== 1 || input.envelope.initializationVector.byteLength !== 12
    || input.envelope.encryptedDataKey.byteLength < 1 || input.envelope.ciphertext.byteLength < 17) {
    throw new TypeError("Invalid encrypted WEEX credentials");
  }
  const implementation = input.crypto ?? crypto;
  const dataKey = await input.kms.decryptDataKey(input.envelope.encryptedDataKey, input.context);
  if (dataKey.byteLength !== 32) {
    zero(dataKey);
    throw new TypeError("KMS returned an invalid decrypted data key");
  }
  let plaintext: Uint8Array | undefined;
  try {
    const key = await implementation.subtle.importKey("raw", owned(dataKey), "AES-GCM", false, ["decrypt"]);
    plaintext = new Uint8Array(await implementation.subtle.decrypt({ name: "AES-GCM",
      iv: owned(input.envelope.initializationVector), additionalData: contextBytes(input.context), tagLength: 128 }, key,
    owned(input.envelope.ciphertext)));
    const parsed: unknown = JSON.parse(decoder.decode(plaintext));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Invalid credential payload");
    const value = parsed as Record<string, unknown>;
    if (Object.keys(value).sort().join(",") !== "apiKey,passphrase,secretKey") throw new TypeError("Invalid credential payload");
    return new WeexCredentials(value.apiKey as string, value.secretKey as string, value.passphrase as string);
  } finally {
    zero(dataKey);
    if (plaintext) zero(plaintext);
  }
}
