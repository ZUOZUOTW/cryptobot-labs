import type { CredentialEnvelopeKms, EncryptedWeexCredentials } from "@cryptobot-labs/weex-client";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const owned = (value: Uint8Array): Uint8Array<ArrayBuffer> => Uint8Array.from(value) as Uint8Array<ArrayBuffer>;
const contextBytes = (context: Readonly<Record<string, string>>): Uint8Array<ArrayBuffer> =>
  encoder.encode(JSON.stringify(Object.fromEntries(Object.entries(context).sort(([left], [right]) => left.localeCompare(right)))));

export async function encryptBackendSecret(input: {
  readonly plaintext: string;
  readonly context: Readonly<Record<string, string>>;
  readonly kms: CredentialEnvelopeKms;
  readonly crypto?: Pick<Crypto, "getRandomValues" | "subtle">;
}): Promise<EncryptedWeexCredentials> {
  const implementation = input.crypto ?? crypto;
  const dataKey = await input.kms.generateDataKey(input.context);
  const plaintext = encoder.encode(input.plaintext);
  const initializationVector = new Uint8Array(12);
  implementation.getRandomValues(initializationVector);
  try {
    if (dataKey.plaintext.byteLength !== 32) throw new TypeError("KMS returned an invalid data key");
    const key = await implementation.subtle.importKey("raw", owned(dataKey.plaintext), "AES-GCM", false, ["encrypt"]);
    const ciphertext = new Uint8Array(await implementation.subtle.encrypt({ name: "AES-GCM", iv: initializationVector,
      additionalData: contextBytes(input.context), tagLength: 128 }, key, plaintext));
    return Object.freeze({ version: 1, keyId: dataKey.keyId, encryptedDataKey: owned(dataKey.ciphertext),
      initializationVector: owned(initializationVector), ciphertext: owned(ciphertext) });
  } finally {
    dataKey.plaintext.fill(0);
    plaintext.fill(0);
  }
}

export async function decryptBackendSecret(input: {
  readonly envelope: EncryptedWeexCredentials;
  readonly context: Readonly<Record<string, string>>;
  readonly kms: CredentialEnvelopeKms;
  readonly crypto?: Pick<Crypto, "subtle">;
}): Promise<string> {
  const implementation = input.crypto ?? crypto;
  const dataKey = await input.kms.decryptDataKey(input.envelope.encryptedDataKey, input.context);
  let plaintext: Uint8Array | undefined;
  try {
    if (dataKey.byteLength !== 32) throw new TypeError("KMS returned an invalid decrypted data key");
    const key = await implementation.subtle.importKey("raw", owned(dataKey), "AES-GCM", false, ["decrypt"]);
    plaintext = new Uint8Array(await implementation.subtle.decrypt({ name: "AES-GCM",
      iv: owned(input.envelope.initializationVector), additionalData: contextBytes(input.context), tagLength: 128 },
    key, owned(input.envelope.ciphertext)));
    return decoder.decode(plaintext);
  } finally {
    dataKey.fill(0);
    plaintext?.fill(0);
  }
}
