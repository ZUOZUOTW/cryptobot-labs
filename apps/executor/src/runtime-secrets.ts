import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { ExecutorEnvironment } from "./config";

const ALLOWED = new Set([
  "AWS_KMS_KEY_ID", "EXECUTOR_HANDOFF_SECRET", "EXECUTOR_SHARD_ID", "EXPECTED_EGRESS_IP", "HEALTH_PORT",
  "LIVE_TRADING_ENABLED", "PUBLIC_ORIGIN", "SUPABASE_DATABASE_URL", "WEEX_CLIENT_ID", "WEEX_CLIENT_SECRET",
  "WEEX_AUTH_STAGE", "WEEX_BROKER_ID", "WEEX_OAUTH_REDIRECT_URI",
]);

export async function loadRuntimeEnvironment(environment: ExecutorEnvironment,
  clientFactory: (region: string) => SecretsManagerClient = (region) => new SecretsManagerClient({ region })):
  Promise<ExecutorEnvironment> {
  const secretId = environment.EXECUTOR_SECRET_ID;
  if (!secretId) return environment;
  const region = environment.AWS_REGION;
  if (!region || secretId.length > 512 || /[\u0000-\u001f\u007f]/.test(secretId)) throw new Error("Executor secret configuration is invalid");
  const client = clientFactory(region);
  try {
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId, VersionStage: "AWSCURRENT" }));
    if (!response.SecretString || response.SecretString.length > 65_536) throw new Error("Executor runtime secret is unavailable");
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.SecretString);
    } catch {
      // Node's native JSON SyntaxError includes the source line. Never allow a
      // malformed production secret to be copied into journald or SSM output.
      throw new Error("Executor runtime secret is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Executor runtime secret is invalid");
    const values = parsed as Record<string, unknown>;
    if (Object.keys(values).some((key) => !ALLOWED.has(key))
      || Object.values(values).some((value) => typeof value !== "string")) {
      throw new Error("Executor runtime secret contains unsupported values");
    }
    return Object.freeze({ ...environment, ...(values as Record<string, string>) });
  } finally { client.destroy(); }
}
