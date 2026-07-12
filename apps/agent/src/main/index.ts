import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, Tray, utilityProcess } from "electron";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createControlClient, createEncryptedCommandOutcomeStore, ControlClientRevokedError } from "./control-client";
import { registerAgentIpc, type AgentShellServices } from "./ipc";
import { createDeviceIdentityVault } from "./device-identity";
import { createStartAtLoginController } from "./login-item";
import { createPairingClient } from "./pairing-client";
import { createPairingExpiryGuard } from "./pairing-expiry";
import { createRuntimeSupervisor } from "./runtime-supervisor";
import { createNodeTelemetryFileStore, createTelemetryBuffer } from "./telemetry-buffer";
import { createCredentialVault, createNodeVaultFileStore, type AsyncSafeStorage } from "./vault";
import { createWeexConnectionVerifier } from "./weex-connection-verifier";
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
  const osStorage: AsyncSafeStorage = {
    isAsyncEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptStringAsync: async (plaintext) => Uint8Array.from(safeStorage.encryptString(plaintext)),
    decryptStringAsync: async (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext)),
  };
  const vaultDirectory = join(app.getPath("userData"), "vault");
  const vault = createCredentialVault(osStorage, createNodeVaultFileStore(join(vaultDirectory, "credentials.bin")));
  const connectionVerifier = createWeexConnectionVerifier({ vault });
  const identityVault = createDeviceIdentityVault(
    osStorage,
    createNodeVaultFileStore(join(vaultDirectory, "device-identity.bin")),
  );
  const outcomeStore = createEncryptedCommandOutcomeStore(
    osStorage,
    createNodeVaultFileStore(join(vaultDirectory, "command-outcomes.bin")),
  );
  const telemetry = createTelemetryBuffer(
    osStorage,
    createNodeTelemetryFileStore(join(app.getPath("userData"), "telemetry", "events.bin")),
  );
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
  const controlPlaneOrigin = process.env.CBL_CONTROL_PLANE_ORIGIN;
  let pairingClient: ReturnType<typeof createPairingClient> | null = null;
  if (controlPlaneOrigin) {
    try { pairingClient = createPairingClient({ baseUrl: controlPlaneOrigin, identityVault }); }
    catch { pairingClient = null; }
  }
  let controlAbort: AbortController | null = null;
  let controlOnline = false;
  let pairingState: "unpaired" | "paired" | "expired" | "revoked" = "unpaired";

  const stopForInvalidPairing = async (nextState: "expired" | "revoked"): Promise<void> => {
    pairingState = nextState;
    controlOnline = false;
    controlAbort?.abort();
    controlAbort = null;
    expiryGuard.cancel();
    await runtime.emergencyStop().catch(() => undefined);
  };
  const expiryGuard = createPairingExpiryGuard({
    onExpired: () => stopForInvalidPairing("expired"),
  });

  const waitForControlRetry = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });

  async function ensureControlPlane(): Promise<void> {
    if (controlAbort) return;
    const identity = await identityVault.load();
    if (!identity) return;
    if (identity.credentialExpiresAt <= Date.now()) {
      await stopForInvalidPairing("expired");
      return;
    }
    pairingState = "paired";
    await expiryGuard.schedule(identity.credentialExpiresAt);
    if (!controlPlaneOrigin) return;
    const controller = new AbortController();
    controlAbort = controller;
    const client = createControlClient({
      baseUrl: controlPlaneOrigin,
      identity: async () => {
        const current = await identityVault.load();
        if (!current) throw new Error("Device identity is unavailable");
        return current;
      },
      // Task 15 supplies the durable local deployment registry. Until then,
      // every remote action is acknowledged as fenced and cannot execute.
      deploymentVersion: async () => null,
      execute: async () => ({ status: "rejected", code: "runtime_unavailable" }),
      outcomeStore,
      onExpiredOutcome: async (pending) => {
        const eventId = `outcome-expired-${createHash("sha256").update(pending.commandId).digest("hex").slice(0, 32)}`;
        try {
          await telemetry.enqueue({
            version: 1,
            id: eventId,
            type: "agent-error",
            deploymentId: pending.deploymentId,
            expectedDeploymentVersion: pending.expectedDeploymentVersion,
            correlationId: pending.commandId,
            occurredAt: Date.now(),
            payload: {
              code: "command_outcome_expired",
              message: "A durable command outcome exceeded the acknowledgement window",
              retryable: false,
            },
          }, { priority: "high" });
        } catch (error) {
          // A deterministic ID makes a retried dead-letter callback idempotent.
          if (!(error instanceof Error) || !/ID collision/i.test(error.message)) throw error;
        }
      },
      onRevoked: async () => {
        const current = await identityVault.load().catch(() => null);
        const expired = current !== null && current.credentialExpiresAt <= Date.now();
        await stopForInvalidPairing(expired ? "expired" : "revoked");
        if (!expired) await identityVault.erase();
      },
    });

    void (async () => {
      let backoff = 500;
      try {
        while (!controller.signal.aborted) {
          try {
            await client.uploadOnce(telemetry);
            await client.pollOnce();
            if (controlAbort === controller) controlOnline = true;
            backoff = 500;
            await waitForControlRetry(2_000, controller.signal);
          } catch (error) {
            if (controlAbort === controller) controlOnline = false;
            if (error instanceof ControlClientRevokedError || controller.signal.aborted) break;
            await waitForControlRetry(backoff, controller.signal);
            backoff = Math.min(backoff * 2, 30_000);
          }
        }
      } finally {
        if (controlAbort === controller) {
          controlOnline = false;
          controlAbort = null;
        }
      }
    })();
  }

  const services: AgentShellServices = {
    getStatus: async () => {
      const [credential, identity] = await Promise.all([vault.metadata(), identityVault.load()]);
      if (pairingState !== "revoked") {
        if (identity && identity.credentialExpiresAt <= Date.now()) await stopForInvalidPairing("expired");
        else pairingState = identity ? "paired" : "unpaired";
      }
      const paired = pairingState === "paired";
      const state = pairingState === "revoked" || pairingState === "expired"
        ? "error" : credential.configured ? (controlOnline ? "ready" : "offline") : "unconfigured";
      return { state, credential, paired, pairingState, startAtLogin: login.enabled() };
    },
    saveCredentials: async (input) => {
      const identity = await identityVault.load();
      if (pairingState === "revoked" || !identity || identity.credentialExpiresAt <= Date.now()) {
        if (identity && identity.credentialExpiresAt <= Date.now()) await stopForInvalidPairing("expired");
        throw new Error("Pair this agent before saving an exchange credential");
      }
      return vault.save(input);
    },
    verifyCredentials: async () => {
      const identity = await identityVault.load();
      if (pairingState === "revoked" || !identity || identity.credentialExpiresAt <= Date.now()) {
        if (identity && identity.credentialExpiresAt <= Date.now()) await stopForInvalidPairing("expired");
        throw new Error("Pair this agent before verifying an exchange credential");
      }
      return connectionVerifier.verify();
    },
    eraseCredentials: () => vault.erase(),
    pair: async (input) => {
      const existing = await identityVault.load();
      if (existing && existing.credentialExpiresAt > Date.now()) throw new Error("This agent is already paired");
      if (!pairingClient) throw new Error("Control-plane origin is not configured");
      const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : null;
      if (!platform) throw new Error("This operating system is not supported");
      const paired = await pairingClient.pair({
        code: input.code,
        deviceName: input.deviceName,
        platform,
      });
      pairingState = "paired";
      await expiryGuard.schedule(paired.credentialExpiresAt);
      await ensureControlPlane().catch(() => undefined);
      return { paired: true, deviceId: paired.deviceId };
    },
    setStartAtLogin: (enabled) => login.set(enabled),
    emergencyStop: () => runtime.emergencyStop(),
  };
  const window = await startAgentShell(services);
  await ensureControlPlane().catch(() => undefined);
  const trayImage = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ4QAAAABJRU5ErkJggg==");
  const tray = new Tray(trayImage.resize({ width: 16, height: 16 }));
  tray.setToolTip("CryptoBot Labs Agent");
  const lifecycle = new TrayWindowLifecycle(app, window, tray);
  const menu = Menu.buildFromTemplate([
    { label: "顯示 CryptoBot Labs Agent", click: () => window.show() },
    { type: "separator" },
    { label: "結束", click: () => {
      controlAbort?.abort();
      expiryGuard.cancel();
      void runtime.shutdown().finally(() => lifecycle.quitExplicitly());
    } },
  ]);
  lifecycle.install(menu);
  app.once("before-quit", () => {
    controlAbort?.abort();
    expiryGuard.cancel();
    lifecycle.prepareToQuit();
  });
}

if (process.type === "browser") {
  void bootstrapAgent().catch(() => {
    process.stderr.write("CryptoBot Labs Agent failed to start safely.\n");
    app.quit();
  });
}
