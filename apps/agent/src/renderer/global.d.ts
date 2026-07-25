import type { AgentRendererApi } from "../shared/ipc-contract";

declare global {
  interface Window { cryptoBotAgent: AgentRendererApi }
}

export {};
