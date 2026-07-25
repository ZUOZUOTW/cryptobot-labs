import { DecryptCommand, DescribeKeyCommand, GenerateDataKeyCommand, type KMSClient } from "@aws-sdk/client-kms";
import { describe, expect, it, vi } from "vitest";

import { AwsKmsCredentialEnvelope } from "../src/aws-kms";

const keyId = "arn:aws:kms:ap-northeast-1:123456789012:key/12345678-1234-1234-1234-123456789abc";

describe("AWS KMS credential envelope adapter", () => {
  it("verifies the production key and binds GenerateDataKey/Decrypt to the exact context", async () => {
    const context = { connection_id: "conn_1", user_id: "usr_1" };
    const destroy = vi.fn();
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof DescribeKeyCommand) return { KeyMetadata: { Enabled: true, KeyState: "Enabled",
        KeyUsage: "ENCRYPT_DECRYPT", KeySpec: "SYMMETRIC_DEFAULT" } };
      if (command instanceof GenerateDataKeyCommand) {
        expect(command.input).toEqual({ KeyId: keyId, NumberOfBytes: 32, EncryptionContext: context });
        return { Plaintext: new Uint8Array(32).fill(7), CiphertextBlob: new Uint8Array([1, 2, 3]), KeyId: keyId };
      }
      if (command instanceof DecryptCommand) {
        expect(command.input).toEqual({ KeyId: keyId, CiphertextBlob: new Uint8Array([1, 2, 3]),
          EncryptionContext: context, EncryptionAlgorithm: "SYMMETRIC_DEFAULT" });
        return { Plaintext: new Uint8Array(32).fill(7) };
      }
      throw new Error("unexpected command");
    });
    const kms = new AwsKmsCredentialEnvelope({ region: "ap-northeast-1", keyId,
      client: { send, destroy } as unknown as KMSClient });
    await expect(kms.assertReady()).resolves.toBeUndefined();
    const generated = await kms.generateDataKey(context);
    expect(generated).toMatchObject({ keyId, ciphertext: new Uint8Array([1, 2, 3]) });
    await expect(kms.decryptDataKey(generated.ciphertext, context)).resolves.toEqual(new Uint8Array(32).fill(7));
    kms.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("fails closed for a disabled or asymmetric KMS key", async () => {
    const send = vi.fn(async () => ({ KeyMetadata: { Enabled: false, KeyState: "Disabled",
      KeyUsage: "SIGN_VERIFY", KeySpec: "RSA_2048" } }));
    const kms = new AwsKmsCredentialEnvelope({ region: "ap-northeast-1", keyId,
      client: { send, destroy: vi.fn() } as unknown as KMSClient });
    await expect(kms.assertReady()).rejects.toThrow(/not ready/);
  });
});
