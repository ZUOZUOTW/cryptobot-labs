#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const publicMode = args.has("--public");
const internalMode = args.has("--internal-test");
if (publicMode === internalMode) throw new Error("Choose exactly one verification mode");
const root = resolve(process.argv.at(-1));
if (root === resolve("--public") || root === resolve("--internal-test")) throw new Error("Artifact directory is required");

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry); const detail = await stat(path);
    if (detail.isDirectory()) result.push(...await files(path)); else if (detail.isFile()) result.push(path);
  }
  return result;
}

const rootFiles = await files(root);
const artifacts = rootFiles.filter((path) => /\.(?:zip|exe)$/i.test(path)).sort();
if (artifacts.length < 1) throw new Error("No installable Agent artifact was found");

async function verifyMacArchives(requireStaple) {
  const temporary = await mkdtemp(join(tmpdir(), "cryptobot-agent-verify-"));
  try {
    const archives = artifacts.filter((path) => path.endsWith(".zip"));
    if (archives.length < 1) throw new Error("macOS archive is unavailable for verification");
    for (const [index, archive] of archives.entries()) {
      const destination = join(temporary, String(index));
      execFileSync("ditto", ["-x", "-k", archive, destination]);
      const apps = (await files(destination)).filter((path) => path.endsWith("/Contents/MacOS/CryptoBot Labs Agent"))
        .map((path) => path.slice(0, path.indexOf(".app/") + 4));
      if (apps.length !== 1) throw new Error("macOS app is unavailable for verification");
      execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", apps[0]], { stdio: "inherit" });
      if (requireStaple) execFileSync("xcrun", ["stapler", "validate", apps[0]], { stdio: "inherit" });
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (internalMode) {
  if (process.platform === "darwin") await verifyMacArchives(false);
  process.stdout.write(`Verified ${artifacts.length} unsigned internal-test artifact(s).\n`);
  process.exit(0);
}
if (process.platform === "darwin") {
  await verifyMacArchives(true);
} else if (process.platform === "win32") {
  for (const path of artifacts.filter((value) => value.endsWith(".exe"))) {
    execFileSync("powershell", ["-NoProfile", "-Command",
      `$s=Get-AuthenticodeSignature -LiteralPath '${path.replaceAll("'", "''")}'; if($s.Status -ne 'Valid'){exit 1}`], { stdio: "inherit" });
  }
} else throw new Error("Public artifact verification must run on its target platform");

const sbomPaths = rootFiles.filter((path) =>
  /^agent-sbom-(?:macos-arm64|macos-x64|windows-x64)\.cdx\.json$/.test(basename(path)));
if (sbomPaths.length !== 1) throw new Error("Exactly one platform-specific Agent SBOM is required");
const [sbomPath] = sbomPaths;
const releaseFiles = rootFiles.filter((path) => /\.(?:zip|exe|nupkg)$/i.test(path)
  || basename(path) === "RELEASES" || path === sbomPath).sort();
const checksums = (await Promise.all(releaseFiles.map(async (path) =>
  `${createHash("sha256").update(await readFile(path)).digest("hex")}  ${basename(path)}`))).sort().join("\n") + "\n";
const expected = await readFile(join(root, "SHA256SUMS"), "utf8");
if (checksums !== expected) throw new Error("SHA256SUMS does not match release artifacts");
const sbom = JSON.parse(await readFile(sbomPath, "utf8"));
const agentPackage = JSON.parse(await readFile(new URL("../apps/agent/package.json", import.meta.url), "utf8"));
const licensedComponents = Array.isArray(sbom.components)
  ? sbom.components.filter((component) =>
      Array.isArray(component.licenses) && component.licenses.length > 0)
  : [];
if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6"
    || sbom.metadata?.component?.group !== "@cryptobot-labs"
    || sbom.metadata?.component?.name !== "agent"
    || sbom.metadata?.component?.version !== agentPackage.version
    || !Array.isArray(sbom.components) || sbom.components.length < 1
    || licensedComponents.length < Math.ceil(sbom.components.length * 0.9)
    || !Array.isArray(sbom.dependencies) || sbom.dependencies.length < 1) {
  throw new Error("Agent SBOM is missing required CycloneDX release metadata");
}
process.stdout.write(`Verified ${artifacts.length} signed public artifact(s).\n`);
