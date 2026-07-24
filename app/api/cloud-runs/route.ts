import { createControlPlaneDatabase } from "@/db";
import { createUserRepository } from "@/db/repositories";
import { createCloudRunRepository, parseCloudRisk } from "@/lib/server/cloud-runs";
import { env } from "@/lib/server/platform-env";
import { requireApiUser, platformIdentityProvider, deriveWorkspaceUserId } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const response = (status: number, body: unknown) => Response.json(body, { status,
  headers: { "cache-control": "no-store" } });
const authorize = (request: Request) => {
  const database = createControlPlaneDatabase(env.DB);
  return { database, auth: requireApiUser(request, { identityProvider: platformIdentityProvider,
    userRepository: createUserRepository(database), deriveUserId: deriveWorkspaceUserId, now: Date.now }) };
};

export async function GET(request: Request): Promise<Response> {
  const { database, auth } = authorize(request); const identity = await auth;
  if (!identity.ok) return identity.response;
  return response(200, { runs: await createCloudRunRepository(database).list(identity.user.id) });
}

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("sec-fetch-site") !== "same-origin") return response(403, { error: "forbidden_origin" });
  const { database, auth } = authorize(request); const identity = await auth;
  if (!identity.ok) return identity.response;
  let body: unknown; try { body = await request.json(); } catch { return response(400, { error: "invalid_request" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return response(400, { error: "invalid_request" });
  const value = body as Record<string, unknown>;
  const risk = parseCloudRisk(value.riskPolicy);
  if (typeof value.strategyVersionId !== "string" || typeof value.botName !== "string"
    || typeof value.configurationHash !== "string" || !risk) return response(400, { error: "invalid_request" });
  const run = await createCloudRunRepository(database).create({
    id: `crun_${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url")}`,
    userId: identity.user.id, strategyVersionId: value.strategyVersionId, name: value.botName,
    configurationHash: value.configurationHash, risk, now: Date.now(),
  });
  return run ? response(201, { run }) : response(409, { error: "cloud_run_prerequisite_failed" });
}
