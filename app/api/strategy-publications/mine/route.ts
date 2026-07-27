import { createControlPlaneDatabase } from "@/db";
import { createStrategyPublicationRepository, createUserRepository } from "@/db/repositories";
import { deriveWorkspaceUserId, platformIdentityProvider, requireApiUser } from "@/lib/server/auth";
import { env } from "@/lib/server/platform-env";
import { toPublicStrategyPublication } from "@/lib/server/strategy-publications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const database = createControlPlaneDatabase(env.DB);
    const identity = await requireApiUser(request, {
      identityProvider: platformIdentityProvider,
      userRepository: createUserRepository(database),
      deriveUserId: deriveWorkspaceUserId,
      now: Date.now,
    });
    if (!identity.ok) return identity.response;
    const records = await createStrategyPublicationRepository(database).listByUser(identity.user.id, 100);
    const publications = records.flatMap((record) => {
      try { return [toPublicStrategyPublication(record)]; }
      catch (error) {
        console.error("[strategy-publications] skipped invalid owned record", {
          slug: record.slug,
          name: error instanceof Error ? error.name : "Error",
        });
        return [];
      }
    });
    return Response.json({ publications }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[strategy-publications] owned list failed", {
      name: error instanceof Error ? error.name : "Error",
    });
    return Response.json({ error: "publication_service_unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
