import { createAgentDownloadsHandler } from "../../../lib/server/agent-downloads";

export async function GET(): Promise<Response> { return createAgentDownloadsHandler()(); }
