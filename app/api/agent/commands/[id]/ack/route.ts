import { createProductionAgentHandlers, productionAgentFailure } from "../../../../../../lib/server/agent-runtime";
import type { AgentRouteContext } from "../../../../../../lib/server/agent-routes";

export async function POST(request: Request, context: AgentRouteContext): Promise<Response> {
  try { return await createProductionAgentHandlers().ack(request, context); }
  catch (error) { return productionAgentFailure(error); }
}
