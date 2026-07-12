import { randomUUID } from "node:crypto";

import {
  parseRuntimeCommand,
  parseRuntimeEvent,
  redactCredentialMaterial,
  type RuntimeCommand,
  type RuntimeEvent,
} from "../runtime/runtime-protocol";

export interface UtilityRuntimeProcess {
  postMessage(message: RuntimeCommand): void | Promise<void>;
  kill(): boolean;
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "exit", listener: (code: number | null) => void): this;
  off?(event: "message" | "exit", listener: (...args: never[]) => void): this;
}

export type RuntimeStartCommand = Extract<RuntimeCommand, { type: "start" }>;
export type RuntimeLaunchProvider = () => RuntimeStartCommand | Promise<RuntimeStartCommand>;

export type SupervisorState = "idle" | "starting" | "running" | "stopping" | "circuit-open";

export interface RuntimeSupervisorOptions {
  fork(): UtilityRuntimeProcess;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  maxRestarts?: number;
  restartWindowMs?: number;
  now?: () => number;
  onPublicEvent?: (event: RuntimeEvent) => void;
  onDiagnostic?: (detail: unknown) => void;
}

export interface RuntimeSupervisor {
  readonly state: SupervisorState;
  start(command: RuntimeStartCommand | RuntimeLaunchProvider): Promise<void>;
  emergencyStop(): Promise<void>;
  shutdown(): Promise<void>;
}

function secretValues(command: RuntimeStartCommand | null): string[] {
  if (!command) return [];
  return [command.credentials.apiKey, command.credentials.secretKey, command.credentials.passphrase];
}

function safeCommand(command: RuntimeStartCommand): RuntimeStartCommand {
  const parsed = parseRuntimeCommand(command);
  if (!parsed || parsed.type !== "start") throw new Error("Runtime launch provider returned an invalid command");
  return parsed;
}

export function createRuntimeSupervisor(options: RuntimeSupervisorOptions): RuntimeSupervisor {
  const startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
  const maxRestarts = options.maxRestarts ?? 3;
  const restartWindowMs = options.restartWindowMs ?? 60_000;
  const now = options.now ?? Date.now;

  if (startupTimeoutMs <= 0 || shutdownTimeoutMs <= 0 || maxRestarts < 0 || restartWindowMs <= 0) {
    throw new Error("Invalid runtime supervisor limits");
  }

  let currentState: SupervisorState = "idle";
  let child: UtilityRuntimeProcess | null = null;
  let launchProvider: RuntimeLaunchProvider | null = null;
  let activeCommand: RuntimeStartCommand | null = null;
  let expectedExit = false;
  let restartTimes: number[] = [];
  let generation = 0;

  let startupResolve: (() => void) | null = null;
  let startupReject: ((error: Error) => void) | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;

  function diagnostic(detail: unknown): void {
    options.onDiagnostic?.(redactCredentialMaterial(detail, secretValues(activeCommand)));
  }

  function publicEvent(event: RuntimeEvent): void {
    options.onPublicEvent?.(
      redactCredentialMaterial(event, secretValues(activeCommand)) as RuntimeEvent,
    );
  }

  function clearStartup(): void {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
    startupResolve = null;
    startupReject = null;
  }

  function rejectStartup(error: Error): void {
    const reject = startupReject;
    clearStartup();
    reject?.(error);
  }

  function resolveStartup(): void {
    const resolve = startupResolve;
    clearStartup();
    resolve?.();
  }

  function openCircuit(reason: string): void {
    currentState = "circuit-open";
    diagnostic({ type: "runtime-circuit-open", reason });
  }

  async function launch(isRestart: boolean): Promise<void> {
    if (!launchProvider) throw new Error("Runtime launch provider is unavailable");
    const thisGeneration = ++generation;
    currentState = "starting";
    expectedExit = false;

    let command: RuntimeStartCommand;
    try {
      const supplied = launchProvider();
      command = safeCommand(supplied instanceof Promise ? await supplied : supplied);
    } catch (error) {
      if (thisGeneration === generation && currentState === "starting") {
        currentState = isRestart ? "circuit-open" : "idle";
      }
      throw error;
    }
    if (thisGeneration !== generation || currentState !== "starting" || !launchProvider) {
      throw new Error("Runtime startup was cancelled");
    }
    activeCommand = command;
    let process: UtilityRuntimeProcess;
    try {
      process = options.fork();
    } catch (error) {
      activeCommand = null;
      currentState = isRestart ? "circuit-open" : "idle";
      throw error;
    }
    child = process;

    const onMessage = (message: unknown): void => {
      if (thisGeneration !== generation || child !== process) return;
      const event = parseRuntimeEvent(message);
      if (!event) {
        diagnostic({ type: "invalid-runtime-message", message });
        return;
      }
      publicEvent(event);
      if (event.type === "ready" && event.requestId === command.requestId && currentState === "starting") {
        currentState = "running";
        resolveStartup();
      }
      if (event.type === "error" && event.fatal && currentState === "starting") {
        expectedExit = true;
        process.kill();
        if (child === process) child = null;
        generation += 1;
        currentState = isRestart ? "circuit-open" : "idle";
        rejectStartup(new Error("Runtime failed during startup"));
      }
    };

    const onExit = (code: number | null): void => {
      if (thisGeneration !== generation || child !== process) return;
      child = null;
      const wasExpected = expectedExit;
      expectedExit = false;
      activeCommand = null;

      if (currentState === "starting") {
        currentState = isRestart ? "circuit-open" : "idle";
        rejectStartup(new Error("Runtime exited before becoming ready"));
        return;
      }
      if (wasExpected || currentState === "stopping") {
        currentState = "idle";
        return;
      }
      if (currentState === "circuit-open") return;

      const cutoff = now() - restartWindowMs;
      restartTimes = restartTimes.filter((time) => time >= cutoff);
      diagnostic({ type: "runtime-exit", code, restartCount: restartTimes.length });
      if (restartTimes.length >= maxRestarts || !launchProvider) {
        openCircuit("restart-limit");
        return;
      }
      restartTimes.push(now());
      void launch(true).catch((error) => {
        diagnostic({ type: "runtime-restart-failed", error: String(error) });
        openCircuit("restart-failed");
      });
    };

    process.on("message", onMessage);
    process.on("exit", onExit);

    const ready = new Promise<void>((resolve, reject) => {
      startupResolve = resolve;
      startupReject = reject;
      startupTimer = setTimeout(() => {
        if (thisGeneration !== generation || currentState !== "starting") return;
        expectedExit = true;
        process.kill();
        if (child === process) child = null;
        generation += 1;
        currentState = isRestart ? "circuit-open" : "idle";
        rejectStartup(new Error("Runtime startup timed out"));
      }, startupTimeoutMs);
    });

    try {
      await process.postMessage(command);
    } catch {
      expectedExit = true;
      process.kill();
      if (child === process) child = null;
      activeCommand = null;
      generation += 1;
      currentState = isRestart ? "circuit-open" : "idle";
      rejectStartup(new Error("Runtime failed to accept startup command"));
    }
    await ready;
  }

  async function requestStop(type: "stop" | "emergency-stop"): Promise<void> {
    const process = child;
    if (!process) {
      if (currentState === "starting") {
        generation += 1;
        rejectStartup(new Error("Runtime startup was cancelled"));
      }
      if (currentState !== "circuit-open") currentState = "idle";
      return;
    }
    if (currentState === "starting") {
      generation += 1;
      rejectStartup(new Error("Runtime startup was cancelled"));
    }
    const requestId = randomUUID();
    expectedExit = true;
    currentState = "stopping";

    let finishStop!: () => void;
    const stopped = new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve();
      };
      finishStop = finish;
      const onMessage = (message: unknown): void => {
        const event = parseRuntimeEvent(message);
        if (event?.type === "stopped" && event.requestId === requestId) finish();
      };
      const onExit = (): void => finish();
      process.on("message", onMessage);
      process.on("exit", onExit);
      if (!settled) {
        timer = setTimeout(() => {
          try {
            process.kill();
          } catch {
            // A stale process handle must not escape the bounded stop path.
          } finally {
            finish();
          }
        }, shutdownTimeoutMs);
      }
    });
    try {
      await process.postMessage({ type, requestId });
      await stopped;
    } catch {
      try {
        process.kill();
      } catch {
        // State cleanup below is mandatory even if the process handle is stale.
      }
      finishStop();
    } finally {
      if (child === process) {
        try {
          process.kill();
        } catch {
          // The supervisor must still forget a child it can no longer control.
        } finally {
          child = null;
          generation += 1;
        }
      }
      activeCommand = null;
      currentState = "idle";
    }
  }

  return {
    get state() {
      return currentState;
    },

    async start(commandOrProvider) {
      if (currentState !== "idle") throw new Error(`Runtime cannot start from ${currentState}`);
      restartTimes = [];
      launchProvider =
        typeof commandOrProvider === "function" ? commandOrProvider : () => commandOrProvider;
      await launch(false);
    },

    async emergencyStop() {
      await requestStop("emergency-stop");
    },

    async shutdown() {
      launchProvider = null;
      await requestStop("stop");
    },
  };
}
