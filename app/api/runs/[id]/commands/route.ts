import { env } from "@/lib/server/platform-env";
import { createProductionRunHandlers, productionRunFailure } from "../../../../../lib/server/run-runtime";

export async function POST(request:Request,context:{params:Promise<{id:string}>}):Promise<Response>{try{return await createProductionRunHandlers(env).command(request,context)}catch(error){return productionRunFailure(error)}}
