import type { ExecutionMode, Market } from "../contracts";

/** A routable execution environment. Paper routes only to a local paper port. */
export type ExecutionTarget =
  | { readonly market: "spot"; readonly mode: "paper" | "live" }
  | { readonly market: "futures"; readonly mode: "paper" | "live" | "futures-demo" };

export function isExecutionTarget(value: unknown): value is ExecutionTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  const keys = Object.keys(target);
  if (keys.length !== 2) return false;
  return (target.market === "spot" && (target.mode === "paper" || target.mode === "live")) ||
    (target.market === "futures" &&
      (target.mode === "paper" || target.mode === "live" || target.mode === "futures-demo"));
}

export function executionTargetFor(
  market: Market,
  mode: ExecutionMode,
): ExecutionTarget | null {
  const target = { market, mode };
  return isExecutionTarget(target) ? Object.freeze(target) : null;
}

export function sameExecutionTarget(
  left: unknown,
  right: unknown,
): boolean {
  return isExecutionTarget(left) && isExecutionTarget(right) &&
    left.market === right.market && left.mode === right.mode;
}
