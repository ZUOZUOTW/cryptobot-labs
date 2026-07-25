import { env } from "@/lib/server/platform-env";
import { createProductionConnectionHandlers, productionConnectionFailure } from "../../../lib/server/connection-runtime";

export async function GET(request: Request): Promise<Response> {
  try{return await createProductionConnectionHandlers(env).list(request);}
  catch(error){return productionConnectionFailure(error);}
}
