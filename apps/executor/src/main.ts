import { createServer } from "node:http";

import { WeexOAuthClient, WeexOAuthClientCredentials, type WeexOAuthTransport } from "@cryptobot-labs/weex-client";
import { AwsKmsCredentialEnvelope } from "./aws-kms";
import { assertFixedEgressIp, loadExecutorConfig } from "./config";
import { PostgresOAuthRepository } from "./oauth-repository";
import { ExecutorOAuthService } from "./oauth-service";
import { loadRuntimeEnvironment } from "./runtime-secrets";

const runtimeEnvironment = await loadRuntimeEnvironment(process.env);
const config = loadExecutorConfig(runtimeEnvironment);
const kms = new AwsKmsCredentialEnvelope({ region: config.awsRegion, keyId: config.kmsKeyId });
const repository = new PostgresOAuthRepository(config.databaseUrl);
const readiness = { kms: false, fixedEgress: false, database: false, credentialEnvelopeAdapter: true };

const transport: WeexOAuthTransport = async (input) => {
  const response = await fetch(input.url, { method: input.method, headers: input.headers, body: input.body,
    redirect: "error", signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (text.length > 65_536) throw new Error("WEEX OAuth response exceeded the size limit");
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error("WEEX OAuth returned invalid JSON"); }
  return { status: response.status, body };
};

const oauthClient = config.oauthEnabled ? new WeexOAuthClient({
  credentials: new WeexOAuthClientCredentials(config.weexClientId!, config.weexClientSecret!), transport,
}) : null;
const oauth = new ExecutorOAuthService({ repository, kms, oauthClient, clientId: config.weexClientId,
  handoffSecret: config.handoffSecret, redirectUri: config.weexOAuthRedirectUri, publicOrigin: config.publicOrigin,
  shardId: config.shardId });

await Promise.all([
  kms.assertReady().then(() => { readiness.kms = true; }),
  assertFixedEgressIp(config.expectedEgressIp).then(() => { readiness.fixedEgress = true; }),
  repository.assertReady().then(async () => {
    await repository.registerShard({ shardId: config.shardId, region: config.awsRegion,
      egressIp: config.expectedEgressIp, now: Date.now() });
    readiness.database = true;
  }),
]);

const json = (response: import("node:http").ServerResponse, status: number, body: unknown): void => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.writeHead(status).end(JSON.stringify(body));
};

const header = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const validPublicCallback = (request: import("node:http").IncomingMessage): boolean => {
  const expected = new URL(config.weexOAuthRedirectUri);
  return header(request.headers["x-forwarded-proto"]).toLowerCase() === "https"
    && header(request.headers["x-forwarded-host"]).toLowerCase() === expected.host.toLowerCase();
};

const handleRequest = async (request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse): Promise<void> => {
  if (request.method === "GET" && request.url === "/healthz") {
    json(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "GET" && request.url === "/readyz") {
    const ready = readiness.kms && readiness.fixedEgress && readiness.database && readiness.credentialEnvelopeAdapter;
    json(response, ready ? 200 : 503, { status: ready ? "ready" : "not-ready",
      checks: readiness, oauthEnabled: oauth.enabled, liveTradingEnabled: config.liveTradingEnabled });
    return;
  }
  if (request.method === "POST" && request.url === "/oauth/weex/start") {
    const authorization = header(request.headers.authorization);
    if (!authorization.startsWith("Handoff ")) { json(response, 401, { error: "unauthorized" }); return; }
    try {
      const authorizationUrl = await oauth.start(authorization.slice("Handoff ".length));
      json(response, 200, { authorizationUrl });
    } catch (error) {
      const code = error instanceof Error && "code" in error && error.code === "oauth_disabled"
        ? "oauth_unavailable" : "oauth_start_failed";
      json(response, code === "oauth_unavailable" ? 503 : 400, { error: code });
    }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/oauth/weex/callback")) {
    if (!validPublicCallback(request)) { json(response, 400, { error: "https_required" }); return; }
    const url = new URL(request.url, config.weexOAuthRedirectUri);
    const allowed = new Set(["code", "state", "error", "error_description"]);
    if (url.pathname !== "/oauth/weex/callback" || [...url.searchParams.keys()].some((key) => !allowed.has(key))) {
      json(response, 400, { error: "invalid_callback" }); return;
    }
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? undefined;
    const oauthError = url.searchParams.get("error") ?? undefined;
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(state) || (code && code.length > 2_048)
      || (oauthError && !/^[A-Za-z0-9._~-]{1,128}$/.test(oauthError))) {
      json(response, 400, { error: "invalid_callback" }); return;
    }
    const destination = await oauth.callback({ state, code, error: oauthError });
    response.setHeader("Cache-Control", "no-store");
    response.writeHead(303, { Location: destination.toString() }).end();
    return;
  }
  json(response, 404, { error: "not_found" });
};

const server = createServer((request, response) => {
  void handleRequest(request, response).catch(() => {
    if (!response.headersSent) json(response, 503, { error: "service_unavailable" });
    else response.destroy();
  });
});

server.listen(config.healthPort, "127.0.0.1");

const shutdown = (): void => {
  server.close(() => {
    kms.destroy();
    repository.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
