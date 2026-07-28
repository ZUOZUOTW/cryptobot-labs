import { describe, expect, it, vi } from "vitest";

import { assertFixedEgressIp, loadExecutorConfig } from "../src/config";

const env = {
  EXECUTOR_SHARD_ID: "exec_abcdefghijklmnop",
  AWS_REGION: "ap-northeast-1",
  AWS_KMS_KEY_ID: "arn:aws:kms:ap-northeast-1:123456789012:key/12345678-1234-1234-1234-123456789abc",
  EXPECTED_EGRESS_IP: "203.0.113.10",
  SUPABASE_DATABASE_URL: "postgresql://user:password@example.com/postgres?sslmode=require",
  PUBLIC_ORIGIN: "https://cryptobot-labs.netlify.app",
  WEEX_BROKER_ID: "WEEX111162",
  WEEX_CLIENT_ID: "client-id",
  WEEX_CLIENT_SECRET: "client-secret",
  WEEX_OAUTH_REDIRECT_URI: "https://api.example.com/oauth/weex/callback",
  EXECUTOR_HANDOFF_SECRET: "a-secure-handoff-secret-with-32-bytes",
  LIVE_TRADING_ENABLED: "false",
  WEEX_AUTH_STAGE: "transition",
} satisfies Record<string, string>;

describe("cloud executor production gates", () => {
  it("accepts a complete fail-closed configuration", () => {
    expect(loadExecutorConfig(env)).toMatchObject({ shardId: env.EXECUTOR_SHARD_ID, liveTradingEnabled: false,
      weexBrokerId: "WEEX111162", healthPort: 8080, accountConcurrency: 4,
      strategyConcurrency: 8, tickIntervalMs: 2_000, authStage: "transition",
      manualConnectionsEnabled: true, oauthEnabled: false });
  });

  it("bounds worker concurrency and scheduler cadence", () => {
    expect(() => loadExecutorConfig({ ...env, EXECUTOR_STRATEGY_CONCURRENCY: "33" }))
      .toThrow(/STRATEGY_CONCURRENCY/);
    expect(() => loadExecutorConfig({ ...env, EXECUTOR_ACCOUNT_CONCURRENCY: "0" }))
      .toThrow(/ACCOUNT_CONCURRENCY/);
    expect(() => loadExecutorConfig({ ...env, EXECUTOR_TICK_INTERVAL_MS: "100" }))
      .toThrow(/TICK_INTERVAL/);
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

  it("enables OAuth only in an approved rollout stage and disables manual input in OAuth-only mode", () => {
    expect(loadExecutorConfig({ ...env, WEEX_AUTH_STAGE: "dual" })).toMatchObject({
      authStage: "dual",
      manualConnectionsEnabled: true,
      oauthEnabled: true,
    });
    expect(loadExecutorConfig({ ...env, WEEX_AUTH_STAGE: "oauth-only" })).toMatchObject({
      authStage: "oauth-only",
      manualConnectionsEnabled: false,
      oauthEnabled: true,
    });
    expect(() => loadExecutorConfig({ ...env, WEEX_AUTH_STAGE: "oauth" })).toThrow(/WEEX_AUTH_STAGE/);
  });

  it("rejects missing KMS, insecure database, and invalid callback configuration", () => {
    expect(() => loadExecutorConfig({ ...env, AWS_KMS_KEY_ID: "alias/not-a-production-arn" })).toThrow(/KMS/);
    expect(() => loadExecutorConfig({ ...env, SUPABASE_DATABASE_URL: "postgres://u:p@example.com/db" })).toThrow(/TLS/);
    expect(() => loadExecutorConfig({ ...env, WEEX_OAUTH_REDIRECT_URI: "https://api.example.com/callback" })).toThrow(/path/);
  });

  it("requires the assigned WEEX broker id even while live trading is disabled", () => {
    const withoutBroker = Object.fromEntries(
      Object.entries(env).filter(([key]) => key !== "WEEX_BROKER_ID"),
    );
    expect(() => loadExecutorConfig(withoutBroker)).toThrow(/WEEX_BROKER_ID/);
    expect(() => loadExecutorConfig({ ...env, WEEX_BROKER_ID: "weex111162" })).toThrow(/WEEX_BROKER_ID/);
    expect(() => loadExecutorConfig({ ...env, WEEX_BROKER_ID: "WEEX1111620" })).toThrow(/WEEX_BROKER_ID/);
  });

  it("refuses readiness when the observed outbound address differs", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("203.0.113.11\n", { status: 200 }));
    await expect(assertFixedEgressIp("203.0.113.10", fetcher)).rejects.toThrow(/egress/);
  });
});
