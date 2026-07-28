import { productionAuthReady } from "./supabase-auth";
import { webWeexOAuthEnabled } from "./weex-auth-stage";

type DeploymentEnvironment = Record<string, string | undefined>;

export function demoModeEnabled(environment: DeploymentEnvironment = process.env): boolean {
  return environment.DEMO_MODE !== "false";
}

export function productionOAuthReady(environment: DeploymentEnvironment = process.env): boolean {
  if (!webWeexOAuthEnabled(environment)) return false;
  if (!productionAuthReady(environment)) return false;
  const secret = environment.EXECUTOR_HANDOFF_SECRET;
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 512) return false;
  try {
    const executor = new URL(environment.EXECUTOR_API_ORIGIN ?? "");
    return executor.protocol === "https:" && !executor.username && !executor.password && !executor.search && !executor.hash;
  } catch { return false; }
}

export function productionLiveReady(): false {
  // Live remains fail-closed until the formal launch gates in 規範.md are implemented and approved.
  return false;
}
