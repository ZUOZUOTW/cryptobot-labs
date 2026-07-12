import {
  IPC_CHANNELS,
  parseAgentStatus,
  parseCredentialInput,
  parseCredentialMetadata,
  parsePairingInput,
  parsePairingResult,
  parseVerifiedConnection,
  type AgentRendererApi,
} from "../shared/ipc-contract";

export type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export function createAgentRendererApi(invoke: IpcInvoke): AgentRendererApi {
  const api: AgentRendererApi = {
    getStatus: async () => parseAgentStatus(await invoke(IPC_CHANNELS.getStatus)),
    saveCredentials: async (input) => parseCredentialMetadata(await invoke(IPC_CHANNELS.saveCredentials, parseCredentialInput(input))),
    verifyCredentials: async () => parseVerifiedConnection(await invoke(IPC_CHANNELS.verifyCredentials)),
    eraseCredentials: async () => { await invoke(IPC_CHANNELS.eraseCredentials); },
    pair: async (input) => parsePairingResult(await invoke(IPC_CHANNELS.pair, parsePairingInput(input))),
    setStartAtLogin: async (enabled) => { await invoke(IPC_CHANNELS.setStartAtLogin, enabled); },
    emergencyStop: async () => { await invoke(IPC_CHANNELS.emergencyStop); },
  };
  return Object.freeze(api);
}
