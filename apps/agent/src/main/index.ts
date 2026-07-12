import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, Tray, utilityProcess } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerAgentIpc, type AgentShellServices } from "./ipc";
import { createStartAtLoginController } from "./login-item";
import { createRuntimeSupervisor } from "./runtime-supervisor";
import { createCredentialVault, createNodeVaultFileStore } from "./vault";
import { createMainWindow, TrayWindowLifecycle, type BrowserWindowLike } from "./windows";
export { createStartAtLoginController } from "./login-item";

function trustedDevelopmentUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || url.username || url.password) throw new Error("Untrusted renderer development URL");
  return url.href;
}

export async function startAgentShell(services: AgentShellServices): Promise<BrowserWindowLike> {
  await app.whenReady();

  const currentDirectory = __dirname;
  const rendererUrl = process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? trustedDevelopmentUrl(process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL) : undefined;
  const rendererFile = rendererUrl ? undefined : join(currentDirectory, "../renderer/main_window/index.html");
  const trustedUrl = rendererUrl ? new URL(rendererUrl).href : pathToFileURL(rendererFile!).href;
  const window = await createMainWindow({
    BrowserWindow,
    preloadPath: join(currentDirectory, "preload.cjs"),
    rendererUrl,
    rendererFile,
    onCreated: (createdWindow) => registerAgentIpc(ipcMain, services, {
      webContents: createdWindow.webContents,
      mainFrame: createdWindow.webContents.mainFrame,
      url: trustedUrl,
    }),
  });
  window.show();
  return window;
}

export async function bootstrapAgent(): Promise<void> {
  await app.whenReady();
  const currentDirectory = __dirname;
  const vault = createCredentialVault({
    isAsyncEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptStringAsync: async (plaintext) => Uint8Array.from(safeStorage.encryptString(plaintext)),
    decryptStringAsync: async (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext)),
  }, createNodeVaultFileStore(join(app.getPath("userData"), "vault", "credentials.bin")));
  const runtime = createRuntimeSupervisor({
    fork: () => {
      const child = utilityProcess.fork(join(currentDirectory, "runtime.cjs"));
      const adapter = {
        postMessage: (message: Parameters<typeof child.postMessage>[0]) => child.postMessage(message),
        kill: () => child.kill(),
        on(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number | null) => void)) {
          if (event === "message") child.on("message", listener as (message: unknown) => void);
          else child.on("exit", listener as (code: number) => void);
          return adapter;
        },
      };
      return adapter;
    },
  });
  const login = createStartAtLoginController(app);
  const services: AgentShellServices = {
    getStatus: async () => {
      const credential = await vault.metadata();
      return { state: credential.configured ? "offline" : "unconfigured",
        credential, paired: false, startAtLogin: login.enabled() };
    },
    saveCredentials: (input) => vault.save(input),
    verifyCredentials: async () => { throw new Error("Connection verification is unavailable until pairing is configured"); },
    eraseCredentials: () => vault.erase(),
    pair: async () => { throw new Error("Pairing is unavailable until the signed control client is configured"); },
    setStartAtLogin: (enabled) => login.set(enabled),
    emergencyStop: () => runtime.emergencyStop(),
  };
  const window = await startAgentShell(services);
  const trayImage = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ4QAAAABJRU5ErkJggg==");
  const tray = new Tray(trayImage.resize({ width: 16, height: 16 }));
  tray.setToolTip("CryptoBot Labs Agent");
  const lifecycle = new TrayWindowLifecycle(app, window, tray);
  const menu = Menu.buildFromTemplate([
    { label: "顯示 CryptoBot Labs Agent", click: () => window.show() },
    { type: "separator" },
    { label: "結束", click: () => { void runtime.shutdown().finally(() => lifecycle.quitExplicitly()); } },
  ]);
  lifecycle.install(menu);
  app.once("before-quit", () => lifecycle.prepareToQuit());
}

if (process.type === "browser") {
  void bootstrapAgent().catch(() => {
    process.stderr.write("CryptoBot Labs Agent failed to start safely.\n");
    app.quit();
  });
}
