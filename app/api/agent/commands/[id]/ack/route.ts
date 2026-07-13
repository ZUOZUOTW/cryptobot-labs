import { createProductionAgentHandlers, productionAgentFailure } from "../../../../../../lib/server/agent-runtime";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try { return await createProductionAgentHandlers().ack(request, context); }
  catch (error) { return productionAgentFailure(error); }
}
