import { env } from "@/lib/server/platform-env";
import { createProductionRunHandlers, productionRunFailure } from "../../../../lib/server/run-runtime";

export async function GET(request:Request,context:{params:Promise<{id:string}>}):Promise<Response>{try{return await createProductionRunHandlers(env).get(request,context)}catch(error){return productionRunFailure(error)}}
