import { app, autoUpdater, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, Tray, utilityProcess } from "electron";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createControlClient, createEncryptedCommandOutcomeStore, ControlClientRevokedError } from "./control-client";
import { ConnectionRegistry } from "./connections";
import { createConnectionControl } from "./connection-control";
import { createConnectionVersionStore } from "./connection-version-store";
import { DeploymentInstaller } from "./deployment-installer";
import { createDeploymentClient } from "./deployment-client";
import { registerAgentIpc, type AgentShellServices } from "./ipc";
import { createLiveHeartbeatTelemetry, createPaperHeartbeatTelemetry } from "./heartbeat-telemetry";
import { createDeviceIdentityVault } from "./device-identity";
import { createStartAtLoginController } from "./login-item";
import { createLiveAccountService } from "./live-account-service";
import { LiveRunRunner } from "./live-run-runner";
import { LiveScheduler } from "./live-scheduler";
import { DurableLiveState } from "./live-state";
import { createLiveUnlockService } from "./live-unlock-service";
import { createPairingClient } from "./pairing-client";
import { createPairingExpiryGuard } from "./pairing-expiry";
import { ClockFreshnessGuard, MarketStreamState } from "./market-stream";
import { createDurableOrderRepository } from "./order-store";
import { createOrderStateTelemetry } from "./order-telemetry";
import { DurablePaperAccount } from "./paper-account";
import { PaperRunRunner } from "./paper-run-runner";
import { PaperScheduler } from "./paper-scheduler";
import { InstrumentRuleState, PublicMarketService } from "./public-market-service";
import { createRuntimeSupervisor } from "./runtime-supervisor";
import { createRuntimeTelemetry } from "./runtime-telemetry";
import type { RunAuditEvent } from "./run-manager";
import { createDurableRunStore, createNodeRunFileStore } from "./run-store";
import { createNodeTelemetryFileStore, createTelemetryBuffer } from "./telemetry-buffer";
import { createAgentUpdateService, isSquirrelLifecycleInvocation, type AutoUpdaterAdapter } from "./update-service";
import { createCredentialVault, createNodeVaultFileStore, type AsyncSafeStorage } from "./vault";
import { createVaultWeexExecutionClient } from "./vault-weex-execution-client";
import { createWeexConnectionVerifier } from "./weex-connection-verifier";
import { createMainWindow, TrayWindowLifecycle, type BrowserWindowLike } from "./windows";
import type { RuntimeAuditEvent } from "../runtime/execution-runtime";
import { pairingCodeFromArguments, pairingCodeFromDeepLink } from "../shared/pairing-deep-link";
import { IPC_EVENTS } from "../shared/ipc-contract";
export { createStartAtLoginController } from "./login-item";

declare const __CBL_CONTROL_PLANE_ORIGIN__: string;
declare const __CBL_WEEX_BROKER_ID__: string;

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
  let agentWindow: BrowserWindowLike | null = null;
  let pendingPairingCode = pairingCodeFromArguments(process.argv);
  const offerPairingCode = (code: string | null): void => {
    if (!code) return;
    pendingPairingCode = code;
    if (!agentWindow || agentWindow.isDestroyed()) return;
    (agentWindow.webContents as unknown as { send(channel: string, value: unknown): void })
      .send(IPC_EVENTS.pairingSuggestion, code);
    agentWindow.show();
  };
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on("second-instance", (_event, argv) => offerPairingCode(pairingCodeFromArguments(argv)));
  app.on("open-url", (event, url) => { event.preventDefault(); offerPairingCode(pairingCodeFromDeepLink(url)); });
  await app.whenReady();
  if (process.platform === "darwin" || process.platform === "win32") {
    app.setAsDefaultProtocolClient("cryptobot-labs");
  }
  if (process.platform === "win32") app.setAppUserModelId("com.squirrel.cryptobot_labs_agent.CryptoBot Labs Agent");
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
  const runStore = createDurableRunStore(
    osStorage,
    createNodeRunFileStore(join(vaultDirectory, "active-run.bin")),
  );
  const telemetry = createTelemetryBuffer(
    osStorage,
    createNodeTelemetryFileStore(join(app.getPath("userData"), "telemetry", "events.bin")),
  );
  const marketState = new MarketStreamState();
  const clockState = new ClockFreshnessGuard();
  const instrumentState = new InstrumentRuleState();
  const publicMarket = new PublicMarketService({ market: marketState, clock: clockState, instruments: instrumentState });
  const connectionRegistry = new ConnectionRegistry();
  const connectionVersions = createConnectionVersionStore(
    osStorage, createNodeVaultFileStore(join(vaultDirectory, "connection-version.bin")),
  );
  const orderRepository = createDurableOrderRepository(
    osStorage,
    createNodeVaultFileStore(join(vaultDirectory, "orders.bin")),
  );
  const enqueueTelemetrySafely = async (event: Parameters<typeof telemetry.enqueue>[0], priority: "normal" | "high" = "normal") => {
    try { await telemetry.enqueue(event, { priority }); }
    catch (error) { if (!(error instanceof Error) || !/ID collision/i.test(error.message)) throw error; }
  };
  const runtimeAudit = async (event: RuntimeAuditEvent): Promise<void> => {
    if (event.type !== "strategy-paused") {
      for (const telemetryEvent of createRuntimeTelemetry(event)) await enqueueTelemetrySafely(telemetryEvent);
      return;
    }
    const version = Number(event.configurationVersion.replace(/^v/, ""));
    if (!Number.isSafeInteger(version) || version < 1) return;
    const occurredAt = event.at > 0 ? event.at : Date.now();
    const id = `runtime-${createHash("sha256").update(`${event.deploymentId}:${event.type}:${occurredAt}`).digest("hex").slice(0, 48)}`;
    await enqueueTelemetrySafely({ version: 1, id, type: "deployment-state", deploymentId: event.deploymentId,
      expectedDeploymentVersion: version, correlationId: id, occurredAt,
      payload: { state: "paused", reason: event.reason } }, "high");
  };
  const runAudit = async (event: RunAuditEvent): Promise<void> => {
    if (event.type === "evaluation-complete") return;
    const restored = await runStore.restore();
    if (!restored || restored.definition.deploymentId !== event.deploymentId) return;
    const version = Number(restored.definition.configurationVersion.replace(/^v/, ""));
    if (!Number.isSafeInteger(version) || version < 1) return;
    const occurredAt = event.at > 0 ? event.at : Date.now();
    const state = event.type === "run-stopped" ? "stopped" : event.type === "run-started" ? "running" : "paused";
    const id = `run-${createHash("sha256").update(`${event.deploymentId}:${event.type}:${occurredAt}`).digest("hex").slice(0, 48)}`;
    await enqueueTelemetrySafely({ version: 1, id, type: "deployment-state", deploymentId: event.deploymentId,
      expectedDeploymentVersion: version, correlationId: id, occurredAt, payload: { state, reason: event.reason } });
  };
  const paperRunner = new PaperRunRunner({
    repository: orderRepository,
    market: marketState,
    clock: clockState,
    instruments: instrumentState,
    runtimeAudit,
    runAudit,
  });
  const liveExecutionClient = createVaultWeexExecutionClient({
    brokerId: __CBL_WEEX_BROKER_ID__,
    vault,
    rulesProvider: async (target, symbol) => instrumentState.requireFreshSnapshot(target.market, symbol, Date.now()),
  });
  const liveStates = new Map<string, DurableLiveState>();
  const liveStateFor = (deploymentId: string): DurableLiveState => {
    const existing = liveStates.get(deploymentId); if (existing) return existing;
    const created = new DurableLiveState(osStorage,
      createNodeVaultFileStore(join(vaultDirectory, "live-states", `${deploymentId}.bin`)));
    liveStates.set(deploymentId, created); return created;
  };
  const liveRunner = new LiveRunRunner({ brokerId: __CBL_WEEX_BROKER_ID__,
    repository: orderRepository, client: liveExecutionClient,
    market: marketState, clock: clockState, connection: connectionRegistry, instruments: instrumentState,
    runtimeAudit, runAudit,
    onReconciledOrder: async (order, snapshot) => {
      const restored = await runStore.restore();
      if (!restored || restored.definition.deploymentId !== order.deploymentId
        || (restored.definition.mode !== "live" && restored.definition.mode !== "futures-demo")
        || restored.definition.mode !== order.executionTarget.mode) return;
      const expectedDeploymentVersion = Number(restored.definition.configurationVersion.replace(/^v/, ""));
      if (!Number.isSafeInteger(expectedDeploymentVersion) || expectedDeploymentVersion < 1) return;
      await enqueueTelemetrySafely(createOrderStateTelemetry({ order, expectedDeploymentVersion,
        deploymentState: restored.status === "running" ? "running" : "paused",
        ...(snapshot.fills?.length ? { fills: snapshot.fills } : {}) }), "high");
      if (snapshot.fills?.length
        && (order.status === "filled" || (order.status === "cancelled" && order.cumulativeFilledQuantity !== "0"))) {
        await liveStateFor(order.deploymentId).applyFill(order,
          Math.max(order.updatedAt, ...snapshot.fills.map(({ filledAt }) => filledAt)), snapshot.fills);
      }
    } });
  const liveScheduler = new LiveScheduler({ collector: publicMarket, market: marketState,
    account: createLiveAccountService({ vault }), connection: connectionRegistry, orders: orderRepository,
    state: liveStateFor,
    runner: liveRunner,
    onActivated: async (bundle) => {
      const occurredAt = Date.now();
      const id = `live-start-${createHash("sha256").update(`${bundle.deployment.id}:${bundle.deployment.version}:${occurredAt}`).digest("hex").slice(0, 40)}`;
      await enqueueTelemetrySafely({ version: 1, id, type: "deployment-state", deploymentId: bundle.deployment.id,
        expectedDeploymentVersion: bundle.deployment.version, correlationId: id, occurredAt,
        payload: { state: "running", reason: bundle.deployment.mode === "futures-demo"
          ? "demo-scheduler-activated" : "live-scheduler-activated" } }, "high");
    },
    onOrder: async (order, bundle) => {
      if (order.cumulativeFilledQuantity !== "0") return;
      await enqueueTelemetrySafely(createOrderStateTelemetry({ order,
        expectedDeploymentVersion: bundle.deployment.version, deploymentState: "running" }));
    },
    onHeartbeat: async (evidence, markPrice, bundle, sequence, health) => {
      await enqueueTelemetrySafely(createLiveHeartbeatTelemetry({ evidence, markPrice, bundle, sequence, health }));
    },
    onFault: async (reason, bundle) => {
      const occurredAt = Date.now();
      const id = `live-fault-${createHash("sha256").update(`${bundle.deployment.id}:${reason}:${occurredAt}`).digest("hex").slice(0, 40)}`;
      await enqueueTelemetrySafely({ version: 1, id, type: "agent-error", deploymentId: bundle.deployment.id,
        expectedDeploymentVersion: bundle.deployment.version, correlationId: id, occurredAt,
        payload: { code: reason, message: bundle.deployment.mode === "futures-demo"
          ? "Demo evaluation paused locally" : "Live evaluation paused locally", retryable: false } }, "high");
    },
  });
  const paperScheduler = new PaperScheduler({ collector: publicMarket, market: marketState,
    account: (deploymentId) => new DurablePaperAccount(osStorage,
      createNodeVaultFileStore(join(vaultDirectory, "paper-accounts", `${deploymentId}.bin`))),
    runner: paperRunner,
    onHeartbeat: async (account, markPrice, leverage, observedAt, bundle, sequence) => {
      await enqueueTelemetrySafely(createPaperHeartbeatTelemetry({ account, markPrice, leverage,
        observedAt, bundle, sequence }));
    },
    onOrder: async (order, bundle) => {
      await enqueueTelemetrySafely(createOrderStateTelemetry({ order,
        expectedDeploymentVersion: bundle.deployment.version, deploymentState: "running" }));
    },
    onFault: async (reason, bundle) => {
      const occurredAt = Date.now();
      const id = `paper-fault-${createHash("sha256").update(`${bundle.deployment.id}:${reason}:${occurredAt}`).digest("hex").slice(0, 40)}`;
      await enqueueTelemetrySafely({ version: 1, id, type: "agent-error", deploymentId: bundle.deployment.id,
        expectedDeploymentVersion: bundle.deployment.version, correlationId: id, occurredAt,
        payload: { code: reason, message: "Paper evaluation paused locally", retryable: true } }, "high");
    },
  });
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
  const controlPlaneOrigin = __CBL_CONTROL_PLANE_ORIGIN__ || process.env.CBL_CONTROL_PLANE_ORIGIN;
  const updaterAdapter: AutoUpdaterAdapter = {
  setFeedURL: (options) => autoUpdater.setFeedURL(options),
  checkForUpdates: () => autoUpdater.checkForUpdates(),
  quitAndInstall: () => autoUpdater.quitAndInstall(),
  on: (event, listener) => (autoUpdater as unknown as { on(name: string, callback: (...args: unknown[]) => void): unknown })
    .on(event, listener),
  removeListener: (event, listener) => (autoUpdater as unknown as {
    removeListener(name: string, callback: (...args: unknown[]) => void): unknown
  }).removeListener(event, listener),
  };
  const updateService = createAgentUpdateService({ updater: updaterAdapter, runStore, packaged: app.isPackaged,
    platform: process.platform, arch: process.arch, currentVersion: app.getVersion(), controlPlaneOrigin,
    squirrelFirstRun: process.argv.includes("--squirrel-firstrun") });
  let pairingClient: ReturnType<typeof createPairingClient> | null = null;
  let deploymentInstaller: DeploymentInstaller | null = null;
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
    await Promise.all([runtime.emergencyStop().catch(() => undefined), paperScheduler.pause().catch(() => undefined),
      liveScheduler.pause().catch(() => undefined)]);
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
    if (!deploymentInstaller) {
      const deployments = createDeploymentClient({
        baseUrl: controlPlaneOrigin,
        identity: async () => {
          const current = await identityVault.load();
          if (!current) throw new Error("Device identity is unavailable");
          return current;
        },
        onRevoked: () => stopForInvalidPairing("revoked"),
      });
      const liveUnlock = createLiveUnlockService({ deployments, verifier: connectionVerifier,
        connection: connectionRegistry, market: publicMarket });
      const connectionControl = createConnectionControl({ verifier: connectionVerifier, registry: connectionRegistry,
        vault, versions: connectionVersions, enqueue: (event) => telemetry.enqueue(event, { priority: "critical" }) });
      deploymentInstaller = new DeploymentInstaller({ deployments, store: runStore, runner: paperScheduler,
        liveRunner: liveScheduler, liveUnlock, connectionControl,
        beginLiveStart: () => updateService.beginLiveStart() });
      await deploymentInstaller.initialize();
    }
    const installer = deploymentInstaller;
    const client = createControlClient({
      baseUrl: controlPlaneOrigin,
      identity: async () => {
        const current = await identityVault.load();
        if (!current) throw new Error("Device identity is unavailable");
        return current;
      },
      deploymentVersion: (deploymentId) => installer.deploymentVersion(deploymentId),
      execute: (command) => installer.execute(command),
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
      let idleDelay = 2_000;
      try {
        while (!controller.signal.aborted) {
          try {
            const uploaded = await client.uploadOnce(telemetry);
            const commands = await client.pollOnce();
            if (controlAbort === controller) controlOnline = true;
            backoff = 500;
            idleDelay = uploaded > 0 || commands > 0 ? 500 : Math.min(10_000, Math.ceil(idleDelay * 1.6));
            await waitForControlRetry(idleDelay, controller.signal);
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
    emergencyStop: async () => { await Promise.all([runtime.emergencyStop(), paperScheduler.pause(), liveScheduler.pause()]); },
    getUpdateStatus: async () => updateService.status(),
    checkForUpdates: () => updateService.check(),
    installUpdate: () => updateService.install(),
  };
  const window = await startAgentShell(services);
  agentWindow = window;
  if (pendingPairingCode) setTimeout(() => offerPairingCode(pendingPairingCode), 0);
  const updateTimer = setTimeout(() => { void updateService.check(); },
    process.argv.includes("--squirrel-firstrun") ? 10_000 : 3_000);
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
    clearTimeout(updateTimer);
    updateService.dispose();
    controlAbort?.abort();
    expiryGuard.cancel();
    lifecycle.prepareToQuit();
  });
}

if (process.type === "browser") {
  if (process.platform === "win32" && isSquirrelLifecycleInvocation(process.argv)) app.quit();
  else void bootstrapAgent().catch(() => {
    process.stderr.write("CryptoBot Labs Agent failed to start safely.\n");
    app.quit();
  });
}
