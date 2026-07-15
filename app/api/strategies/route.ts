import { env } from "@/lib/server/platform-env";
import {
  createProductionTradingHandlers,
  productionTradingFailure,
  tradingEnvironmentForRequest,
} from "../../../lib/server/backtest-runtime";

export async function POST(request: Request): Promise<Response> {
  try { return await createProductionTradingHandlers(tradingEnvironmentForRequest(env, request)).strategy(request); }
  catch (error) { return productionTradingFailure(error); }
}
