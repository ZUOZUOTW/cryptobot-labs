import { createControlPlaneDatabase } from "@/db";
import { createStrategyPublicationRepository } from "@/db/repositories";
import { env } from "@/lib/server/platform-env";
import { toPublicStrategyPublication } from "@/lib/server/strategy-publications";

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
        headers: { "cache-control": "public, max-age=30, s-maxage=60" },
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
        headers: { "cache-control": "public, max-age=30, s-maxage=60" },
      });
    }
    return Response.json({ publication }, {
      headers: {
        "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    console.error("[strategy-publication] detail failed", {
      name: error instanceof Error ? error.name : "Error",
    });
    return Response.json({ error: "publication_service_unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
