import {
  parseWeexAuthStage,
  weexAuthCapabilities,
  type WeexAuthStage,
} from "@cryptobot-labs/weex-client";

type DeploymentEnvironment = Record<string, string | undefined>;

export function currentWeexAuthStage(
  environment: DeploymentEnvironment = process.env,
): WeexAuthStage {
  return parseWeexAuthStage(environment.WEEX_AUTH_STAGE);
}

export function legacyPlatformLoginEnabled(
  environment: DeploymentEnvironment = process.env,
): boolean {
  return weexAuthCapabilities(currentWeexAuthStage(environment)).legacyPlatformLogin;
}

export function manualWeexConnectionEnabled(
  environment: DeploymentEnvironment = process.env,
): boolean {
  return weexAuthCapabilities(currentWeexAuthStage(environment)).manualApiConnection;
}

export function weexOAuthIdentityReady(): false {
  // OAuth-only platform identity remains fail-closed until the WEEX application
  // is approved and the callback has a stable user-identity contract.
  return false;
}

export function webWeexOAuthEnabled(
  environment: DeploymentEnvironment = process.env,
): boolean {
  const stage = currentWeexAuthStage(environment);
  if (!weexAuthCapabilities(stage).oauthConnection) return false;
  return stage === "dual" || weexOAuthIdentityReady();
}
