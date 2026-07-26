import { createServer } from "node:http";

import {
  WeexApiError,
  WeexOAuthClient,
  WeexOAuthClientCredentials,
  type WeexOAuthTransport,
} from "@cryptobot-labs/weex-client";
import { AwsKmsCredentialEnvelope } from "./aws-kms";
import { assertFixedEgressIp, loadExecutorConfig } from "./config";
import { PostgresOAuthRepository } from "./oauth-repository";
import { ExecutorOAuthService } from "./oauth-service";
import { ManualWeexConnectionService, manualConnectionFailureReason } from "./manual-connection-service";
import { loadRuntimeEnvironment } from "./runtime-secrets";
import { CloudRuntimeRepository } from "./cloud-repository";
import { CloudStrategyRuntime } from "./cloud-runtime";
import { executorRuntimeMetadata } from "./runtime-metadata";

const runtimeMetadata = executorRuntimeMetadata(process.env, Date.now());
const runtimeEnvironment = await loadRuntimeEnvironment(process.env);
const config = loadExecutorConfig(runtimeEnvironment);
const kms = new AwsKmsCredentialEnvelope({ region: config.awsRegion, keyId: config.kmsKeyId });
const repository = new PostgresOAuthRepository(config.databaseUrl);
const cloudRepository = new CloudRuntimeRepository(config.databaseUrl, config.shardId);
const readiness = { kms: false, fixedEgress: false, database: false, cloudRuntime: false, credentialEnvelopeAdapter: true };

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
const manualConnection = new ManualWeexConnectionService({ repository, kms,
  handoffSecret: config.handoffSecret, shardId: config.shardId,
  liveTradingEnabled: config.liveTradingEnabled });

await Promise.all([
  kms.assertReady().then(() => { readiness.kms = true; }),
  assertFixedEgressIp(config.expectedEgressIp).then(() => { readiness.fixedEgress = true; }),
  repository.assertReady().then(async () => {
    await repository.registerShard({ shardId: config.shardId, region: config.awsRegion,
      egressIp: config.expectedEgressIp, now: Date.now() });
    readiness.database = true;
  }),
  cloudRepository.assertReady().then(() => { readiness.cloudRuntime = true; }),
]);

const cloudRuntime = new CloudStrategyRuntime({ repository: cloudRepository, kms,
  liveTradingEnabled: config.liveTradingEnabled,
  accountConcurrency: config.accountConcurrency,
  strategyConcurrency: config.strategyConcurrency,
  tickIntervalMs: config.tickIntervalMs });
cloudRuntime.start();

const json = (response: import("node:http").ServerResponse, status: number, body: unknown): void => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.writeHead(status).end(JSON.stringify(body));
};

const header = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const readJson = async (request: import("node:http").IncomingMessage): Promise<unknown> => {
  const declared = Number(header(request.headers["content-length"]) || "0");
  if (!Number.isSafeInteger(declared) || declared < 1 || declared > 4_096
    || !header(request.headers["content-type"]).toLowerCase().startsWith("application/json")) {
    throw new Error("invalid_request");
  }
  const chunks: Buffer[] = []; let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > 4_096) throw new Error("invalid_request");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};
const validPublicCallback = (request: import("node:http").IncomingMessage): boolean => {
  const expected = new URL(config.weexOAuthRedirectUri);
  return header(request.headers["x-forwarded-proto"]).toLowerCase() === "https"
    && header(request.headers["x-forwarded-host"]).toLowerCase() === expected.host.toLowerCase();
};

const handleRequest = async (request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse): Promise<void> => {
  if (request.method === "GET" && request.url === "/healthz") {
    json(response, 200, { status: "ok", ...runtimeMetadata });
    return;
  }
  if (request.method === "GET" && request.url === "/readyz") {
    const ready = readiness.kms && readiness.fixedEgress && readiness.database && readiness.cloudRuntime
      && readiness.credentialEnvelopeAdapter;
    json(response, ready ? 200 : 503, { status: ready ? "ready" : "not-ready", ...runtimeMetadata,
      checks: readiness, oauthEnabled: oauth.enabled, liveTradingEnabled: config.liveTradingEnabled,
      runtime: cloudRuntime.snapshot() });
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
  if (request.method === "POST" && request.url === "/connections/weex/manual") {
    const authorization = header(request.headers.authorization);
    if (!authorization.startsWith("Handoff ")) { json(response, 401, { error: "unauthorized" }); return; }
    try {
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).sort().join(",") !== "apiKey,passphrase,secretKey") throw new Error("invalid_request");
      const value = body as Record<string, unknown>;
      for (const key of ["apiKey", "secretKey", "passphrase"]) {
        const secret = value[key];
        if (typeof secret !== "string" || secret.length < 1 || secret.length > 256
          || /[\u0000-\u001f\u007f]/.test(secret)) throw new Error("invalid_request");
      }
      const result = await manualConnection.connect(authorization.slice("Handoff ".length), value as {
        apiKey: string; secretKey: string; passphrase: string;
      });
      json(response, 200, result);
    } catch (error) {
      const reason = manualConnectionFailureReason(error);
      console.warn(JSON.stringify({
        event: "manual_weex_connection_failed",
        reason,
        error: error instanceof WeexApiError
          ? {
              name: error.name,
              category: error.category,
              code: error.code ?? null,
              status: error.status ?? null,
              message: error.message,
            }
          : {
              name: error instanceof Error ? error.name : typeof error,
              message: error instanceof Error ? error.message : "non_error_failure",
            },
      }));
      json(response, 400, {
        error: "connection_verification_failed",
        reason,
      });
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
  cloudRuntime.stop();
  server.close(() => {
    kms.destroy();
    Promise.all([repository.close(), cloudRepository.close()]).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
