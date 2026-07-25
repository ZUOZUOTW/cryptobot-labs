import { describe, expect, it, vi } from "vitest";

import { assertFixedEgressIp, loadExecutorConfig } from "../src/config";

const env = {
  EXECUTOR_SHARD_ID: "exec_abcdefghijklmnop",
  AWS_REGION: "ap-northeast-1",
  AWS_KMS_KEY_ID: "arn:aws:kms:ap-northeast-1:123456789012:key/12345678-1234-1234-1234-123456789abc",
  EXPECTED_EGRESS_IP: "203.0.113.10",
  SUPABASE_DATABASE_URL: "postgresql://user:password@example.com/postgres?sslmode=require",
  PUBLIC_ORIGIN: "https://cryptobot-labs.netlify.app",
  WEEX_CLIENT_ID: "client-id",
  WEEX_CLIENT_SECRET: "client-secret",
  WEEX_OAUTH_REDIRECT_URI: "https://api.example.com/oauth/weex/callback",
  EXECUTOR_HANDOFF_SECRET: "a-secure-handoff-secret-with-32-bytes",
  LIVE_TRADING_ENABLED: "false",
} satisfies Record<string, string>;

describe("cloud executor production gates", () => {
  it("accepts a complete fail-closed configuration", () => {
    expect(loadExecutorConfig(env)).toMatchObject({ shardId: env.EXECUTOR_SHARD_ID, liveTradingEnabled: false,
      healthPort: 8080 });
  });

  it("allows KMS-encrypted manual API credentials to enable live trading without OAuth", () => {
    const manual = Object.fromEntries(
      Object.entries(env).filter(([key]) => key !== "WEEX_CLIENT_ID" && key !== "WEEX_CLIENT_SECRET"),
    );
    expect(loadExecutorConfig({ ...manual, LIVE_TRADING_ENABLED: "true" })).toMatchObject({
      liveTradingEnabled: true,
      oauthEnabled: false,
    });
  });

  it("rejects missing KMS, insecure database, and invalid callback configuration", () => {
    expect(() => loadExecutorConfig({ ...env, AWS_KMS_KEY_ID: "alias/not-a-production-arn" })).toThrow(/KMS/);
    expect(() => loadExecutorConfig({ ...env, SUPABASE_DATABASE_URL: "postgres://u:p@example.com/db" })).toThrow(/TLS/);
    expect(() => loadExecutorConfig({ ...env, WEEX_OAUTH_REDIRECT_URI: "https://api.example.com/callback" })).toThrow(/path/);
  });

  it("refuses readiness when the observed outbound address differs", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("203.0.113.11\n", { status: 200 }));
    await expect(assertFixedEgressIp("203.0.113.10", fetcher)).rejects.toThrow(/egress/);
  });
});
