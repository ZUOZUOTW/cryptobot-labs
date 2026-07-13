import { env } from "@/lib/server/platform-env";
import { createProductionTradingHandlers, productionTradingFailure } from "../../../lib/server/backtest-runtime";

export async function POST(request: Request): Promise<Response> {
  try { return await createProductionTradingHandlers(env).strategy(request); }
  catch (error) { return productionTradingFailure(error); }
}
