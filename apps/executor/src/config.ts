import { isWeexBrokerId } from "@cryptobot-labs/trading-core";
import {
  parseWeexAuthStage,
  weexAuthCapabilities,
  type WeexAuthStage,
} from "@cryptobot-labs/weex-client";

const SHARD = /^exec_[A-Za-z0-9_-]{16,64}$/;
const AWS_REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
const KMS_ARN = /^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[0-9a-f-]{36}$/i;
const IP = /^(?:\d{1,3}\.){3}\d{1,3}$/;
export type ExecutorEnvironment = Readonly<Record<string, string | undefined>>;

export interface ExecutorConfig {
  readonly shardId: string;
  readonly awsRegion: string;
  readonly kmsKeyId: string;
  readonly expectedEgressIp: string;
  readonly healthPort: number;
  readonly publicOrigin: string;
  readonly databaseUrl: string;
  readonly weexClientId: string | null;
  readonly weexClientSecret: string | null;
  readonly weexBrokerId: string;
  readonly weexOAuthRedirectUri: string;
  readonly handoffSecret: string;
  readonly authStage: WeexAuthStage;
  readonly manualConnectionsEnabled: boolean;
  readonly oauthEnabled: boolean;
  readonly liveTradingEnabled: boolean;
  readonly accountConcurrency: number;
  readonly strategyConcurrency: number;
  readonly tickIntervalMs: number;
}

function required(env: ExecutorEnvironment, name: string, maximum = 4_096): string {
  const value = env[name];
  if (!value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${name} is required`);
  return value;
}

function https(value: string, name: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw new Error(`${name} must be HTTPS`);
  return url.toString().replace(/\/$/, "");
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const parsed = Number(value ?? String(fallback));
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return parsed;
}

export function loadExecutorConfig(env: ExecutorEnvironment): ExecutorConfig {
  const shardId = required(env, "EXECUTOR_SHARD_ID", 80);
  const awsRegion = required(env, "AWS_REGION", 64);
  const kmsKeyId = required(env, "AWS_KMS_KEY_ID", 256);
  const expectedEgressIp = required(env, "EXPECTED_EGRESS_IP", 64);
  const healthPort = Number(env.HEALTH_PORT ?? "8080");
  if (!SHARD.test(shardId)) throw new Error("EXECUTOR_SHARD_ID is invalid");
  if (!AWS_REGION.test(awsRegion)) throw new Error("AWS_REGION is invalid");
  if (!KMS_ARN.test(kmsKeyId)) throw new Error("AWS_KMS_KEY_ID must be a KMS key ARN");
  if (!IP.test(expectedEgressIp) || expectedEgressIp.split(".").some((part) => Number(part) > 255)) {
    throw new Error("EXPECTED_EGRESS_IP must be an IPv4 address");
  }
  if (!Number.isSafeInteger(healthPort) || healthPort < 1_024 || healthPort > 65_535) throw new Error("HEALTH_PORT is invalid");
  const databaseUrl = required(env, "SUPABASE_DATABASE_URL", 8_192);
  const database = new URL(databaseUrl);
  if (!/^postgres(?:ql)?:$/.test(database.protocol) || database.searchParams.get("sslmode") !== "require") {
    throw new Error("SUPABASE_DATABASE_URL must require TLS");
  }
  const publicOrigin = https(required(env, "PUBLIC_ORIGIN", 2_048), "PUBLIC_ORIGIN");
  const weexOAuthRedirectUri = https(required(env, "WEEX_OAUTH_REDIRECT_URI", 2_048), "WEEX_OAUTH_REDIRECT_URI");
  if (!new URL(weexOAuthRedirectUri).pathname.endsWith("/oauth/weex/callback")) {
    throw new Error("WEEX_OAUTH_REDIRECT_URI path is invalid");
  }
  const liveTradingEnabled = env.LIVE_TRADING_ENABLED === "true";
  if (env.LIVE_TRADING_ENABLED && !["true", "false"].includes(env.LIVE_TRADING_ENABLED)) {
    throw new Error("LIVE_TRADING_ENABLED must be true or false");
  }
  const handoffSecret = required(env, "EXECUTOR_HANDOFF_SECRET", 512);
  if (handoffSecret.length < 32) throw new Error("EXECUTOR_HANDOFF_SECRET must contain at least 32 characters");
  const weexBrokerId = required(env, "WEEX_BROKER_ID", 32);
  if (!isWeexBrokerId(weexBrokerId)) {
    throw new Error("WEEX_BROKER_ID must use the WEEX plus six digits format");
  }
  const weexClientId = env.WEEX_CLIENT_ID?.trim() || null;
  const weexClientSecret = env.WEEX_CLIENT_SECRET || null;
  if ((weexClientId === null) !== (weexClientSecret === null)) {
    throw new Error("WEEX_CLIENT_ID and WEEX_CLIENT_SECRET must be configured together");
  }
  if (weexClientId !== null) required({ WEEX_CLIENT_ID: weexClientId }, "WEEX_CLIENT_ID", 256);
  if (weexClientSecret !== null) required({ WEEX_CLIENT_SECRET: weexClientSecret }, "WEEX_CLIENT_SECRET", 512);
  const authStage = parseWeexAuthStage(env.WEEX_AUTH_STAGE);
  const capabilities = weexAuthCapabilities(authStage);
  const manualConnectionsEnabled = capabilities.manualApiConnection;
  const oauthEnabled = capabilities.oauthConnection && weexClientId !== null && weexClientSecret !== null;
  const accountConcurrency = boundedInteger(env.EXECUTOR_ACCOUNT_CONCURRENCY, 4, 1, 16,
    "EXECUTOR_ACCOUNT_CONCURRENCY");
  const strategyConcurrency = boundedInteger(env.EXECUTOR_STRATEGY_CONCURRENCY, 8, 1, 32,
    "EXECUTOR_STRATEGY_CONCURRENCY");
  const tickIntervalMs = boundedInteger(env.EXECUTOR_TICK_INTERVAL_MS, 2_000, 500, 60_000,
    "EXECUTOR_TICK_INTERVAL_MS");
  return Object.freeze({ shardId, awsRegion, kmsKeyId, expectedEgressIp, healthPort, publicOrigin, databaseUrl,
    weexClientId, weexClientSecret, weexBrokerId, weexOAuthRedirectUri, handoffSecret, authStage,
    manualConnectionsEnabled, oauthEnabled, liveTradingEnabled,
    accountConcurrency, strategyConcurrency, tickIntervalMs });
}

export async function assertFixedEgressIp(expected: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("https://checkip.amazonaws.com", { headers: { Accept: "text/plain" },
    signal: AbortSignal.timeout(5_000) });
  const observed = (await response.text()).trim();
  if (!response.ok || observed !== expected) throw new Error("Fixed egress IP verification failed");
}
