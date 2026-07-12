import { describe, expect, it, vi } from "vitest";

import {
  createRuntimeSupervisor,
  type UtilityRuntimeProcess,
} from "../src/main/runtime-supervisor";
import { parseRuntimeCommand, parseRuntimeEvent, redactCredentialMaterial } from "../src/runtime/runtime-protocol";

class FakeProcess implements UtilityRuntimeProcess {
  messages: unknown[] = [];
  killed = false;
  private listeners = new Map<string, Array<(...args: never[]) => void>>();

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  on(event: "message" | "exit", listener: (...args: never[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: "message" | "exit", value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never);
  }
}

const startCommand = {
  type: "start" as const,
  requestId: "request-1",
  credentials: { apiKey: "api-1234", secretKey: "top-secret", passphrase: "phrase" },
};

describe("runtime protocol", () => {
  it("rejects surplus and malformed protocol fields", () => {
    expect(parseRuntimeCommand(startCommand)).toEqual(startCommand);
    expect(parseRuntimeCommand({ ...startCommand, unexpected: true })).toBeNull();
    expect(parseRuntimeEvent({ type: "ready", requestId: "request-1", secret: "leak" })).toBeNull();
  });

  it("returns an exact detached command rather than forwarding attacker-controlled objects", () => {
    const input = structuredClone(startCommand);
    const parsed = parseRuntimeCommand(input);
    expect(parsed).toEqual(startCommand);
    expect(parsed).not.toBe(input);
    if (parsed?.type === "start") expect(parsed.credentials).not.toBe(input.credentials);
  });

  it("fails closed instead of throwing when hostile objects trap property access", () => {
    const hostile = new Proxy({}, {
      get: (_target, key) => key === "type" ? "start" : undefined,
      ownKeys: () => { throw new Error("trap"); },
    });
    expect(() => parseRuntimeCommand(hostile)).not.toThrow();
    expect(parseRuntimeCommand(hostile)).toBeNull();
    expect(() => parseRuntimeEvent(hostile)).not.toThrow();
    expect(parseRuntimeEvent(hostile)).toBeNull();
  });

  it("redacts credential keys, bearer tokens, and known secret values", () => {
    expect(
      redactCredentialMaterial(
        { secretKey: "top-secret", message: "failed top-secret Authorization Bearer token-123" },
        ["top-secret"],
      ),
    ).toEqual({ secretKey: "[REDACTED]", message: "failed [REDACTED] Authorization Bearer [REDACTED]" });
  });

  it("redacts one-character secrets and fails closed on cycles and oversized graphs", () => {
    expect(redactCredentialMaterial("prefix:x:suffix and Bearer abc", ["x"]))
      .toBe("prefi[REDACTED]:[REDACTED]:suffi[REDACTED] and Bearer [REDACTED]");
    const cyclic: { value: string; self?: unknown } = { value: "secret" };
    cyclic.self = cyclic;
    expect(() => redactCredentialMaterial(cyclic, ["s"])).not.toThrow();
    expect(JSON.stringify(redactCredentialMaterial(cyclic, ["s"]))).not.toContain("secret");

    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let index = 0; index < 30; index += 1) {
      deep.next = {};
      deep = deep.next as Record<string, unknown>;
    }
    expect(JSON.stringify(redactCredentialMaterial(root))).toContain("[REDACTION_LIMIT]");
  });
});

describe("runtime supervisor", () => {
  it("waits for the validated ready event", async () => {
    const process = new FakeProcess();
    const supervisor = createRuntimeSupervisor({ fork: () => process, startupTimeoutMs: 100 });
    const started = supervisor.start(startCommand);

    expect(process.messages).toEqual([startCommand]);
    process.emit("message", { type: "ready", requestId: "other" });
    expect(supervisor.state).toBe("starting");
    process.emit("message", { type: "ready", requestId: "request-1" });
    await started;
    expect(supervisor.state).toBe("running");
  });

  it("kills a runtime that misses the startup deadline", async () => {
    vi.useFakeTimers();
    const process = new FakeProcess();
    const supervisor = createRuntimeSupervisor({ fork: () => process, startupTimeoutMs: 20 });
    const started = supervisor.start(startCommand);
    void started.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(21);

    await expect(started).rejects.toThrow("timed out");
    expect(process.killed).toBe(true);
    expect(supervisor.state).toBe("idle");
    vi.useRealTimers();
  });

  it("uses graceful stop first, then enforces the shutdown deadline", async () => {
    vi.useFakeTimers();
    const process = new FakeProcess();
    const supervisor = createRuntimeSupervisor({ fork: () => process, startupTimeoutMs: 100, shutdownTimeoutMs: 20 });
    const started = supervisor.start(startCommand);
    process.emit("message", { type: "ready", requestId: "request-1" });
    await started;

    const stopping = supervisor.shutdown();
    expect(process.messages.at(-1)).toMatchObject({ type: "stop" });
    expect(process.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(21);
    await stopping;
    expect(process.killed).toBe(true);
    expect(supervisor.state).toBe("idle");
    vi.useRealTimers();
  });

  it("cancels an asynchronous launch before forking during shutdown", async () => {
    let resolveCommand!: (command: typeof startCommand) => void;
    const command = new Promise<typeof startCommand>((resolve) => {
      resolveCommand = resolve;
    });
    const fork = vi.fn(() => new FakeProcess());
    const supervisor = createRuntimeSupervisor({ fork });
    const started = supervisor.start(() => command);
    void started.catch(() => undefined);

    await supervisor.shutdown();
    resolveCommand(startCommand);
    await expect(started).rejects.toThrow("cancelled");
    expect(fork).not.toHaveBeenCalled();
    expect(supervisor.state).toBe("idle");
  });

  it.each(["shutdown", "emergencyStop"] as const)("cancels ready-wait startup during %s and terminates the child", async (method) => {
    vi.useFakeTimers();
    const process = new FakeProcess();
    const supervisor = createRuntimeSupervisor({ fork: () => process, startupTimeoutMs: 5_000, shutdownTimeoutMs: 20 });
    const started = supervisor.start(startCommand);
    void started.catch(() => undefined);

    const stopping = supervisor[method]();
    await expect(started).rejects.toThrow("cancelled");
    expect(process.messages.at(-1)).toMatchObject({ type: method === "shutdown" ? "stop" : "emergency-stop" });
    await vi.advanceTimersByTimeAsync(21);
    await stopping;
    expect(process.killed).toBe(true);
    expect(supervisor.state).toBe("idle");
    vi.useRealTimers();
  });

  it("ignores a racing ready event after shutdown begins and completes on the matching stopped event", async () => {
    const process = new FakeProcess();
    const supervisor = createRuntimeSupervisor({ fork: () => process, startupTimeoutMs: 5_000, shutdownTimeoutMs: 5_000 });
    const started = supervisor.start(startCommand);
    void started.catch(() => undefined);

    const stopping = supervisor.shutdown();
    const stopCommand = process.messages.at(-1) as { type: string; requestId: string };
    process.emit("message", { type: "ready", requestId: startCommand.requestId });
    expect(supervisor.state).toBe("stopping");
    process.emit("message", { type: "stopped", requestId: stopCommand.requestId });

    await expect(started).rejects.toThrow("cancelled");
    await stopping;
    expect(process.killed).toBe(true);
    expect(supervisor.state).toBe("idle");
  });

  it.each(["throw", "reject"] as const)("cleans up when the stop postMessage %ss", async (failure) => {
    const process = new FakeProcess();
    const originalPostMessage = process.postMessage.bind(process);
    process.postMessage = vi.fn((message) => {
      if ((message as { type?: string }).type === "stop") {
        if (failure === "throw") throw new Error("stop transport failed");
        return Promise.reject(new Error("stop transport failed"));
      }
      return originalPostMessage(message);
    });
    const supervisor = createRuntimeSupervisor({ fork: () => process, startupTimeoutMs: 100, shutdownTimeoutMs: 5_000 });
    const started = supervisor.start(startCommand);
    process.emit("message", { type: "ready", requestId: "request-1" });
    await started;

    await expect(supervisor.shutdown()).resolves.toBeUndefined();
    expect(process.killed).toBe(true);
    expect(supervisor.state).toBe("idle");
  });

  it("keeps cleanup idempotent when process exit races a rejected stop post", async () => {
    const process = new FakeProcess();
    const originalPostMessage = process.postMessage.bind(process);
    let rejectStop!: (error: Error) => void;
    process.postMessage = vi.fn((message) => {
      if ((message as { type?: string }).type === "stop") {
        originalPostMessage(message);
        return new Promise<void>((_resolve, reject) => { rejectStop = reject; });
      }
      return originalPostMessage(message);
    });
    const supervisor = createRuntimeSupervisor({ fork: () => process, startupTimeoutMs: 100, shutdownTimeoutMs: 5_000 });
    const started = supervisor.start(startCommand);
    process.emit("message", { type: "ready", requestId: "request-1" });
    await started;

    const stopping = supervisor.shutdown();
    process.emit("exit", 0);
    rejectStop(new Error("late transport rejection"));

    await expect(stopping).resolves.toBeUndefined();
    expect(supervisor.state).toBe("idle");
  });

  it("rejects surplus launch commands before forking or posting", async () => {
    const fork = vi.fn(() => new FakeProcess());
    const supervisor = createRuntimeSupervisor({ fork });
    await expect(supervisor.start({ ...startCommand, surplus: "secret" } as never)).rejects.toThrow("invalid command");
    expect(fork).not.toHaveBeenCalled();
    expect(supervisor.state).toBe("idle");
  });

  it("kills the child and recovers when posting the exact start command fails", async () => {
    const process = new FakeProcess();
    process.postMessage = vi.fn(() => { throw new Error("transport failed with top-secret"); });
    const supervisor = createRuntimeSupervisor({ fork: () => process });

    await expect(supervisor.start(startCommand)).rejects.toThrow("failed to accept startup command");
    expect(process.killed).toBe(true);
    expect(supervisor.state).toBe("idle");
  });

  it("posts a detached exact command so later provider mutation cannot cross the boundary", async () => {
    const process = new FakeProcess();
    const mutable = structuredClone(startCommand);
    const supervisor = createRuntimeSupervisor({ fork: () => process });
    const started = supervisor.start(mutable);
    mutable.credentials.secretKey = "mutated";
    expect(process.messages[0]).toEqual(startCommand);
    process.emit("message", { type: "ready", requestId: "request-1" });
    await started;
  });

  it("opens the circuit after bounded crash restarts and redacts diagnostics", async () => {
    const processes: FakeProcess[] = [];
    const diagnostics: unknown[] = [];
    const publicEvents: unknown[] = [];
    let request = 0;
    const supervisor = createRuntimeSupervisor({
      fork: () => {
        const process = new FakeProcess();
        processes.push(process);
        queueMicrotask(() => process.emit("message", { type: "ready", requestId: `request-${request}` }));
        return process;
      },
      maxRestarts: 2,
      onDiagnostic: (value) => diagnostics.push(value),
      onPublicEvent: (value) => publicEvents.push(value),
    });
    await supervisor.start(() => ({ ...startCommand, requestId: `request-${++request}` }));

    processes[0].emit("message", { type: "log", level: "error", message: "top-secret failed" });
    processes[0].emit("exit", 1);
    await vi.waitFor(() => expect(processes).toHaveLength(2));
    processes[1].emit("exit", 1);
    await vi.waitFor(() => expect(processes).toHaveLength(3));
    processes[2].emit("exit", 1);
    await vi.waitFor(() => expect(supervisor.state).toBe("circuit-open"));

    expect(JSON.stringify(diagnostics)).not.toContain("top-secret");
    expect(JSON.stringify(publicEvents)).not.toContain("top-secret");
    expect(JSON.stringify(publicEvents)).toContain("[REDACTED]");
  });
});
