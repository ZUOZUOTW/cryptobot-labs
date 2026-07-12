import { env } from "cloudflare:workers";
import { createProductionTradingHandlers, productionTradingFailure } from "../../../../lib/server/backtest-runtime";

interface Context { params: { id: string } | Promise<{ id: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const params = await context.params;
    return await createProductionTradingHandlers(env).backtests.get(request, params.id);
  } catch (error) { return productionTradingFailure(error); }
}
