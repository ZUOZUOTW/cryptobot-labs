import { env } from "@/lib/server/platform-env";
import { createProductionRunHandlers, productionRunFailure } from "../../../../../lib/server/run-runtime";
import { productionLiveReady } from "../../../../../lib/server/demo-mode";

export async function POST(request:Request,context:{params:Promise<{id:string}>}):Promise<Response>{
  if (!productionLiveReady()) return Response.json({ code: "live_not_approved", message: "Live trading is disabled" }, { status: 503 });
  try{return await createProductionRunHandlers(env).unlock(request,context)}catch(error){return productionRunFailure(error)}
}
