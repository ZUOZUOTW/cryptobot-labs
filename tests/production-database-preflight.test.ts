// @vitest-environment node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const runPreflight = async (target: string, overrides: Record<string, string | undefined>) => {
  const environment = { ...process.env };
  for (const key of [
    "CI",
    "DEMO_MODE",
    "GITHUB_ACTIONS",
    "PUBLIC_ORIGIN",
    "SUPABASE_DATABASE_URL",
  ]) delete environment[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  try {
    const result = await execFileAsync(process.execPath, [
      "scripts/check-production-database-readiness.mjs",
      target,
    ], { env: environment });
    return { status: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string; stdout?: string };
    return { status: failure.code ?? 1, stderr: failure.stderr ?? "", stdout: failure.stdout ?? "" };
  }
};

describe("production database deployment preflight", () => {
  it("skips only an explicit demo website build", async () => {
    await expect(runPreflight("website", { DEMO_MODE: "true" })).resolves.toMatchObject({
      status: 0,
      stdout: expect.stringContaining("skipped for demo mode"),
    });
    await expect(runPreflight("website", {})).resolves.toMatchObject({
      status: 1,
      stderr: expect.stringContaining("DEMO_MODE"),
    });
  });

  it("has a narrowly bound synthetic GitHub build exception that cannot apply on Netlify", async () => {
    const base = {
      CI: "true",
      DEMO_MODE: "false",
      GITHUB_ACTIONS: "true",
      PUBLIC_ORIGIN: "https://ci.cryptobot.invalid",
      SUPABASE_DATABASE_URL: "postgresql://cryptobot_netlify@ci-only.invalid/cryptobot",
    };
    await expect(runPreflight("website", base)).resolves.toMatchObject({
      status: 0,
      stdout: expect.stringContaining("synthetic GitHub build only"),
    });
    await expect(runPreflight("website", { ...base, GITHUB_ACTIONS: undefined,
      SUPABASE_DATABASE_URL: undefined })).resolves.toMatchObject({
      status: 1,
      stderr: expect.stringContaining("SUPABASE_DATABASE_URL"),
    });
  });

  it("rejects unknown targets and requires the executor database binding", async () => {
    await expect(runPreflight("unknown", {})).resolves.toMatchObject({ status: 1 });
    await expect(runPreflight("executor", {})).resolves.toMatchObject({
      status: 1,
      stderr: expect.stringContaining("SUPABASE_DATABASE_URL"),
    });
  });

  it("requires website-only promoter authorization evidence in addition to the cloud fence", async () => {
    const source = await readFile("scripts/check-production-database-readiness.mjs", "utf8");
    expect(source).toContain('if (target === "website")');
    expect(source).toContain("WEBSITE_DATABASE_SCHEMA_SQL");
    expect(source).toContain("assertWebsiteDatabaseSchema(websiteSchema[0])");
  });
});
