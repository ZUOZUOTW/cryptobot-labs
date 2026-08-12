import { createControlPlaneDatabase } from "@/db";
import { createUserRepository } from "@/db/repositories";
import { deriveWorkspaceUserId, platformIdentityProvider, requireApiUser } from "@/lib/server/auth";
import {
  CLOUD_RUN_ORDER_IN_FLIGHT,
  CLOUD_RUN_TARGET_CONFLICT,
  createCloudRunRepository,
  isRecentLiveConfirmation,
} from "@/lib/server/cloud-runs";
import { productionLiveReady } from "@/lib/server/demo-mode";
import { env } from "@/lib/server/platform-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET_CONSTRAINT = "cloud_runs_nonterminal_target_uidx";
const STOP_ORDER_CONSTRAINT = "cloud_run_stop_order_in_flight";
const CLOUD_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const response = (status: number, body: unknown): Response => Response.json(body, { status,
  headers: { "cache-control": "no-store" } });
const databaseError = (error: unknown): { name: string; code: string; constraint: string } => {
  const candidate = error && typeof error === "object"
    ? error as { name?: unknown; code?: unknown; constraint_name?: unknown } : {};
  return {
    name: typeof candidate.name === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(candidate.name)
      ? candidate.name : "Error",
    code: typeof candidate.code === "string" && /^[A-Z0-9]{5}$/.test(candidate.code)
      ? candidate.code : "unknown",
    constraint: typeof candidate.constraint_name === "string"
      && /^[a-z0-9_]{1,80}$/.test(candidate.constraint_name) ? candidate.constraint_name : "unknown",
  };
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const database = createControlPlaneDatabase(env.DB);
  const identity = await requireApiUser(request, { identityProvider: platformIdentityProvider,
    userRepository: createUserRepository(database), deriveUserId: deriveWorkspaceUserId, now: Date.now });
  if (!identity.ok) return identity.response;
  const id = (await context.params).id;
  if (!CLOUD_RUN_ID.test(id)) return response(400, { error: "invalid_request" });
  try {
    const orders = await createCloudRunRepository(database).orders(identity.user.id, id, 20);
    return response(200, { generatedAt: Date.now(), orders });
  } catch (error) {
    console.error("[cloud-runs] order evidence read failed", databaseError(error));
    return response(503, { error: "cloud_run_order_evidence_unavailable" });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (request.headers.get("sec-fetch-site") !== "same-origin") return Response.json({ error: "forbidden_origin" }, { status: 403 });
  const database = createControlPlaneDatabase(env.DB);
  const identity = await requireApiUser(request, { identityProvider: platformIdentityProvider,
    userRepository: createUserRepository(database), deriveUserId: deriveWorkspaceUserId, now: Date.now });
  if (!identity.ok) return identity.response;
  const body = await request.json().catch(() => null) as {
    state?: unknown; expectedVersion?: unknown; liveConfirmation?: unknown;
  } | null;
  const state = body?.state;
  if ((state !== "running" && state !== "paused" && state !== "stopped")
    || !Number.isSafeInteger(body?.expectedVersion)) return Response.json({ error: "invalid_request" }, { status: 400 });
  const repository = createCloudRunRepository(database);
  const id = (await context.params).id;
  const now = Date.now();
  try {
    let allowLiveResume = false;
    if (state === "running") {
      const mode = await repository.modeForUser({ userId: identity.user.id, id });
      if (mode === "live") {
        if (!productionLiveReady()) return response(503, { error: "live_trading_disabled" });
        if (!isRecentLiveConfirmation(body?.liveConfirmation, now)) {
          return response(400, { error: "live_confirmation_required" });
        }
        allowLiveResume = true;
      } else if (body?.liveConfirmation !== undefined) {
        return response(400, { error: "invalid_request" });
      }
    }
    const run = await repository.transition({ userId: identity.user.id,
      id, state, expectedVersion: body!.expectedVersion as number, allowLiveResume, now });
    if (run) return response(200, { run });
    if (state === "running" && await repository.hasTransitionTargetConflict({ userId: identity.user.id, id })) {
      return response(409, CLOUD_RUN_TARGET_CONFLICT);
    }
    return response(409, { error: "version_conflict" });
  } catch (error) {
    const safe = databaseError(error);
    if (safe.code === "23514" && safe.constraint === STOP_ORDER_CONSTRAINT) {
      return response(409, CLOUD_RUN_ORDER_IN_FLIGHT);
    }
    console.error("[cloud-runs] transition failed", safe);
    return safe.code === "23505" && safe.constraint === TARGET_CONSTRAINT
      ? response(409, CLOUD_RUN_TARGET_CONFLICT)
      : response(503, { error: "cloud_run_service_unavailable" });
  }
}
