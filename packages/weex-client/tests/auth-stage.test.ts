import { describe, expect, it } from "vitest";

import {
  parseWeexAuthStage,
  weexAuthCapabilities,
} from "../src/auth-stage";

describe("WEEX authentication rollout stage", () => {
  it("defaults missing configuration to the current transition stage", () => {
    expect(parseWeexAuthStage(undefined)).toBe("transition");
    expect(parseWeexAuthStage("")).toBe("transition");
  });

  it("maps each stage to one internally consistent capability set", () => {
    expect(weexAuthCapabilities(parseWeexAuthStage("transition"))).toEqual({
      legacyPlatformLogin: true,
      manualApiConnection: true,
      oauthConnection: false,
    });
    expect(weexAuthCapabilities(parseWeexAuthStage("dual"))).toEqual({
      legacyPlatformLogin: true,
      manualApiConnection: true,
      oauthConnection: true,
    });
    expect(weexAuthCapabilities(parseWeexAuthStage("oauth-only"))).toEqual({
      legacyPlatformLogin: false,
      manualApiConnection: false,
      oauthConnection: true,
    });
  });

  it("rejects typos instead of silently enabling a different rollout mode", () => {
    expect(() => parseWeexAuthStage("oauth")).toThrow(/WEEX_AUTH_STAGE/);
  });
});
