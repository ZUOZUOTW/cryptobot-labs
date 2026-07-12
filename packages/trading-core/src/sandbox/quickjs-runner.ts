import QUICKJS_RELEASE_SYNC from "@jitl/quickjs-singlefile-cjs-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import { z } from "zod";

import type { StrategyInput, StrategySignal } from "../contracts";
import { SignalActionSchema, StrategyInputSchema, StrategySignalSchema } from "../schemas";
import {
  LIVE_SANDBOX_BUDGET,
  SandboxExecutionError,
  type ResolvedSandboxBudget,
  type SandboxBudget,
  type SandboxEvaluation,
  type SandboxEvaluationResult,
  type StrategySandbox,
} from "./contracts";
import { sha256ScriptHash } from "./script-hash";

const DEFAULT_STACK_BYTES = 512 * 1024;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_CANDLES = 10_000;
const MAX_INPUT_DEPTH = 16;
const MAX_INPUT_NODES = 200_000;
const MAX_RANDOM_SEED_BYTES = 4 * 1024;
const encoder = new TextEncoder();

const StrategyProposalSchema = z
  .strictObject({
    action: SignalActionSchema,
    reason: z.string().min(1),
    allocationRate: z.number().finite().gt(0).lte(1).optional(),
    positionEffect: z.enum(["add", "reduce"]).optional(),
    reductionRate: z.number().finite().gt(0).lte(1).optional(),
  })
  .superRefine((signal, context) => {
    if (signal.reductionRate !== undefined && signal.positionEffect !== "reduce") {
      context.addIssue({
        code: "custom",
        path: ["reductionRate"],
        message: "reductionRate requires positionEffect reduce",
      });
    }
    if (signal.positionEffect === "add" && signal.action === "close") {
      context.addIssue({
        code: "custom",
        path: ["positionEffect"],
        message: "close cannot add to a position",
      });
    }
    if (
      signal.positionEffect !== undefined &&
      signal.action !== "buy" &&
      signal.action !== "sell"
    ) {
      context.addIssue({
        code: "custom",
        path: ["positionEffect"],
        message: "positionEffect requires buy or sell",
      });
    }
  });

const DENIED_GLOBALS = [
  "Bun",
  "Deno",
  "EventSource",
  "SharedWorker",
  "WebSocket",
  "WebTransport",
  "Worker",
  "XMLHttpRequest",
  "Buffer",
  "document",
  "fetch",
  "global",
  "localStorage",
  "module",
  "navigator",
  "process",
  "require",
] as const;

function resolveBudget(budget: SandboxBudget): ResolvedSandboxBudget {
  const resolved = {
    deadlineMs: budget.deadlineMs,
    memoryBytes: budget.memoryBytes,
    outputBytes: budget.outputBytes,
    stackBytes: budget.stackBytes ?? DEFAULT_STACK_BYTES,
  };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Sandbox ${name} must be a positive safe integer`);
    }
  }
  return Object.freeze(resolved);
}

function seedToUint32(seed: string): number {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(seed)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createBootstrap(inputJson: string, now: number, randomSeed: number): string {
  return `
    "use strict";
    (() => {
      const deepFreeze = (value, seen = new Set()) => {
        if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
        if (seen.has(value)) return value;
        seen.add(value);
        for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
        return Object.freeze(value);
      };
      const input = deepFreeze(${inputJson});
      Object.defineProperty(globalThis, "__strategyInput", {
        value: input,
        writable: false,
        configurable: false,
        enumerable: false
      });

      const NativeDate = Date;
      const DeterministicDate = function (...args) {
        if (!new.target) return new NativeDate(${now}).toString();
        return Reflect.construct(NativeDate, args.length === 0 ? [${now}] : args, new.target);
      };
      Object.setPrototypeOf(DeterministicDate, NativeDate);
      DeterministicDate.prototype = NativeDate.prototype;
      Object.defineProperty(DeterministicDate, "now", { value: () => ${now}, writable: false, configurable: false });
      Object.defineProperty(globalThis, "Date", {
        value: DeterministicDate,
        writable: false,
        configurable: false,
        enumerable: false
      });

      let randomState = ${randomSeed} >>> 0;
      const deterministicRandom = () => {
        randomState = (randomState + 0x6D2B79F5) | 0;
        let value = randomState;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
      Object.defineProperty(Math, "random", { value: deterministicRandom, writable: false, configurable: false });

      const utf8ByteLength = (value) => {
        let bytes = 0;
        for (let index = 0; index < value.length; index += 1) {
          const code = value.charCodeAt(index);
          if (code < 0x80) bytes += 1;
          else if (code < 0x800) bytes += 2;
          else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length &&
            value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF) {
            bytes += 4;
            index += 1;
          } else bytes += 3;
        }
        return bytes;
      };
      Object.defineProperty(globalThis, "__sandboxSerializeOutput", {
        value: (value, maxBytes) => {
          const serialized = JSON.stringify(value);
          if (typeof serialized !== "string") return Object.freeze({ kind: "invalid" });
          if (utf8ByteLength(serialized) > maxBytes) return Object.freeze({ kind: "too-large" });
          return Object.freeze({ kind: "ok", serialized });
        },
        writable: false,
        configurable: false,
        enumerable: false
      });

      for (const name of ${JSON.stringify(DENIED_GLOBALS)}) {
        Object.defineProperty(globalThis, name, {
          value: undefined,
          writable: false,
          configurable: false,
          enumerable: false
        });
      }
    })();
  `;
}

function assertWithinDeadline(deadlineAt: number): void {
  if (performance.now() >= deadlineAt) {
    throw new SandboxExecutionError("deadline-exceeded", "Strategy execution deadline exceeded");
  }
}

function assertBoundedInput(value: unknown, deadlineAt: number): void {
  const pending: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  const seen = new WeakSet<object>();
  let estimatedBytes = 0;
  let nodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > MAX_INPUT_NODES || current.depth > MAX_INPUT_DEPTH) {
      throw new SandboxExecutionError("resource-exhausted", "Strategy input exceeds the configured structure limit");
    }
    if ((nodes & 0xff) === 0) assertWithinDeadline(deadlineAt);

    const item = current.value;
    if (typeof item === "string") {
      if (item.length > MAX_INPUT_BYTES) {
        throw new SandboxExecutionError("resource-exhausted", "Strategy input exceeds the configured byte limit");
      }
      estimatedBytes += encoder.encode(item).byteLength + 2;
    } else if (item === null || item === undefined || typeof item === "boolean" || typeof item === "number") {
      estimatedBytes += 16;
    } else if (typeof item === "object") {
      if (seen.has(item)) {
        throw new SandboxExecutionError("invalid-input", "Strategy input must not contain cycles");
      }
      seen.add(item);
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null && !Array.isArray(item)) {
        throw new SandboxExecutionError("invalid-input", "Strategy input must contain plain JSON values");
      }

      const descriptors = Object.getOwnPropertyDescriptors(item);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== "string" || (Array.isArray(item) && key === "length")) continue;
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor)) {
          throw new SandboxExecutionError("invalid-input", "Strategy input must not contain accessors");
        }
        if (key.length > MAX_INPUT_BYTES) {
          throw new SandboxExecutionError("resource-exhausted", "Strategy input exceeds the configured byte limit");
        }
        estimatedBytes += encoder.encode(key).byteLength + 4;
        pending.push({ depth: current.depth + 1, value: descriptor.value });
      }
    } else {
      throw new SandboxExecutionError("invalid-input", "Strategy input must contain plain JSON values");
    }

    if (estimatedBytes > MAX_INPUT_BYTES) {
      throw new SandboxExecutionError("resource-exhausted", "Strategy input exceeds the configured byte limit");
    }
  }
  assertWithinDeadline(deadlineAt);
}

function normalizeInput(input: SandboxEvaluation, deadlineAt: number): StrategyInput {
  assertWithinDeadline(deadlineAt);
  if (!Number.isFinite(input.now)) {
    throw new SandboxExecutionError("invalid-input", "Sandbox time must be finite");
  }
  if (typeof input.source !== "string") {
    throw new SandboxExecutionError("invalid-input", "Strategy source must not be empty");
  }
  if (input.source.length > MAX_SOURCE_BYTES || encoder.encode(input.source).byteLength > MAX_SOURCE_BYTES) {
    throw new SandboxExecutionError("resource-exhausted", "Strategy source exceeds the configured byte limit");
  }
  if (input.source.trim().length === 0) {
    throw new SandboxExecutionError("invalid-input", "Strategy source must not be empty");
  }
  if (typeof input.randomSeed !== "string") {
    throw new SandboxExecutionError("invalid-input", "Random seed must be a string");
  }
  if (
    input.randomSeed.length > MAX_RANDOM_SEED_BYTES ||
    encoder.encode(input.randomSeed).byteLength > MAX_RANDOM_SEED_BYTES
  ) {
    throw new SandboxExecutionError("resource-exhausted", "Random seed exceeds the configured byte limit");
  }
  assertBoundedInput(input.input, deadlineAt);
  if (!input.input || typeof input.input !== "object" || !Array.isArray(input.input.candles)) {
    throw new SandboxExecutionError("invalid-input", "Strategy input failed validation");
  }
  if (input.input.candles.length > MAX_INPUT_CANDLES) {
    throw new SandboxExecutionError("resource-exhausted", "Strategy input exceeds the configured structure limit");
  }

  const parsed = StrategyInputSchema.safeParse(input.input);
  assertWithinDeadline(deadlineAt);
  if (!parsed.success) {
    throw new SandboxExecutionError("invalid-input", "Strategy input failed validation");
  }
  return { ...parsed.data, now: input.now };
}

function safeErrorMessage(value: unknown): string {
  if (value && typeof value === "object") {
    const candidate = value as { message?: unknown; name?: unknown };
    const name = typeof candidate.name === "string" ? candidate.name : "Error";
    const message = typeof candidate.message === "string" ? candidate.message : "execution failed";
    return `${name}: ${message}`.slice(0, 512);
  }
  return "Strategy execution failed";
}

function classifyExecutionFailure(interrupted: boolean, message: string): SandboxExecutionError {
  if (interrupted) {
    return new SandboxExecutionError("deadline-exceeded", "Strategy execution deadline exceeded");
  }
  if (/out of memory|memory limit|stack overflow|stack limit/i.test(message)) {
    return new SandboxExecutionError("resource-exhausted", "Strategy resource limit exceeded");
  }
  return new SandboxExecutionError("execution-failed", message);
}

class QuickJsStrategySandbox implements StrategySandbox {
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly quickJs: Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>>,
    private readonly budget: ResolvedSandboxBudget,
  ) {}

  evaluate(input: SandboxEvaluation): Promise<SandboxEvaluationResult> {
    if (this.disposed) {
      return Promise.reject(new SandboxExecutionError("disposed", "Strategy sandbox is disposed"));
    }

    const startedAt = performance.now();
    const deadlineAt = startedAt + this.budget.deadlineMs;
    const evaluation = this.queue.then(() => {
      if (this.disposed) {
        throw new SandboxExecutionError("disposed", "Strategy sandbox is disposed");
      }
      return this.evaluateIsolated(input, startedAt, deadlineAt);
    });
    this.queue = evaluation.then(
      () => undefined,
      () => undefined,
    );
    return evaluation;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.queue;
  }

  private async evaluateIsolated(
    input: SandboxEvaluation,
    startedAt: number,
    deadlineAt: number,
  ): Promise<SandboxEvaluationResult> {
    const normalizedInput = normalizeInput(input, deadlineAt);
    const inputJson = JSON.stringify(normalizedInput);
    if (encoder.encode(inputJson).byteLength > MAX_INPUT_BYTES) {
      throw new SandboxExecutionError("resource-exhausted", "Strategy input exceeds the configured byte limit");
    }
    assertWithinDeadline(deadlineAt);
    const scriptHash = await sha256ScriptHash(input.source);
    assertWithinDeadline(deadlineAt);
    let interrupted = false;

    const runtime = this.quickJs.newRuntime();
    runtime.setMemoryLimit(this.budget.memoryBytes);
    runtime.setMaxStackSize(this.budget.stackBytes);
    runtime.setInterruptHandler(() => {
      const shouldInterrupt = performance.now() >= deadlineAt;
      interrupted ||= shouldInterrupt;
      return shouldInterrupt;
    });

    const context = runtime.newContext();
    try {
      const bootstrapResult = context.evalCode(createBootstrap(inputJson, input.now, seedToUint32(input.randomSeed)));
      if (bootstrapResult.error) {
        const dumped = context.dump(bootstrapResult.error);
        bootstrapResult.error.dispose();
        throw classifyExecutionFailure(interrupted, safeErrorMessage(dumped));
      }
      bootstrapResult.value.dispose();

      const moduleResult = context.evalCode(input.source, `strategy-${scriptHash}.mjs`, { type: "module" });
      if (moduleResult.error) {
        const dumped = context.dump(moduleResult.error);
        moduleResult.error.dispose();
        throw classifyExecutionFailure(interrupted, safeErrorMessage(dumped));
      }

      const moduleExports = moduleResult.value;
      try {
        const strategy = context.getProp(moduleExports, "default");
        try {
          const sandboxInput = context.getProp(context.global, "__strategyInput");
          try {
            const callResult = context.callFunction(strategy, context.undefined, sandboxInput);
            if (callResult.error) {
              const dumped = context.dump(callResult.error);
              callResult.error.dispose();
              throw classifyExecutionFailure(interrupted, safeErrorMessage(dumped));
            }

            const resultHandle = callResult.value;
            let serialized: string;
            try {
              const serializer = context.getProp(context.global, "__sandboxSerializeOutput");
              try {
                const outputLimit = context.newNumber(this.budget.outputBytes);
                try {
                  const serializationResult = context.callFunction(
                    serializer,
                    context.undefined,
                    resultHandle,
                    outputLimit,
                  );
                  if (serializationResult.error) {
                    const dumped = context.dump(serializationResult.error);
                    serializationResult.error.dispose();
                    throw classifyExecutionFailure(interrupted, safeErrorMessage(dumped));
                  }

                  const envelope = serializationResult.value;
                  try {
                    const kindHandle = context.getProp(envelope, "kind");
                    let kind: unknown;
                    try {
                      kind = context.dump(kindHandle);
                    } finally {
                      kindHandle.dispose();
                    }
                    if (kind === "too-large") {
                      throw new SandboxExecutionError(
                        "output-limit-exceeded",
                        "Strategy output exceeds the configured byte limit",
                      );
                    }
                    if (kind !== "ok") {
                      throw new SandboxExecutionError("invalid-signal", "Strategy must return a signal object");
                    }

                    const serializedHandle = context.getProp(envelope, "serialized");
                    try {
                      const dumped = context.dump(serializedHandle);
                      if (typeof dumped !== "string") {
                        throw new SandboxExecutionError("invalid-signal", "Strategy must return a signal object");
                      }
                      serialized = dumped;
                    } finally {
                      serializedHandle.dispose();
                    }
                  } finally {
                    envelope.dispose();
                  }
                } finally {
                  outputLimit.dispose();
                }
              } finally {
                serializer.dispose();
              }
            } finally {
              resultHandle.dispose();
            }

            let dumped: unknown;
            try {
              dumped = JSON.parse(serialized);
            } catch {
              throw new SandboxExecutionError("invalid-signal", "Strategy returned an invalid signal");
            }

            const proposal = StrategyProposalSchema.safeParse(dumped);
            if (!proposal.success) {
              throw new SandboxExecutionError("invalid-signal", "Strategy returned an invalid signal");
            }

            const signal: StrategySignal = StrategySignalSchema.parse({
              id: `sandbox-${scriptHash.slice(0, 16)}-${input.now}`,
              createdAt: input.now,
              ...proposal.data,
            });
            const durationMs = performance.now() - startedAt;
            if (interrupted || durationMs > this.budget.deadlineMs) {
              throw new SandboxExecutionError("deadline-exceeded", "Strategy execution deadline exceeded");
            }
            return { signal, scriptHash, durationMs };
          } finally {
            sandboxInput.dispose();
          }
        } finally {
          strategy.dispose();
        }
      } finally {
        moduleExports.dispose();
      }
    } catch (error) {
      if (error instanceof SandboxExecutionError) throw error;
      throw classifyExecutionFailure(interrupted, safeErrorMessage(error));
    } finally {
      context.dispose();
      runtime.dispose();
    }
  }
}

export async function createQuickJsStrategySandbox(
  budget: SandboxBudget = LIVE_SANDBOX_BUDGET,
): Promise<StrategySandbox> {
  const resolvedBudget = resolveBudget(budget);
  const quickJs = await newQuickJSWASMModuleFromVariant(QUICKJS_RELEASE_SYNC);
  return new QuickJsStrategySandbox(quickJs, resolvedBudget);
}
