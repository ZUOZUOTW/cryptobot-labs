import { createProductionAgentHandlers, productionAgentFailure } from "../../../../../lib/server/agent-runtime";

export async function GET(request: Request,
  context: { params: Promise<{ id: string }> }): Promise<Response> {
  try { return await createProductionAgentHandlers().deployments(request, context); }
  catch (error) { return productionAgentFailure(error); }
}
