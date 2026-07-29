import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production dependency security pins", () => {
  it("keeps the reviewed Next.js patch and scoped transitive overrides", async () => {
    const [
      packageSource,
      executorSource,
      workspace,
      denoLock,
      netlifyConfig,
      ciWorkflow,
      agentCiWorkflow,
      agentReleaseWorkflow,
    ] = await Promise.all([
      readFile("package.json", "utf8"),
      readFile("apps/executor/package.json", "utf8"),
      readFile("pnpm-workspace.yaml", "utf8"),
      readFile("deno.lock", "utf8"),
      readFile("netlify.toml", "utf8"),
      readFile(".github/workflows/ci.yml", "utf8"),
      readFile(".github/workflows/agent-ci.yml", "utf8"),
      readFile(".github/workflows/agent-release.yml", "utf8"),
    ]);
    const packageJson = JSON.parse(packageSource) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      engines?: Record<string, string>;
      packageManager?: string;
    };
    const executorPackage = JSON.parse(executorSource) as {
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.next).toBe("16.2.12");
    expect(packageJson.dependencies?.remotion).toBeUndefined();
    expect(packageJson.dependencies?.["@remotion/player"]).toBeUndefined();
    expect(packageJson.devDependencies?.["eslint-config-next"]).toBe("16.2.12");
    expect(packageJson.devDependencies?.esbuild).toBe("0.28.0");
    expect(packageJson.engines?.node).toBe(">=22.23.1");
    expect(packageJson.packageManager).toBe("pnpm@11.9.0");
    expect(executorPackage.devDependencies?.esbuild).toBe("0.28.0");
    expect(workspace).toContain('"next>sharp": "0.35.3"');
    expect(workspace).toContain('"next>postcss": "8.5.24"');
    expect(workspace).toContain("postcss@8.5.24");
    expect(denoLock).toContain("npm:next@16.2.12");
    expect(denoLock).not.toMatch(/remotion/i);
    expect(netlifyConfig).toContain('NODE_VERSION = "22.23.1"');
    for (const workflow of [ciWorkflow, agentCiWorkflow, agentReleaseWorkflow]) {
      expect(workflow).toContain("node-version: 22.23.1");
    }
  });

  it("keeps the reviewed third-party notices available to distributors", async () => {
    const [notices, checker, workflow] = await Promise.all([
      readFile("THIRD_PARTY_NOTICES.md", "utf8"),
      readFile("scripts/check-dependency-licenses.mjs", "utf8"),
      readFile(".github/workflows/ci.yml", "utf8"),
    ]);

    expect(notices).toContain("caniuse-lite");
    expect(notices).toContain("CC BY 4.0");
    expect(notices).toContain("@img/sharp-libvips-*");
    expect(notices).toContain("LGPL-3.0-or-later");
    expect(notices).toContain("React Icons");
    expect(notices).toContain("JSZip");
    expect(notices).toContain("agent-sbom-<platform>.cdx.json");
    expect(checker).toContain("reviewedProductionLicenses");
    expect(checker).toContain('"@remotion/player"');
    expect(workflow).toContain("pnpm licenses:check");
  });

  it("keeps CI-only test requirements portable and explicit", async () => {
    const testFiles = (await readdir("tests"))
      .filter((file) => /\.test\.tsx?$/u.test(file));
    const testSources = await Promise.all(testFiles.map(async (file) => ({
      file,
      source: await readFile(`tests/${file}`, "utf8"),
    })));
    const sqliteTests = testSources.filter(({ source }) => (
      /^\s*import\b[^\n]*from "node:sqlite";/mu.test(source)
    ));

    expect(sqliteTests.length).toBeGreaterThanOrEqual(15);
    for (const { file, source } of sqliteTests) {
      expect(source, file).toMatch(/^\/\/ @vitest-environment node\n/u);
    }

    const i18nTest = await readFile("tests/i18n-catalogue.test.ts", "utf8");
    expect(i18nTest).not.toContain('execFileSync("rg"');
    expect(i18nTest).not.toContain('from "node:child_process"');
  });
});
