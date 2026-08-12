import { serveProductionStrategyPublicationRoute } from "@/lib/server/strategy-publication-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return serveProductionStrategyPublicationRoute((handlers) => handlers.mine(request));
}
