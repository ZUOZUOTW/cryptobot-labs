import { createControlPlaneDatabase } from "@/db";
import { createStrategyPublicationRepository } from "@/db/repositories";
import { env } from "@/lib/server/platform-env";
import {
  publicStrategyFreshnessHeaders,
  toPublicStrategyPublication,
} from "@/lib/server/strategy-publications";
import { serveProductionStrategyPublicationRoute } from "@/lib/server/strategy-publication-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug } = await context.params;
    const record = await createStrategyPublicationRepository(createControlPlaneDatabase(env.DB)).getBySlug(slug);
    if (!record) {
      return Response.json({ error: "not_found" }, {
        status: 404,
        headers: publicStrategyFreshnessHeaders,
      });
    }
    let publication;
    try {
      publication = toPublicStrategyPublication(record);
    } catch (error) {
      console.error("[strategy-publication] blocked invalid public record", {
        slug,
        name: error instanceof Error ? error.name : "Error",
      });
      return Response.json({ error: "not_found" }, {
        status: 404,
        headers: publicStrategyFreshnessHeaders,
      });
    }
    return Response.json({ publication }, {
      headers: publicStrategyFreshnessHeaders,
    });
  } catch (error) {
    console.error("[strategy-publication] detail failed", {
      name: error instanceof Error ? error.name : "Error",
    });
    return Response.json({ error: "publication_service_unavailable" }, {
      status: 503,
      headers: publicStrategyFreshnessHeaders,
    });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return serveProductionStrategyPublicationRoute((handlers) => handlers.patch(request, context));
}
