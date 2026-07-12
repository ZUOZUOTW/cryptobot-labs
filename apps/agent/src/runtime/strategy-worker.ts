import { join } from "node:path";
import { Worker } from "node:worker_threads";

import type {
  SandboxEvaluation,
  SandboxEvaluationResult,
  StrategySandbox,
} from "@cryptobot-labs/trading-core";

export type StrategySandboxLike = StrategySandbox;

export type StrategySandboxFactory = () => Promise<StrategySandboxLike>;

export type StrategyWorkerRequest = SandboxEvaluation;

export type StrategyWorkerResult = SandboxEvaluationResult;

type ThreadResponse =
  | { readonly id: number; readonly ok: true; readonly result: StrategyWorkerResult }
  | { readonly id: number; readonly ok: false; readonly code: string };

type ThreadLifecycleMessage =
  | { readonly type: "ready" }
  | { readonly type: "startup-error" };

interface PendingThreadEvaluation {
  readonly resolve: (result: StrategyWorkerResult) => void;
  readonly reject: (error: Error) => void;
}

export class StrategyWorkerFault extends Error {
  readonly code: "cancelled" | "sandbox-fault" | "timeout";

  constructor(code: StrategyWorkerFault["code"]) {
    super(code === "timeout" ? "strategy sandbox timed out" : `strategy sandbox ${code}`);
    this.name = "StrategyWorkerFault";
    this.code = code;
  }
}

/** Real thread boundary used in production; terminate() remains effective if WASM stalls. */
class ThreadStrategySandbox implements StrategySandboxLike {
  readonly #worker: Worker;
  readonly #pending = new Map<number, PendingThreadEvaluation>();
  readonly #ready: Promise<void>;
  #resolveReady!: () => void;
  #rejectReady!: (error: Error) => void;
  #nextId = 1;
  #closed = false;

  constructor() {
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#worker = new Worker(join(__dirname, "strategy-thread.cjs"), {
      resourceLimits: {
        maxOldGenerationSizeMb: 24,
        maxYoungGenerationSizeMb: 8,
        stackSizeMb: 1,
      },
    });
    this.#worker.on("message", (message: unknown) => this.#settle(message));
    this.#worker.on("error", () => this.#fail(new StrategyWorkerFault("sandbox-fault")));
    this.#worker.on("exit", (code) => {
      if (!this.#closed || code !== 0) this.#fail(new StrategyWorkerFault("sandbox-fault"));
    });
  }

  async waitUntilReady(timeoutMs = 5_000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#ready,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new StrategyWorkerFault("sandbox-fault")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  evaluate(request: StrategyWorkerRequest): Promise<StrategyWorkerResult> {
    if (this.#closed) return Promise.reject(new StrategyWorkerFault("cancelled"));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#worker.postMessage({ id, request });
      } catch {
        this.#pending.delete(id);
        reject(new StrategyWorkerFault("sandbox-fault"));
      }
    });
  }

  async dispose(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#fail(new StrategyWorkerFault("cancelled"));
    await this.#worker.terminate();
  }

  #settle(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const lifecycle = message as Partial<ThreadLifecycleMessage>;
    if (lifecycle.type === "ready") {
      this.#resolveReady();
      return;
    }
    if (lifecycle.type === "startup-error") {
      this.#fail(new StrategyWorkerFault("sandbox-fault"));
      return;
    }
    const response = message as Partial<ThreadResponse>;
    if (!Number.isSafeInteger(response.id)) return;
    const id = response.id as number;
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    if (response.ok === true && "result" in response) pending.resolve(response.result as StrategyWorkerResult);
    else pending.reject(new StrategyWorkerFault("sandbox-fault"));
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #fail(error: Error): void {
    this.#rejectReady(error);
    this.#failAll(error);
  }
}

export async function createThreadStrategySandbox(): Promise<StrategySandboxLike> {
  const sandbox = new ThreadStrategySandbox();
  try {
    await sandbox.waitUntilReady();
    return sandbox;
  } catch (error) {
    await sandbox.dispose().catch(() => undefined);
    throw error;
  }
}

interface SandboxSlot {
  readonly generation: number;
  readonly sandbox: StrategySandboxLike;
}

/**
 * Owns the untrusted strategy sandbox. Requests are serialized and a sandbox is
 * never reused after cancellation, timeout, or any evaluation fault.
 *
 * This boundary deliberately has no credential or exchange-port dependency.
 */
export class StrategyWorker {
  readonly #factory: StrategySandboxFactory;
  readonly #timeoutMs: number;
  #tail: Promise<void> = Promise.resolve();
  #slot: Promise<SandboxSlot> | null = null;
  readonly #disposed = new WeakSet<StrategySandboxLike>();
  #generation = 0;
  #cancellationEpoch = 0;
  #closed = false;

  constructor(factory: StrategySandboxFactory = createThreadStrategySandbox, timeoutMs = 50) {
    if (typeof factory !== "function") throw new TypeError("sandbox factory is required");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("invalid sandbox timeout");
    }
    this.#factory = factory;
    this.#timeoutMs = timeoutMs;
  }

  evaluate(request: StrategyWorkerRequest): Promise<StrategyWorkerResult> {
    if (this.#closed) return Promise.reject(new StrategyWorkerFault("cancelled"));
    const epoch = this.#cancellationEpoch;
    const work = this.#tail.then(() => this.#evaluate(request, epoch));
    this.#tail = work.then(() => undefined, () => undefined);
    return work;
  }

  /** Cancels queued work and destroys the current sandbox generation. */
  async cancel(): Promise<void> {
    this.#cancellationEpoch += 1;
    await this.#discardCurrent();
  }

  async dispose(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancellationEpoch += 1;
    await this.#discardCurrent();
  }

  async #evaluate(
    request: StrategyWorkerRequest,
    epoch: number,
  ): Promise<StrategyWorkerResult> {
    if (this.#closed || epoch !== this.#cancellationEpoch) {
      throw new StrategyWorkerFault("cancelled");
    }

    let slot: SandboxSlot;
    try {
      slot = await this.#getSlot();
    } catch {
      throw new StrategyWorkerFault("sandbox-fault");
    }
    if (this.#closed || epoch !== this.#cancellationEpoch) {
      await this.#discard(slot);
      throw new StrategyWorkerFault("cancelled");
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new StrategyWorkerFault("timeout")), this.#timeoutMs);
    });

    try {
      const result = await Promise.race([
        slot.sandbox.evaluate({
          source: request.source,
          input: request.input,
          now: request.now,
          randomSeed: request.randomSeed,
        }),
        timeout,
      ]);
      if (this.#closed || epoch !== this.#cancellationEpoch ||
          slot.generation !== this.#generation) {
        throw new StrategyWorkerFault("cancelled");
      }
      return result;
    } catch (failure) {
      await this.#discard(slot);
      if (failure instanceof StrategyWorkerFault) throw failure;
      throw new StrategyWorkerFault("sandbox-fault");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  #getSlot(): Promise<SandboxSlot> {
    if (this.#slot === null) {
      const generation = ++this.#generation;
      const creating = this.#factory().then((sandbox) => ({ generation, sandbox }));
      this.#slot = creating;
      // A failed constructor must not poison all future attempts.
      void creating.catch(() => {
        if (this.#slot === creating) this.#slot = null;
      });
    }
    return this.#slot;
  }

  async #discardCurrent(): Promise<void> {
    const current = this.#slot;
    this.#slot = null;
    this.#generation += 1;
    if (current === null) return;
    try {
      const slot = await current;
      await this.#disposeOnce(slot.sandbox);
    } catch {
      // Disposal is best-effort. The generation fence prevents reuse.
    }
  }

  async #discard(slot: SandboxSlot): Promise<void> {
    const currentPromise = this.#slot;
    if (currentPromise !== null) {
      const current = await currentPromise.catch(() => null);
      if (this.#slot === currentPromise && current === slot) {
        this.#slot = null;
        this.#generation += 1;
      }
    }
    try {
      await this.#disposeOnce(slot.sandbox);
    } catch {
      // A broken sandbox is already fenced from future work.
    }
  }

  async #disposeOnce(sandbox: StrategySandboxLike): Promise<void> {
    if (this.#disposed.has(sandbox)) return;
    this.#disposed.add(sandbox);
    await sandbox.dispose();
  }
}
