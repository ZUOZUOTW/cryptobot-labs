import {
  IPC_CHANNELS,
  assertNoArguments,
  parseAgentStatus,
  parseBoolean,
  parseCredentialInput,
  parseCredentialMetadata,
  parsePairingInput,
  parsePairingResult,
  parseVerifiedConnection,
  type AgentStatus,
  type CredentialInput,
  type CredentialMetadata,
  type PairingInput,
  type PairingResult,
  type VerifiedConnection,
} from "../shared/ipc-contract";

export interface AgentShellServices {
  getStatus(): Promise<AgentStatus>;
  saveCredentials(input: CredentialInput): Promise<CredentialMetadata>;
  verifyCredentials(): Promise<VerifiedConnection>;
  eraseCredentials(): Promise<void>;
  pair(input: PairingInput): Promise<PairingResult>;
  setStartAtLogin(enabled: boolean): Promise<void>;
  emergencyStop(): Promise<void>;
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface TrustedRendererIdentity {
  readonly webContents: object;
  readonly mainFrame: object;
  readonly url: string;
}

interface IpcInvokeEventLike {
  sender?: { getURL?(): string; mainFrame?: object };
  senderFrame?: { url?: string };
}

export function isTrustedRendererEvent(event: unknown, trusted: TrustedRendererIdentity): boolean {
  if (!event || typeof event !== "object") return false;
  const invokeEvent = event as IpcInvokeEventLike;
  try {
    return (
      invokeEvent.sender === trusted.webContents &&
      invokeEvent.sender?.mainFrame === trusted.mainFrame &&
      invokeEvent.senderFrame === trusted.mainFrame &&
      invokeEvent.sender.getURL?.() === trusted.url &&
      invokeEvent.senderFrame.url === trusted.url
    );
  } catch {
    return false;
  }
}

async function callService<T>(operation: string, callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch {
    // Never serialize provider/vault errors to the renderer: upstream messages
    // can echo request material, including credential fields.
    throw new Error(`Agent operation failed: ${operation}`);
  }
}

function assertVoidResult(value: unknown): void {
  if (value !== undefined) throw new TypeError("Invalid empty response");
}

export function registerAgentIpc(
  ipcMain: IpcMainLike,
  services: AgentShellServices,
  trustedRenderer: TrustedRendererIdentity,
): () => void {
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    [IPC_CHANNELS.getStatus]: async (...args) => {
      assertNoArguments(args);
      return parseAgentStatus(await callService("get status", () => services.getStatus()));
    },
    [IPC_CHANNELS.saveCredentials]: async (...args) => {
      if (args.length !== 1) throw new TypeError("Expected one argument");
      const input = parseCredentialInput(args[0]);
      return parseCredentialMetadata(await callService("save credentials", () => services.saveCredentials(input)));
    },
    [IPC_CHANNELS.verifyCredentials]: async (...args) => {
      assertNoArguments(args);
      return parseVerifiedConnection(await callService("verify credentials", () => services.verifyCredentials()));
    },
    [IPC_CHANNELS.eraseCredentials]: async (...args) => {
      assertNoArguments(args);
      assertVoidResult(await callService("erase credentials", () => services.eraseCredentials()));
    },
    [IPC_CHANNELS.pair]: async (...args) => {
      if (args.length !== 1) throw new TypeError("Expected one argument");
      const input = parsePairingInput(args[0]);
      return parsePairingResult(await callService("pair", () => services.pair(input)));
    },
    [IPC_CHANNELS.setStartAtLogin]: async (...args) => {
      if (args.length !== 1) throw new TypeError("Expected one argument");
      const enabled = parseBoolean(args[0]);
      assertVoidResult(await callService("set login startup", () => services.setStartAtLogin(enabled)));
    },
    [IPC_CHANNELS.emergencyStop]: async (...args) => {
      assertNoArguments(args);
      assertVoidResult(await callService("emergency stop", () => services.emergencyStop()));
    },
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedRendererEvent(event, trustedRenderer)) throw new Error("Untrusted IPC sender");
      return handler(...args);
    });
  }
  return () => Object.values(IPC_CHANNELS).forEach((channel) => ipcMain.removeHandler(channel));
}
