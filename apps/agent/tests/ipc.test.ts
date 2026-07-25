import { describe, expect, it, vi } from "vitest";
import { registerAgentIpc, type AgentShellServices, type IpcMainLike, type TrustedRendererIdentity } from "../src/main/ipc";
import { createStartAtLoginController } from "../src/main/login-item";
import { AGENT_CSP, TrayWindowLifecycle, createMainWindow, hardenWebContents, secureWindowOptions, type BrowserWindowLike } from "../src/main/windows";
import { createAgentRendererApi } from "../src/preload/api";
import { IPC_CHANNELS, IPC_EVENTS, type AgentStatus, type AgentUpdateStatus, type VerifiedConnection } from "../src/shared/ipc-contract";

function createIpcHarness() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const mainFrame = { url: "file:///trusted/index.html" };
  const webContents = { mainFrame, getURL: () => mainFrame.url };
  const trustedRenderer: TrustedRendererIdentity = { webContents, mainFrame, url: mainFrame.url };
  const trustedEvent = { sender: webContents, senderFrame: mainFrame };
  const ipcMain: IpcMainLike = {
    handle(channel, listener) { handlers.set(channel, listener); },
    removeHandler(channel) { handlers.delete(channel); },
  };
  const invoke = async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Missing handler: ${channel}`);
    return handler(trustedEvent, ...args);
  };
  return { ipcMain, handlers, invoke, trustedRenderer, trustedEvent };
}

function services(): AgentShellServices {
  return {
    getStatus: vi.fn(async (): Promise<AgentStatus> => ({ state: "ready", credential: { apiKeySuffix: "1234", configured: true }, paired: true, pairingState: "paired", startAtLogin: false })),
    saveCredentials: vi.fn(async () => ({ apiKeySuffix: "1234", configured: true })),
    verifyCredentials: vi.fn(async (): Promise<VerifiedConnection> => ({
      provider: "WEEX",
      apiKeySuffix: "1234",
      verifiedAt: "2026-07-12T00:00:00.000Z",
      permissions: { read: true, spotTrade: true, futuresTrade: false, withdrawal: false },
    })),
    eraseCredentials: vi.fn(async () => undefined),
    pair: vi.fn(async () => ({ paired: true, deviceId: "device-1" })),
    setStartAtLogin: vi.fn(async () => undefined),
    emergencyStop: vi.fn(async () => undefined),
    getUpdateStatus: vi.fn(async (): Promise<AgentUpdateStatus> => ({ state: "idle", version: null, reason: null })),
    checkForUpdates: vi.fn(async (): Promise<AgentUpdateStatus> => ({ state: "checking", version: null, reason: null })),
    installUpdate: vi.fn(async () => undefined),
  };
}

describe("secure IPC allowlist", () => {
  it("exposes exactly the approved methods and no secret reader", () => {
    const api = createAgentRendererApi(async () => undefined);
    expect(Object.keys(api).sort()).toEqual([...Object.keys(IPC_CHANNELS), "onPairingSuggestion"].sort());
    expect(Object.keys(api)).not.toContain("readCredentials");
  });

  it("validates pairing suggestions before exposing them to the renderer", () => {
    let relay: ((value: unknown) => void) | undefined;
    const api = createAgentRendererApi(async () => undefined, (channel, listener) => {
      expect(channel).toBe(IPC_EVENTS.pairingSuggestion); relay = listener; return () => undefined;
    });
    const listener = vi.fn(); api.onPairingSuggestion(listener);
    relay?.(`CBL-${"A".repeat(22)}`);
    expect(listener).toHaveBeenCalledWith(`CBL-${"A".repeat(22)}`);
    expect(() => relay?.("unsafe")).toThrow("Invalid pairing suggestion");
  });

  it("validates inputs in both preload and main before calling services", async () => {
    const harness = createIpcHarness();
    const shellServices = services();
    registerAgentIpc(harness.ipcMain, shellServices, harness.trustedRenderer);
    const api = createAgentRendererApi(harness.invoke);

    await expect(api.saveCredentials({ apiKey: "key-1234", secretKey: "secret-key", passphrase: "phrase" })).resolves.toEqual({ apiKeySuffix: "1234", configured: true });
    await expect(api.pair({ code: `CBL-${"_".repeat(22)}`, deviceName: "交易電腦" }))
      .resolves.toEqual({ paired: true, deviceId: "device-1" });
    await expect(harness.invoke(IPC_CHANNELS.saveCredentials, { apiKey: "key", secretKey: "secret-key", passphrase: "phrase", injected: true })).rejects.toThrow("Invalid credential input");
    await expect(harness.invoke(IPC_CHANNELS.emergencyStop, "unexpected")).rejects.toThrow("no arguments");
    expect(shellServices.saveCredentials).toHaveBeenCalledTimes(1);
    expect(shellServices.pair).toHaveBeenCalledTimes(1);
    expect(shellServices.emergencyStop).not.toHaveBeenCalled();
  });

  it("rejects a service output that tries to append secret material", async () => {
    const harness = createIpcHarness();
    const shellServices = services();
    shellServices.getStatus = vi.fn(async () => ({
      state: "ready", credential: { apiKeySuffix: "1234", configured: true }, paired: true, pairingState: "paired", startAtLogin: false, secretKey: "leak",
    } as never));
    registerAgentIpc(harness.ipcMain, shellServices, harness.trustedRenderer);
    await expect(harness.invoke(IPC_CHANNELS.getStatus)).rejects.toThrow("Invalid agent status");
  });

  it("does not forward vault/provider error text to the renderer", async () => {
    const harness = createIpcHarness();
    const shellServices = services();
    shellServices.saveCredentials = vi.fn(async () => { throw new Error("secret-key appeared upstream"); });
    registerAgentIpc(harness.ipcMain, shellServices, harness.trustedRenderer);
    const api = createAgentRendererApi(harness.invoke);
    await expect(api.saveCredentials({ apiKey: "key-1234", secretKey: "secret-key", passphrase: "phrase" }))
      .rejects.toThrow("Agent operation failed: save credentials");
    await expect(api.saveCredentials({ apiKey: "key-1234", secretKey: "secret-key", passphrase: "phrase" }))
      .rejects.not.toThrow(/secret-key appeared/i);
  });

  it("fails closed for non-main-frame, foreign webContents, and changed URLs", async () => {
    const harness = createIpcHarness();
    const shellServices = services();
    registerAgentIpc(harness.ipcMain, shellServices, harness.trustedRenderer);
    const handler = harness.handlers.get(IPC_CHANNELS.getStatus)!;

    expect(() => handler({ sender: harness.trustedRenderer.webContents, senderFrame: { url: harness.trustedRenderer.url } }))
      .toThrow("Untrusted IPC sender");
    expect(() => handler({ sender: { mainFrame: harness.trustedRenderer.mainFrame, getURL: () => harness.trustedRenderer.url }, senderFrame: harness.trustedRenderer.mainFrame }))
      .toThrow("Untrusted IPC sender");
    const sender = harness.trustedRenderer.webContents as { getURL(): string; mainFrame: object };
    const getURL = sender.getURL;
    sender.getURL = () => "https://attacker.invalid";
    expect(() => handler(harness.trustedEvent)).toThrow("Untrusted IPC sender");
    sender.getURL = getURL;
    expect(shellServices.getStatus).not.toHaveBeenCalled();
  });
});

describe("Electron shell security", () => {
  it("changes login startup only after an explicit user choice", async () => {
    const setLoginItemSettings = vi.fn();
    const controller = createStartAtLoginController({
      setLoginItemSettings,
      getLoginItemSettings: () => ({ openAtLogin: false }),
    });
    expect(controller.enabled()).toBe(false);
    expect(setLoginItemSettings).not.toHaveBeenCalled();
    await controller.set(true);
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it("enables isolation and sandbox while disabling Node integration", () => {
    expect(secureWindowOptions("/trusted/preload.js").webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
    expect(AGENT_CSP).toContain("connect-src 'none'");
    expect(AGENT_CSP).toContain("object-src 'none'");
  });

  it("binds trusted IPC identity before loading renderer code", async () => {
    const order: string[] = [];
    const mainFrame = {};
    const window = {
      webContents: {
        mainFrame,
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        session: { webRequest: { onHeadersReceived: vi.fn() } },
      },
      on: vi.fn(), hide: vi.fn(), show: vi.fn(), isDestroyed: () => false,
      loadURL: vi.fn(async () => { order.push("load"); }),
      loadFile: vi.fn(async () => { order.push("load"); }),
    } satisfies BrowserWindowLike;
    class BrowserWindow {
      constructor() { return window; }
    }

    await createMainWindow({
      BrowserWindow: BrowserWindow as never,
      preloadPath: "/trusted/preload.js",
      rendererFile: "/trusted/index.html",
      onCreated: (created) => {
        expect(created.webContents.mainFrame).toBe(mainFrame);
        order.push("bind");
      },
    });
    expect(order).toEqual(["bind", "load"]);
  });

  it("denies navigation/new windows and injects a strict CSP", () => {
    let navigation: ((event: { preventDefault(): void }) => void) | undefined;
    let openHandler: (() => { action: "deny" }) | undefined;
    let headersHandler: ((details: { responseHeaders?: Record<string, string[]> }, callback: (response: { responseHeaders: Record<string, string[]> }) => void) => void) | undefined;
    hardenWebContents({
      on: (_event, listener) => { navigation = listener; },
      setWindowOpenHandler: (handler) => { openHandler = handler; },
      session: { webRequest: { onHeadersReceived: (handler) => { headersHandler = handler; } } },
    });
    const preventDefault = vi.fn();
    navigation?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openHandler?.()).toEqual({ action: "deny" });
    const callback = vi.fn();
    headersHandler?.({ responseHeaders: { Existing: ["yes"] } }, callback);
    expect(callback).toHaveBeenCalledWith({ responseHeaders: { Existing: ["yes"], "Content-Security-Policy": [AGENT_CSP] } });
  });

  it("keeps running on close and quits only through the explicit action", () => {
    let close: ((event: { preventDefault(): void }) => void) | undefined;
    let trayClick: (() => void) | undefined;
    const window = {
      webContents: {} as never,
      on: (_event: "close", listener: (event: { preventDefault(): void }) => void) => { close = listener; },
      hide: vi.fn(), show: vi.fn(), isDestroyed: () => false,
      loadURL: vi.fn(async () => undefined), loadFile: vi.fn(async () => undefined),
    };
    const tray = { on: (_event: "click", listener: () => void) => { trayClick = listener; }, setContextMenu: vi.fn(), destroy: vi.fn() };
    const app = { quit: vi.fn() };
    const lifecycle = new TrayWindowLifecycle(app, window, tray);
    lifecycle.install({ quit: true });
    const preventDefault = vi.fn();
    close?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
    trayClick?.();
    expect(window.show).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
    lifecycle.quitExplicitly();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
  });
});
