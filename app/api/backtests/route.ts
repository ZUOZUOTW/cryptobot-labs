import { env } from "cloudflare:workers";
import { createProductionTradingHandlers, productionTradingFailure } from "../../../lib/server/backtest-runtime";

export async function POST(request: Request): Promise<Response> {
  try { return await createProductionTradingHandlers(env).backtests.post(request); }
  catch (error) { return productionTradingFailure(error); }
}

export async function GET(request: Request): Promise<Response> {
  try { return await createProductionTradingHandlers(env).backtests.list(request); }
  catch (error) { return productionTradingFailure(error); }
}
