import { GetSecretValueCommand, type SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";

import { loadRuntimeEnvironment } from "../src/runtime-secrets";

describe("AWS Secrets Manager runtime configuration", () => {
  it("loads only allow-listed strings from AWSCURRENT without writing a local secret file", async () => {
    const destroy = vi.fn();
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(GetSecretValueCommand);
      expect((command as GetSecretValueCommand).input).toEqual({ SecretId: "runtime-secret", VersionStage: "AWSCURRENT" });
      return { SecretString: JSON.stringify({ PUBLIC_ORIGIN: "https://www.example.test", LIVE_TRADING_ENABLED: "false" }) };
    });
    const result = await loadRuntimeEnvironment({ AWS_REGION: "ap-northeast-1", EXECUTOR_SECRET_ID: "runtime-secret" },
      () => ({ send, destroy }) as unknown as SecretsManagerClient);
    expect(result).toMatchObject({ AWS_REGION: "ap-northeast-1", PUBLIC_ORIGIN: "https://www.example.test" });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("rejects unknown keys so a secret cannot silently change the process boundary", async () => {
    const client = { send: vi.fn(async () => ({ SecretString: JSON.stringify({ NODE_OPTIONS: "--inspect" }) })),
      destroy: vi.fn() } as unknown as SecretsManagerClient;
    await expect(loadRuntimeEnvironment({ AWS_REGION: "ap-northeast-1", EXECUTOR_SECRET_ID: "runtime-secret" },
      () => client)).rejects.toThrow(/unsupported/);
  });

  it("does not include malformed secret content in the error", async () => {
    const sensitiveValue = "must-never-reach-journald";
    const client = { send: vi.fn(async () => ({ SecretString: `{\"EXECUTOR_HANDOFF_SECRET\":\"${sensitiveValue}\"} trailing` })),
      destroy: vi.fn() } as unknown as SecretsManagerClient;

    let message = "";
    try {
      await loadRuntimeEnvironment({ AWS_REGION: "ap-northeast-1", EXECUTOR_SECRET_ID: "runtime-secret" },
        () => client);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("Executor runtime secret is not valid JSON");
    expect(message).not.toContain(sensitiveValue);
  });
});
