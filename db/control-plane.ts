import type { ControlPlaneDatabase } from "./index";

/** Environment-neutral D1 narrowing for runtime factories and tests. */
export function requireControlPlaneDatabase(binding: unknown): ControlPlaneDatabase {
  if (binding === null || typeof binding !== "object"
    || typeof (binding as { prepare?: unknown }).prepare !== "function"
    || typeof (binding as { batch?: unknown }).batch !== "function") {
    throw new Error("A D1-compatible control-plane binding is required");
  }
  return binding as ControlPlaneDatabase;
}
