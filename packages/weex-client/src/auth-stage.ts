export const WEEX_AUTH_STAGES = ["transition", "dual", "oauth-only"] as const;

export type WeexAuthStage = typeof WEEX_AUTH_STAGES[number];
export type WeexCredentialSource = "manual" | "oauth";

export interface WeexAuthCapabilities {
  readonly legacyPlatformLogin: boolean;
  readonly manualApiConnection: boolean;
  readonly oauthConnection: boolean;
}

const STAGES = new Set<string>(WEEX_AUTH_STAGES);

export function parseWeexAuthStage(value: string | undefined): WeexAuthStage {
  if (value === undefined || value === "") return "transition";
  if (!STAGES.has(value)) {
    throw new Error("WEEX_AUTH_STAGE must be transition, dual, or oauth-only");
  }
  return value as WeexAuthStage;
}

export function weexAuthCapabilities(stage: WeexAuthStage): WeexAuthCapabilities {
  return Object.freeze({
    legacyPlatformLogin: stage !== "oauth-only",
    manualApiConnection: stage !== "oauth-only",
    oauthConnection: stage !== "transition",
  });
}
