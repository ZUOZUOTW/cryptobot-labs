import { parseRuntimeCommand, type RuntimeCommand, type RuntimeEvent } from "./runtime-protocol";

export interface RuntimeHostPort {
  onMessage(listener: (message: unknown) => void): () => void;
  postMessage(message: RuntimeEvent): void;
}

export interface RuntimeHandlers {
  start(command: Extract<RuntimeCommand, { type: "start" }>): void | Promise<void>;
  stop(command: Extract<RuntimeCommand, { type: "stop" | "emergency-stop" }>): void | Promise<void>;
}

/** Attach the narrow utility-process protocol. Trading behavior is injected later. */
export function attachRuntimeHost(port: RuntimeHostPort, handlers: RuntimeHandlers): () => void {
  return port.onMessage(async (message) => {
    const command = parseRuntimeCommand(message);
    if (!command) {
      port.postMessage({ type: "error", code: "INVALID_PROTOCOL", message: "Rejected invalid runtime command", fatal: false });
      return;
    }
    try {
      if (command.type === "start") {
        await handlers.start(command);
        port.postMessage({ type: "ready", requestId: command.requestId });
      } else {
        await handlers.stop(command);
        port.postMessage({ type: "stopped", requestId: command.requestId });
      }
    } catch {
      port.postMessage({ type: "error", code: "RUNTIME_FAILURE", message: "Runtime operation failed", fatal: true });
    }
  });
}

if (process.parentPort) {
  const port = process.parentPort;
  attachRuntimeHost({
    onMessage(listener) {
      const handler = (event: Electron.MessageEvent) => listener(event.data);
      port.on("message", handler);
      return () => port.off("message", handler);
    },
    postMessage(message) { port.postMessage(message); },
  }, {
    async start() { throw new Error("Trading runtime is unavailable until the signed control client is configured"); },
    async stop() { /* A non-started runtime has no trading work to unwind. */ },
  });
}
