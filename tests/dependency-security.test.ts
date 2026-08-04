import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("dependency security pins", () => {
  it("keeps the reviewed runtime, desktop, and build-chain patches", async () => {
    const [
      packageSource,
      agentSource,
      executorSource,
      workspace,
      lockfile,
      denoLock,
      netlifyConfig,
      ciWorkflow,
      codeqlWorkflow,
      agentCiWorkflow,
      agentReleaseWorkflow,
    ] = await Promise.all([
      readFile("package.json", "utf8"),
      readFile("apps/agent/package.json", "utf8"),
      readFile("apps/executor/package.json", "utf8"),
      readFile("pnpm-workspace.yaml", "utf8"),
      readFile("pnpm-lock.yaml", "utf8"),
      readFile("deno.lock", "utf8"),
      readFile("netlify.toml", "utf8"),
      readFile(".github/workflows/ci.yml", "utf8"),
      readFile(".github/workflows/codeql.yml", "utf8"),
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
    const agentPackage = JSON.parse(agentSource) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.next).toBe("16.2.12");
    expect(packageJson.dependencies?.react).toBe("19.2.8");
    expect(packageJson.dependencies?.["react-dom"]).toBe("19.2.8");
    expect(packageJson.dependencies?.remotion).toBeUndefined();
    expect(packageJson.dependencies?.["@remotion/player"]).toBeUndefined();
    expect(packageJson.devDependencies?.["eslint-config-next"]).toBe("16.2.12");
    expect(packageJson.devDependencies?.esbuild).toBe("0.28.1");
    expect(packageJson.devDependencies?.["react-server-dom-webpack"]).toBe("19.2.8");
    expect(packageJson.devDependencies?.vite).toBe("8.1.5");
    expect(packageJson.engines?.node).toBe(">=22.23.1");
    expect(packageJson.packageManager).toBe("pnpm@11.9.0");
    expect(agentPackage.dependencies?.react).toBe("19.2.8");
    expect(agentPackage.dependencies?.["react-dom"]).toBe("19.2.8");
    expect(agentPackage.devDependencies?.electron).toBe("43.2.0");
    expect(agentPackage.devDependencies?.["@electron/fuses"]).toBe("2.1.3");
    expect(agentPackage.devDependencies?.["@electron-forge/cli"]).toBe("7.11.2");
    expect(agentPackage.devDependencies?.["@electron-forge/plugin-vite"]).toBe("7.11.2");
    expect(agentPackage.devDependencies?.vite).toBe("8.1.5");
    expect(executorPackage.devDependencies?.esbuild).toBe("0.28.1");
    expect(workspace).toContain('"@electron/rebuild": "4.2.0"');
    expect(workspace).toContain('"brace-expansion@1": "2.1.4"');
    expect(workspace).toContain('"brace-expansion@2": "2.1.4"');
    expect(workspace).toContain('"brace-expansion@5": "5.0.9"');
    expect(workspace).toContain('"esbuild": "0.28.1"');
    expect(workspace).toContain('"fast-uri@3": "3.1.5"');
    expect(workspace).toContain('"undici@6": "6.28.0"');
    expect(workspace).toContain('"undici@7": "7.29.0"');
    expect(workspace).not.toContain("ignoreGhsas");
    expect(workspace).toContain('"@electron-forge/plugin-fuses>@electron/fuses": "2.1.3"');
    expect(workspace).toContain('"js-yaml@4": "4.3.0"');
    expect(workspace).toContain('"tar": "7.5.22"');
    expect(workspace).toContain('"tmp": "0.2.7"');
    expect(workspace).toContain('"next>sharp": "0.35.3"');
    expect(workspace).toContain('"next>postcss": "8.5.24"');
    expect(workspace).toContain("postcss@8.5.24");
    expect(lockfile).not.toMatch(/^\s{2}brace-expansion@1\./mu);
    expect(lockfile).toMatch(/^\s{2}brace-expansion@2\.1\.4:/mu);
    expect(lockfile).toMatch(/^\s{2}brace-expansion@5\.0\.9:/mu);
    expect(lockfile).toMatch(/^\s{2}fast-uri@3\.1\.5:/mu);
    expect(lockfile).toMatch(/^\s{2}undici@6\.28\.0:/mu);
    expect(lockfile).toMatch(/^\s{2}undici@7\.29\.0:/mu);
    expect(denoLock).toContain("npm:next@16.2.12");
    expect(denoLock).not.toMatch(/remotion/i);
    expect(netlifyConfig).toContain('NODE_VERSION = "22.23.1"');
    for (const workflow of [ciWorkflow, agentCiWorkflow, agentReleaseWorkflow]) {
      expect(workflow).toContain("node-version: 22.23.1");
    }
    expect(ciWorkflow).toContain("pnpm audit --audit-level low");
    expect(ciWorkflow).toContain("pnpm audit signatures");
    expect(ciWorkflow).not.toContain("pnpm audit --prod");
    expect(codeqlWorkflow).toContain("Analyze (javascript-typescript)");
    expect(codeqlWorkflow).toContain("languages: javascript-typescript");
    expect(codeqlWorkflow).toContain("build-mode: none");
    expect(codeqlWorkflow).toContain(
      "github/codeql-action/init@e60ea984bd3baa95954f2856bcf24f9eaba46637",
    );
    expect(codeqlWorkflow).toContain(
      "github/codeql-action/analyze@e60ea984bd3baa95954f2856bcf24f9eaba46637",
    );
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
