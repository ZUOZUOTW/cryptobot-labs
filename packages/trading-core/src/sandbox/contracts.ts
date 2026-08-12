import type { StrategyInput, StrategySignal } from "../contracts";

export interface SandboxBudget {
  readonly deadlineMs: number;
  readonly memoryBytes: number;
  readonly outputBytes: number;
  readonly stackBytes?: number;
}

export interface ResolvedSandboxBudget {
  readonly deadlineMs: number;
  readonly memoryBytes: number;
  readonly outputBytes: number;
  readonly stackBytes: number;
}

export interface SandboxEvaluation {
  readonly source: string;
  readonly input: Readonly<StrategyInput>;
  readonly now: number;
  readonly randomSeed: string;
}

export interface SandboxEvaluationResult {
  readonly signal: StrategySignal;
  readonly scriptHash: string;
  readonly durationMs: number;
}

export interface StrategySandbox {
  evaluate(input: SandboxEvaluation): Promise<SandboxEvaluationResult>;
  dispose(): Promise<void>;
}

export type SandboxErrorCode =
  | "deadline-exceeded"
  | "disposed"
  | "execution-failed"
  | "invalid-input"
  | "invalid-signal"
  | "output-limit-exceeded"
  | "resource-exhausted";

export class SandboxExecutionError extends Error {
  readonly code: SandboxErrorCode;

  constructor(code: SandboxErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxExecutionError";
    this.code = code;
  }
}

export const LIVE_SANDBOX_BUDGET: ResolvedSandboxBudget = Object.freeze({
  deadlineMs: 50,
  memoryBytes: 8 * 1024 * 1024,
  stackBytes: 512 * 1024,
  outputBytes: 16 * 1024,
});

export const BACKTEST_SANDBOX_BUDGET: ResolvedSandboxBudget = Object.freeze({
  ...LIVE_SANDBOX_BUDGET,
  deadlineMs: 250,
});

/** Maximum cumulative QuickJS execution time allowed for one evidence run. */
export const BACKTEST_SANDBOX_TOTAL_BUDGET_MS = 5_000;
