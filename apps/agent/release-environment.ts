export type ReleasePlatform = "darwin" | "win32";

const REQUIRED: Record<ReleasePlatform, readonly string[]> = {
  darwin: ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID", "APPLE_SIGNING_IDENTITY"],
  win32: ["WINDOWS_CERTIFICATE_FILE", "WINDOWS_CERTIFICATE_PASSWORD"],
};

/** Fails closed before a public installer can be created without signing inputs. */
export function validateReleaseEnvironment(
  platform: ReleasePlatform,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const missing = [...REQUIRED[platform], "CBL_CONTROL_PLANE_ORIGIN"].filter((name) => !environment[name]?.trim());
  if (missing.length > 0) throw new Error(`${platform === "darwin" ? "APPLE" : "WINDOWS"} signing inputs are missing: ${missing.join(", ")}`);
  if (environment.AGENT_RELEASE_CHANNEL !== "public") throw new Error("Public release channel is not enabled");
  const origin = new URL(environment.CBL_CONTROL_PLANE_ORIGIN!);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/"
    || origin.search || origin.hash) throw new Error("CBL_CONTROL_PLANE_ORIGIN must be an HTTPS origin");
}
