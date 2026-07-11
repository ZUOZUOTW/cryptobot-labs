import { createProductionAgentHandlers, productionAgentFailure } from "../../../../lib/server/agent-runtime";

export async function POST(request: Request): Promise<Response> {
  try { return await createProductionAgentHandlers().events(request); }
  catch (error) { return productionAgentFailure(error); }
}
