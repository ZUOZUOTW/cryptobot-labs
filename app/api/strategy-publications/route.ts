import { createControlPlaneDatabase } from "@/db";
import {
  createStrategyPublicationRepository,
} from "@/db/repositories";
import { env } from "@/lib/server/platform-env";
import {
  servePublicStrategyPublicationList,
} from "@/lib/server/strategy-publications";
import { serveProductionStrategyPublicationRoute } from "@/lib/server/strategy-publication-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const database = () => createControlPlaneDatabase(env.DB);

export async function GET(request: Request): Promise<Response> {
  try {
    return await servePublicStrategyPublicationList(request, createStrategyPublicationRepository(database()));
  } catch (error) {
    console.error("[strategy-publications] public list initialization failed", {
      name: error instanceof Error ? error.name : "Error",
    });
    return Response.json({ error: "publication_service_unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  return serveProductionStrategyPublicationRoute((handlers) => handlers.post(request));
}
