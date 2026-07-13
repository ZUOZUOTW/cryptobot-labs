import { env } from "@/lib/server/platform-env";
import { createProductionActivityHandlers, productionActivityFailure } from "../../../../lib/server/activity-runtime";

export async function GET(request: Request): Promise<Response> {
  try { return await createProductionActivityHandlers(env).export(request); }
  catch (error) { return productionActivityFailure(error); }
}
