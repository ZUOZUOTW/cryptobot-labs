import { env } from "@/lib/server/platform-env";
import { createProductionRunHandlers, productionRunFailure } from "../../../../../lib/server/run-runtime";
import { productionLiveReady } from "../../../../../lib/server/demo-mode";

export async function POST(request:Request,context:{params:Promise<{id:string}>}):Promise<Response>{
  try {
    const input = await request.clone().json() as { type?: unknown };
    if (input.type === "resume-live" && !productionLiveReady()) return Response.json({ code: "live_not_approved", message: "Live trading is disabled" }, { status: 503 });
  } catch { /* The command handler owns normal request validation. */ }
  try{return await createProductionRunHandlers(env).command(request,context)}catch(error){return productionRunFailure(error)}
}
