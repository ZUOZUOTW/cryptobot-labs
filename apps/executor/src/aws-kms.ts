import { DecryptCommand, DescribeKeyCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import type { CredentialEnvelopeKms, EnvelopeDataKey } from "@cryptobot-labs/weex-client";

function copy(value: Uint8Array | undefined, label: string): Uint8Array {
  if (!value || value.byteLength < 1) throw new Error(`AWS KMS did not return ${label}`);
  return Uint8Array.from(value);
}

export class AwsKmsCredentialEnvelope implements CredentialEnvelopeKms {
  readonly #client: KMSClient;
  readonly #keyId: string;

  constructor(options: { readonly region: string; readonly keyId: string; readonly client?: KMSClient }) {
    this.#client = options.client ?? new KMSClient({ region: options.region });
    this.#keyId = options.keyId;
  }

  async assertReady(): Promise<void> {
    const result = await this.#client.send(new DescribeKeyCommand({ KeyId: this.#keyId }));
    if (!result.KeyMetadata?.Enabled || result.KeyMetadata.KeyState !== "Enabled"
      || result.KeyMetadata.KeyUsage !== "ENCRYPT_DECRYPT" || result.KeyMetadata.KeySpec !== "SYMMETRIC_DEFAULT") {
      throw new Error("AWS KMS key is not ready for envelope encryption");
    }
  }

  async generateDataKey(context: Readonly<Record<string, string>>): Promise<EnvelopeDataKey> {
    const result = await this.#client.send(new GenerateDataKeyCommand({ KeyId: this.#keyId, NumberOfBytes: 32,
      EncryptionContext: { ...context } }));
    const plaintext = copy(result.Plaintext, "data-key plaintext");
    if (plaintext.byteLength !== 32) {
      plaintext.fill(0);
      throw new Error("AWS KMS returned an invalid data key");
    }
    return Object.freeze({ plaintext, ciphertext: copy(result.CiphertextBlob, "encrypted data key"),
      keyId: result.KeyId ?? this.#keyId });
  }

  async decryptDataKey(ciphertext: Uint8Array, context: Readonly<Record<string, string>>): Promise<Uint8Array> {
    const result = await this.#client.send(new DecryptCommand({ KeyId: this.#keyId,
      CiphertextBlob: Uint8Array.from(ciphertext), EncryptionContext: { ...context },
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT" }));
    const plaintext = copy(result.Plaintext, "decrypted data key");
    if (plaintext.byteLength !== 32) {
      plaintext.fill(0);
      throw new Error("AWS KMS returned an invalid decrypted data key");
    }
    return plaintext;
  }

  destroy(): void { this.#client.destroy(); }
}
