import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import { validateReleaseEnvironment } from "../apps/agent/release-environment";

describe("Agent release gate", () => {
  it("refuses public releases without platform signing inputs", () => {
    expect(() => validateReleaseEnvironment("darwin", { AGENT_RELEASE_CHANNEL: "public" })).toThrow(/APPLE/);
    expect(() => validateReleaseEnvironment("win32", { AGENT_RELEASE_CHANNEL: "public" })).toThrow(/WINDOWS/);
  });

  it("requires an explicit public channel even when secrets are present", () => {
    expect(() => validateReleaseEnvironment("darwin", { APPLE_ID: "a", APPLE_APP_SPECIFIC_PASSWORD: "b",
      APPLE_TEAM_ID: "c", APPLE_SIGNING_IDENTITY: "d", CBL_CONTROL_PLANE_ORIGIN: "https://labs.example/",
      CBL_WEEX_BROKER_ID: "WEEX111162" })).toThrow(/channel/);
  });

  it("accepts only complete platform-specific signing environments", () => {
    expect(() => validateReleaseEnvironment("darwin", { AGENT_RELEASE_CHANNEL: "public", APPLE_ID: "a",
      APPLE_APP_SPECIFIC_PASSWORD: "b", APPLE_TEAM_ID: "c", APPLE_SIGNING_IDENTITY: "d",
      CBL_CONTROL_PLANE_ORIGIN: "https://labs.example/", CBL_WEEX_BROKER_ID: "WEEX111162" })).not.toThrow();
    expect(() => validateReleaseEnvironment("win32", { AGENT_RELEASE_CHANNEL: "public",
      WINDOWS_CERTIFICATE_FILE: "agent-signing.pfx", WINDOWS_CERTIFICATE_PASSWORD: "b",
      CBL_CONTROL_PLANE_ORIGIN: "https://labs.example/", CBL_WEEX_BROKER_ID: "WEEX111162" })).not.toThrow();
    expect(() => validateReleaseEnvironment("win32", { AGENT_RELEASE_CHANNEL: "public",
      WINDOWS_CERTIFICATE_FILE: "agent-signing.pfx", WINDOWS_CERTIFICATE_PASSWORD: "b",
      CBL_CONTROL_PLANE_ORIGIN: "http://labs.example/", CBL_WEEX_BROKER_ID: "WEEX111162" })).toThrow(/HTTPS/);
    expect(() => validateReleaseEnvironment("win32", { AGENT_RELEASE_CHANNEL: "public",
      WINDOWS_CERTIFICATE_FILE: "agent-signing.pfx", WINDOWS_CERTIFICATE_PASSWORD: "b",
      CBL_CONTROL_PLANE_ORIGIN: "https://labs.example/", CBL_WEEX_BROKER_ID: "WEEX1111620" })).toThrow(/broker id/);
  });

  it("configures hardened fuses and never embeds signing secrets", async () => {
    const config = await readFile("apps/agent/forge.config.ts", "utf8");
    expect(config).toContain("EnableEmbeddedAsarIntegrityValidation");
    expect(config).toContain("OnlyLoadAppFromAsar");
    expect(config).toContain("EnableNodeOptionsEnvironmentVariable");
    expect(config).toContain('execFileSync("codesign"');
    expect(config).toContain('"--sign", "-"');
    expect(config).toContain("packagedMacApps(result.outputPaths)");
    expect(config).not.toMatch(/BEGIN CERTIFICATE|apple-id-password|certificateBase64\s*:/i);
  });

  it("verifies the final macOS bundle signature even for unsigned internal-test archives",async()=>{
    const verifier=await readFile("scripts/verify-agent-artifact.mjs","utf8");
    expect(verifier).toContain("await verifyMacArchives(false)");
    expect(verifier).toContain('["--verify", "--deep", "--strict"');
  });
});
