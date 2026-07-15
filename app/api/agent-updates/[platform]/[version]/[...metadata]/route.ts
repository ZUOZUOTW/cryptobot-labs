import { createAgentUpdateHandler } from "../../../../../../lib/server/agent-updates";

export async function GET(_request: Request, context: { params: Promise<{ platform: string; version: string;
  metadata: string[] }> }): Promise<Response> { return createAgentUpdateHandler()(context); }
