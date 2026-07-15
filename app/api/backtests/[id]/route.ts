import { env } from "@/lib/server/platform-env";
import {
  createProductionTradingHandlers,
  productionTradingFailure,
  tradingEnvironmentForRequest,
} from "../../../../lib/server/backtest-runtime";

interface Context { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const params = await context.params;
    return await createProductionTradingHandlers(tradingEnvironmentForRequest(env, request)).backtests.get(request, params.id);
  } catch (error) { return productionTradingFailure(error); }
}
