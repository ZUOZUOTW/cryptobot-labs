import { env } from "@/lib/server/platform-env";
import { createProductionRunHandlers, productionRunFailure } from "../../../lib/server/run-runtime";

export async function GET(request:Request):Promise<Response>{try{return await createProductionRunHandlers(env).list(request)}catch(error){return productionRunFailure(error)}}
export async function POST(request:Request):Promise<Response>{try{return await createProductionRunHandlers(env).post(request)}catch(error){return productionRunFailure(error)}}
