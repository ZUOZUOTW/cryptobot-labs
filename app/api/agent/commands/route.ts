import { createProductionAgentHandlers, productionAgentFailure } from "../../../../lib/server/agent-runtime";

export async function GET(request: Request): Promise<Response> {
  try { return await createProductionAgentHandlers().commands(request); }
  catch (error) { return productionAgentFailure(error); }
}
