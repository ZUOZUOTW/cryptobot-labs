import {
  IPC_CHANNELS,
  IPC_EVENTS,
  parseAgentStatus,
  parseAgentUpdateStatus,
  parseCredentialInput,
  parseCredentialMetadata,
  parsePairingInput,
  parsePairingResult,
  parsePairingSuggestion,
  parseVerifiedConnection,
  type AgentRendererApi,
} from "../shared/ipc-contract";

export type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
export type IpcSubscribe = (channel: string, listener: (value: unknown) => void) => () => void;

export function createAgentRendererApi(invoke: IpcInvoke, subscribe: IpcSubscribe = () => () => undefined): AgentRendererApi {
  const api: AgentRendererApi = {
    getStatus: async () => parseAgentStatus(await invoke(IPC_CHANNELS.getStatus)),
    saveCredentials: async (input) => parseCredentialMetadata(await invoke(IPC_CHANNELS.saveCredentials, parseCredentialInput(input))),
    verifyCredentials: async () => parseVerifiedConnection(await invoke(IPC_CHANNELS.verifyCredentials)),
    eraseCredentials: async () => { await invoke(IPC_CHANNELS.eraseCredentials); },
    pair: async (input) => parsePairingResult(await invoke(IPC_CHANNELS.pair, parsePairingInput(input))),
    setStartAtLogin: async (enabled) => { await invoke(IPC_CHANNELS.setStartAtLogin, enabled); },
    emergencyStop: async () => { await invoke(IPC_CHANNELS.emergencyStop); },
    getUpdateStatus: async () => parseAgentUpdateStatus(await invoke(IPC_CHANNELS.getUpdateStatus)),
    checkForUpdates: async () => parseAgentUpdateStatus(await invoke(IPC_CHANNELS.checkForUpdates)),
    installUpdate: async () => { await invoke(IPC_CHANNELS.installUpdate); },
    onPairingSuggestion: (listener) => subscribe(IPC_EVENTS.pairingSuggestion,
      (value) => listener(parsePairingSuggestion(value))),
  };
  return Object.freeze(api);
}
