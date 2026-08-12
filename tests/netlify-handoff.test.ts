// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  auditNetlifyRepository,
  FORBIDDEN_NETLIFY_ENVIRONMENT_KEYS,
  NETLIFY_ENVIRONMENT_CONTRACT,
  redactNetlifyRemoteState,
} from "../scripts/check-netlify-handoff.mjs";

const validSite = {
  account_id: "private-account-id",
  build_settings: {
    cmd: "node scripts/check-deployment-env.mjs && next build",
    dir: ".next",
    provider: "github",
    repo_branch: "main",
    repo_url: "https://github.com/ZUOZUOTW/cryptobot-labs.git",
  },
  custom_domain: "www.cryptobotlabs.app",
  domain_aliases: [],
  id: "private-site-id",
  name: "cryptobot-labs",
  published_deploy: { id: "private-deploy-id" },
  ssl: true,
  ssl_url: "https://www.cryptobotlabs.app",
  state: "current",
};

const validEnvironmentValues: Record<string, string> = {
  AUTH_COOKIE_SECRET: "auth-cookie-secret-is-at-least-thirty-two-bytes",
  DEMO_MODE: "false",
  EXECUTOR_API_ORIGIN: "https://executor.cryptobotlabs.app",
  EXECUTOR_HANDOFF_SECRET: "executor-handoff-secret-is-at-least-thirty-two-bytes",
  NEXT_PUBLIC_EXECUTOR_EGRESS_IP: "203.0.113.42",
  PUBLIC_ORIGIN: "https://www.cryptobotlabs.app",
  SUPABASE_DATABASE_URL: "postgresql://cryptobot_netlify:database-password-must-not-leak@db.supabase.co:5432/postgres",
  SUPABASE_PUBLISHABLE_KEY: ["sb", "publishable", "unit", "fixture", "value", "1234567890"].join("_"),
  SUPABASE_URL: "https://project-ref.supabase.co",
  WEEX_AUTH_STAGE: "transition",
};

const validEnvironment = Object.entries(NETLIFY_ENVIRONMENT_CONTRACT).map(([key, contract]) => ({
  is_secret: contract.secret,
  key,
  scopes: contract.scopes,
  updated_by: { email: "private-operator@example.com" },
  values: [{ context: "production", id: "private-value-id", value: validEnvironmentValues[key] }],
}));

describe("Netlify-to-WEEX handoff preflight", () => {
  it("keeps the committed deployment contract transfer-ready", async () => {
    const result = await auditNetlifyRepository();

    expect(result.ok, result.issues.join("\n")).toBe(true);
    expect(result.requiredEnvironmentKeys).toEqual(Object.keys(NETLIFY_ENVIRONMENT_CONTRACT).sort());
    expect(result.forbiddenEnvironmentKeys).toEqual([...FORBIDDEN_NETLIFY_ENVIRONMENT_KEYS]);
  });

  it("prints only a redacted remote inventory and stable fingerprints", () => {
    const result = redactNetlifyRemoteState({
      ...validSite,
      build_settings: {
        ...validSite.build_settings,
        cmd: "INLINE_TOKEN=must-not-leak node scripts/check-deployment-env.mjs && next build",
      },
    }, validEnvironment);
    const output = JSON.stringify(result);

    expect(result.ok, result.issues.join("\n")).toBe(true);
    expect(result.project.siteFingerprint).toMatch(/^[a-f0-9]{12}$/u);
    expect(result.project.accountFingerprint).toMatch(/^[a-f0-9]{12}$/u);
    expect(output).not.toContain("private-site-id");
    expect(output).not.toContain("private-account-id");
    expect(output).not.toContain("private-deploy-id");
    expect(output).not.toContain("private-operator@example.com");
    expect(output).not.toContain("database-password-must-not-leak");
    expect(output).not.toContain("executor-handoff-secret-is-at-least-thirty-two-bytes");
    expect(output).not.toContain(validEnvironmentValues.SUPABASE_PUBLISHABLE_KEY);
    expect(output).not.toContain("must-not-leak");
    expect(result.project.buildCommandPresent).toBe(true);
    expect(result.project.buildCommandMatchesContract).toBe(true);
    expect(result.project.buildCommandFingerprint).toMatch(/^[a-f0-9]{12}$/u);
  });

  it("fails closed on missing production bindings and executor-only secrets", () => {
    const incomplete = validEnvironment.filter((entry) => entry.key !== "SUPABASE_DATABASE_URL");
    incomplete.push({
      is_secret: true,
      key: "WEEX_CLIENT_SECRET",
      scopes: ["builds", "functions"],
      updated_by: { email: "private-operator@example.com" },
      values: [{ context: "production", id: "private-value-id", value: "must-not-leak" }],
    });

    const result = redactNetlifyRemoteState(validSite, incomplete);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("missing Netlify environment variable: SUPABASE_DATABASE_URL");
    expect(result.issues).toContain("executor-only variable must be removed from Netlify: WEEX_CLIENT_SECRET");
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("fails closed when a required production context contains no non-empty value", () => {
    const blankEnvironment = validEnvironment.map((entry) => entry.key === "AUTH_COOKIE_SECRET"
      ? { ...entry, values: [{ context: "production", value: "   " }] }
      : entry);

    const result = redactNetlifyRemoteState(validSite, blankEnvironment);

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("AUTH_COOKIE_SECRET has no non-empty production or all-context value");
    expect(JSON.stringify(result)).not.toContain('"value"');
  });

  it("rejects a blank production override even when the all-context value is valid", () => {
    const environment = validEnvironment.map((entry) => entry.key === "AUTH_COOKIE_SECRET"
      ? {
        ...entry,
        values: [
          { context: "all", value: validEnvironmentValues.AUTH_COOKIE_SECRET },
          { context: "production", value: "" },
        ],
      }
      : entry);

    const result = redactNetlifyRemoteState(validSite, environment);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("AUTH_COOKIE_SECRET has no non-empty production or all-context value");
  });

  it("accepts the scoped Supavisor session-pooler username", () => {
    const environment = validEnvironment.map((entry) => entry.key === "SUPABASE_DATABASE_URL"
      ? {
        ...entry,
        values: [{
          context: "production",
          value: "postgresql://cryptobot_netlify.project-ref:private-password@pooler.supabase.com:5432/postgres",
        }],
      }
      : entry);

    const result = redactNetlifyRemoteState(validSite, environment);
    expect(result.ok, result.issues.join("\n")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private-password");
  });

  it("rejects placeholder and malformed production values without echoing any value", () => {
    const invalidValues: Record<string, string> = {
      AUTH_COOKIE_SECRET: "replace-with-auth-cookie-secret-value-now",
      DEMO_MODE: "true",
      EXECUTOR_API_ORIGIN: "https://www.cryptobotlabs.app",
      EXECUTOR_HANDOFF_SECRET: "too-short",
      NEXT_PUBLIC_EXECUTOR_EGRESS_IP: "999.12.34.56",
      PUBLIC_ORIGIN: "https://cryptobotlabs.app",
      SUPABASE_DATABASE_URL: "postgresql://postgres:private-db-sentinel@db.supabase.co:5432/postgres",
      SUPABASE_PUBLISHABLE_KEY: "anon-key-private-sentinel",
      SUPABASE_URL: "https://project-ref.supabase.co/path-private-sentinel",
      WEEX_AUTH_STAGE: "oauth-only-private-sentinel",
    };

    for (const [key, invalidValue] of Object.entries(invalidValues)) {
      const environment = validEnvironment.map((entry) => entry.key === key
        ? { ...entry, values: [{ context: "all", value: invalidValue }] }
        : entry);
      const result = redactNetlifyRemoteState(validSite, environment);
      const serializedIssues = JSON.stringify(result.issues);

      expect(result.ok, key).toBe(false);
      expect(result.issues, key).toContain(`${key} has an invalid production value`);
      expect(serializedIssues, key).not.toContain(invalidValue);
      expect(JSON.stringify(result), key).not.toContain("private-sentinel");
    }
  });

  it("uses GET-only remote inspection and never imports local link state", async () => {
    const source = await readFile("scripts/check-netlify-handoff.mjs", "utf8");

    expect(source).toContain('"https://api.netlify.com"');
    expect(source).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/u);
    expect(source).not.toContain(".netlify/state.json");
  });

  it("commits a value-free snapshot of the current external gap", async () => {
    const inventory = JSON.parse(
      await readFile("docs/operations/netlify-handoff-inventory.json", "utf8"),
    ) as Record<string, unknown>;
    const serialized = JSON.stringify(inventory);

    expect(inventory.missingRequiredEnvironmentKeys).toEqual([
      "EXECUTOR_HANDOFF_SECRET",
      "SUPABASE_DATABASE_URL",
    ]);
    expect(serialized).not.toMatch(/"(?:id|value|token|updated_by)"\s*:/iu);
    expect(serialized).not.toContain("postgresql://");
  });
});
