import { createControlPlaneDatabase } from "@/db";
import { createUserRepository } from "@/db/repositories";
import { deriveWorkspaceUserId, platformIdentityProvider, requireApiUser } from "@/lib/server/auth";
import { createCloudRunRepository } from "@/lib/server/cloud-runs";
import { env } from "@/lib/server/platform-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (request.headers.get("sec-fetch-site") !== "same-origin") return Response.json({ error: "forbidden_origin" }, { status: 403 });
  const database = createControlPlaneDatabase(env.DB);
  const identity = await requireApiUser(request, { identityProvider: platformIdentityProvider,
    userRepository: createUserRepository(database), deriveUserId: deriveWorkspaceUserId, now: Date.now });
  if (!identity.ok) return identity.response;
  const body = await request.json().catch(() => null) as { state?: unknown; expectedVersion?: unknown } | null;
  const state = body?.state;
  if ((state !== "running" && state !== "paused" && state !== "stopped")
    || !Number.isSafeInteger(body?.expectedVersion)) return Response.json({ error: "invalid_request" }, { status: 400 });
  const run = await createCloudRunRepository(database).transition({ userId: identity.user.id,
    id: (await context.params).id, state, expectedVersion: body!.expectedVersion as number, now: Date.now() });
  return run ? Response.json({ run }, { headers: { "cache-control": "no-store" } })
    : Response.json({ error: "version_conflict" }, { status: 409 });
}
