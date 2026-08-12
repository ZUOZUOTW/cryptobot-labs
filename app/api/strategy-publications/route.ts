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
  return servePublicStrategyPublicationList(request, createStrategyPublicationRepository(database()));
}

export async function POST(request: Request): Promise<Response> {
  return serveProductionStrategyPublicationRoute((handlers) => handlers.post(request));
}
