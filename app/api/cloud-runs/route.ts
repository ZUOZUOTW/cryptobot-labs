import { createControlPlaneDatabase } from "@/db";
import { createUserRepository } from "@/db/repositories";
import {
  CLOUD_RUN_TARGET_CONFLICT,
  createCloudRunRepository,
  isRecentLiveConfirmation,
  parseCloudRisk,
  type CloudRunMode,
} from "@/lib/server/cloud-runs";
import { productionLiveReady } from "@/lib/server/demo-mode";
import { env } from "@/lib/server/platform-env";
import { requireApiUser, platformIdentityProvider, deriveWorkspaceUserId } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const response = (status: number, body: unknown) => Response.json(body, { status,
  headers: { "cache-control": "no-store" } });
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const runId = async (userId: string, key: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}\u0000${key}`));
  return `crun_${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 48)}`;
};
const authorize = (request: Request) => {
  const database = createControlPlaneDatabase(env.DB);
  return { database, auth: requireApiUser(request, { identityProvider: platformIdentityProvider,
    userRepository: createUserRepository(database), deriveUserId: deriveWorkspaceUserId, now: Date.now }) };
};

export async function GET(request: Request): Promise<Response> {
  const { database, auth } = authorize(request); const identity = await auth;
  if (!identity.ok) return identity.response;
  const repository = createCloudRunRepository(database);
  const [runs, account] = await Promise.all([
    repository.list(identity.user.id),
    repository.account(identity.user.id),
  ]);
  const realizedPnl = account ? await repository.realizedPnl(identity.user.id, account.connectionId)
    : { total: "0", tradeCount: 0, points: [] };
  return response(200, {
    generatedAt: Date.now(),
    runs,
    account: account ? {
      connectionStatus: account.connectionStatus,
      syncStatus: account.syncStatus,
      accountUid: account.accountUid,
      observedAt: account.observedAt,
      balancesJson: account.balancesJson,
      positionsJson: account.positionsJson,
      accountEquity: account.accountEquity,
      availableEquity: account.availableEquity,
      unrealizedPnl: account.unrealizedPnl,
      lastErrorCode: account.lastErrorCode,
      permissions: typeof account.permissionsJson === "string"
        ? JSON.parse(account.permissionsJson) as unknown : account.permissionsJson,
      withdrawalAccessAbsent: account.withdrawalAccessAbsent,
    } : null,
    realizedPnl: {
      asset: "USDT",
      total: realizedPnl.total,
      tradeCount: realizedPnl.tradeCount,
      points: realizedPnl.points,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("sec-fetch-site") !== "same-origin") return response(403, { error: "forbidden_origin" });
  const key = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(key)) return response(400, { error: "invalid_request" });
  const { database, auth } = authorize(request); const identity = await auth;
  if (!identity.ok) return identity.response;
  let body: unknown; try { body = await request.json(); } catch { return response(400, { error: "invalid_request" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return response(400, { error: "invalid_request" });
  const value = body as Record<string, unknown>;
  const risk = parseCloudRisk(value.riskPolicy);
  const now = Date.now();
  const mode: CloudRunMode | null = value.mode === "futures-demo" || value.mode === "live" ? value.mode : null;
  if (typeof value.strategyVersionId !== "string" || typeof value.botName !== "string"
    || typeof value.configurationHash !== "string" || !mode || !risk) {
    return response(400, { error: "invalid_request" });
  }
  if (mode === "live" && (!productionLiveReady() || !isRecentLiveConfirmation(value.liveConfirmation, now))) {
    return response(503, { error: "live_trading_disabled" });
  }
  if (mode === "futures-demo" && value.liveConfirmation !== undefined) {
    return response(400, { error: "invalid_request" });
  }
  const repository = createCloudRunRepository(database);
  const input = {
    id: await runId(identity.user.id, key),
    userId: identity.user.id, strategyVersionId: value.strategyVersionId, name: value.botName,
    configurationHash: value.configurationHash, mode, risk, now,
  };
  let run;
  try {
    run = await repository.create(input);
  } catch (error) {
    const candidate = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; constraint_name?: unknown } : {};
    console.error("[cloud-runs] creation failed", {
      name: typeof candidate.name === "string" ? candidate.name.slice(0, 80) : "Error",
      code: typeof candidate.code === "string" && /^[A-Z0-9]{5}$/.test(candidate.code) ? candidate.code : "unknown",
      constraint: typeof candidate.constraint_name === "string" && /^[a-z0-9_]{1,80}$/.test(candidate.constraint_name)
        ? candidate.constraint_name : "unknown",
    });
    return response(503, { error: "cloud_run_service_unavailable" });
  }
  if (run) return response(201, { run, idempotent: false });
  const replay = await repository.findMatching(input);
  if (replay) return response(200, { run: replay, idempotent: true });
  if (await repository.hasActiveTargetConflict(input)) return response(409, CLOUD_RUN_TARGET_CONFLICT);
  return response(409, { error: "cloud_run_prerequisite_failed" });
}
