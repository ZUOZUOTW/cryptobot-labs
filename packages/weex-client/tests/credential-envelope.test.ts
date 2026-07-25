import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptWeexCredentials, encryptWeexCredentials, type CredentialEnvelopeKms } from "../src/credential-envelope";
import { WeexCredentials } from "../src/private-client";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

describe("WEEX credential envelope encryption", () => {
  it("round-trips with AES-256-GCM and binds ciphertext to the KMS encryption context", async () => {
    const key = new Uint8Array(32).fill(9);
    const encryptedDataKey = new Uint8Array([1, 2, 3]);
    let generatedPlaintext: Uint8Array | undefined;
    let decryptedPlaintext: Uint8Array | undefined;
    const kms: CredentialEnvelopeKms = {
      async generateDataKey() {
        generatedPlaintext = Uint8Array.from(key);
        return { plaintext: generatedPlaintext, ciphertext: encryptedDataKey, keyId: "arn:aws:kms:key/test" };
      },
      async decryptDataKey(ciphertext, context) {
        expect(ciphertext).toEqual(encryptedDataKey);
        expect(context).toEqual({ connection_id: "conn_1", user_id: "usr_1" });
        decryptedPlaintext = Uint8Array.from(key);
        return decryptedPlaintext;
      },
    };
    const envelope = await encryptWeexCredentials({ credentials: new WeexCredentials("api", "secret", "passphrase"),
      context: { user_id: "usr_1", connection_id: "conn_1" }, kms,
      crypto: { subtle, getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array) array.fill(4);
        return array;
      } } });
    expect(generatedPlaintext).toEqual(new Uint8Array(32));
    expect(JSON.stringify(envelope)).not.toContain("secret");
    const restored = await decryptWeexCredentials({ envelope,
      context: { connection_id: "conn_1", user_id: "usr_1" }, kms, crypto: { subtle } });
    expect(restored.use((value) => value)).toEqual({ apiKey: "api", secretKey: "secret", passphrase: "passphrase" });
    expect(decryptedPlaintext).toEqual(new Uint8Array(32));
  });

  it("fails authentication when an encryption-context binding changes", async () => {
    const key = new Uint8Array(32).fill(7);
    const kms: CredentialEnvelopeKms = {
      async generateDataKey() { return { plaintext: Uint8Array.from(key), ciphertext: new Uint8Array([7]), keyId: "key" }; },
      async decryptDataKey() { return Uint8Array.from(key); },
    };
    const envelope = await encryptWeexCredentials({ credentials: new WeexCredentials("api", "secret", "pass"),
      context: { connection_id: "conn_1", user_id: "usr_1" }, kms,
      crypto: { subtle, getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array) array.fill(1);
        return array;
      } } });
    await expect(decryptWeexCredentials({ envelope, context: { connection_id: "conn_2", user_id: "usr_1" }, kms,
      crypto: { subtle } })).rejects.toThrow();
  });
});
