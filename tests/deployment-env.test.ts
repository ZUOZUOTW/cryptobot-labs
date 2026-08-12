// @vitest-environment node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { getSupabaseAuthConfig } from "../lib/server/supabase-auth";

const execFileAsync = promisify(execFile);

const runChecker = async (environment: Record<string, string | undefined>) => {
  const inheritedEnvironment = { ...process.env };
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete inheritedEnvironment[key];
    else inheritedEnvironment[key] = value;
  }
  try {
    const result = await execFileAsync(process.execPath, ["scripts/check-deployment-env.mjs"], {
      env: inheritedEnvironment,
    });
    return { status: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string; stdout?: string };
    return { status: failure.code ?? 1, stderr: failure.stderr ?? "", stdout: failure.stdout ?? "" };
  }
};

describe("deployment environment gate", () => {
  it("accepts only an explicit mode and an origin-only HTTPS public URL", async () => {
    await expect(runChecker({ DEMO_MODE: "true", PUBLIC_ORIGIN: "https://www.cryptobotlabs.app" }))
      .resolves.toMatchObject({ status: 0 });

    for (const environment of [
      { DEMO_MODE: "true", PUBLIC_ORIGIN: undefined },
      { DEMO_MODE: "true", PUBLIC_ORIGIN: "http://attacker.example" },
      { DEMO_MODE: "true", PUBLIC_ORIGIN: "https://user:pass@example.com" },
      { DEMO_MODE: "true", PUBLIC_ORIGIN: "https://example.com/path" },
      { DEMO_MODE: "maybe", PUBLIC_ORIGIN: "https://example.com" },
    ]) {
      const result = await runChecker(environment);
      expect(result.status, JSON.stringify(environment)).not.toBe(0);
      expect(result.stderr).toContain("Deployment environment check failed");
    }
  });

  it("requires the server-only Supabase bindings before a formal production build", async () => {
    const production = {
      AUTH_COOKIE_SECRET: "a".repeat(32),
      DEMO_MODE: "false",
      PUBLIC_ORIGIN: "https://www.cryptobotlabs.app",
      SUPABASE_DATABASE_URL: "postgresql://server-only.example/database",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example_value",
      SUPABASE_URL: "https://project.supabase.co",
    };
    await expect(runChecker(production)).resolves.toMatchObject({ status: 0 });

    for (const key of [
      "AUTH_COOKIE_SECRET",
      "SUPABASE_DATABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_URL",
    ] as const) {
      const result = await runChecker({ ...production, [key]: undefined });
      expect(result.status, key).not.toBe(0);
      expect(result.stderr).toContain(key);
    }

    for (const [key, value] of [
      ["SUPABASE_URL", "not-a-url"],
      ["SUPABASE_URL", "http://project.supabase.co"],
      ["SUPABASE_URL", "https://project.supabase.co/auth"],
      ["SUPABASE_PUBLISHABLE_KEY", "short"],
      ["SUPABASE_PUBLISHABLE_KEY", "sb_publishable invalid key"],
      ["SUPABASE_PUBLISHABLE_KEY", "sb_secret_elevated_server_credential"],
      ["SUPABASE_PUBLISHABLE_KEY", "not_a_publishable_key_but_long_enough"],
    ] as const) {
      const result = await runChecker({ ...production, [key]: value });
      expect(result.status, `${key}=${value}`).not.toBe(0);
      expect(result.stderr).toContain(key);
    }
  });

  it("uses the same Supabase URL and publishable-key boundary at build time and runtime", async () => {
    const production = {
      AUTH_COOKIE_SECRET: "a".repeat(32),
      DEMO_MODE: "false",
      PUBLIC_ORIGIN: "https://www.cryptobotlabs.app",
      SUPABASE_DATABASE_URL: "postgresql://server-only.example/database",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example_value",
      SUPABASE_URL: "https://project.supabase.co",
    };
    const invalidBindings = [
      ["SUPABASE_URL", "http://localhost:54321"],
      ["SUPABASE_URL", "https://user:pass@project.supabase.co"],
      ["SUPABASE_URL", "https://project.supabase.co/auth/v1"],
      ["SUPABASE_URL", "https://project.supabase.co?redirect=attacker"],
      ["SUPABASE_PUBLISHABLE_KEY", "sb_secret_elevated_server_credential"],
      ["SUPABASE_PUBLISHABLE_KEY", "eyJhbGciOiJIUzI1NiJ9.legacy-anon-jwt"],
      ["SUPABASE_PUBLISHABLE_KEY", "publishable_but_missing_supabase_prefix"],
    ] as const;

    for (const [key, value] of invalidBindings) {
      const candidate = { ...production, [key]: value };
      const buildCheck = await runChecker(candidate);
      expect(buildCheck.status, `build accepted ${key}=${value}`).not.toBe(0);
      expect(() => getSupabaseAuthConfig(candidate), `runtime accepted ${key}=${value}`).toThrow();
    }

    const paddedKey = { ...production, SUPABASE_PUBLISHABLE_KEY: "  sb_publishable_example_value  " };
    await expect(runChecker(paddedKey)).resolves.toMatchObject({ status: 0 });
    expect(getSupabaseAuthConfig(paddedKey).publishableKey).toBe("sb_publishable_example_value");
  });
});
