import { createControlPlaneDatabase, type ControlPlaneDatabase } from "./index";

/** Environment-neutral D1 narrowing for runtime factories and tests. */
export function requireControlPlaneDatabase(binding: unknown, databaseUrl?: unknown): ControlPlaneDatabase {
  if (binding === null || typeof binding !== "object"
    || typeof (binding as { prepare?: unknown }).prepare !== "function"
    || typeof (binding as { batch?: unknown }).batch !== "function") {
    return createControlPlaneDatabase(binding, databaseUrl);
  }
  return binding as ControlPlaneDatabase;
}
