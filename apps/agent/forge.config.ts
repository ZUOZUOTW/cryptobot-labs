import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { validateReleaseEnvironment } from "./release-environment";

const publicRelease = process.env.AGENT_RELEASE_CHANNEL === "public";
if (publicRelease && (process.platform === "darwin" || process.platform === "win32")) {
  validateReleaseEnvironment(process.platform, process.env);
}

const packagedMacApps = (outputPaths: string[]): string[] => outputPaths.map((outputPath) => {
  const candidates = readdirSync(outputPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  if (candidates.length !== 1) throw new Error("Packaged macOS output must contain exactly one application bundle");
  return resolve(outputPath, candidates[0]!.name);
});

const config: ForgeConfig = {
  hooks: {
    postPackage: async (_config, result) => {
      if (publicRelease && result.platform === "darwin") {
        for (const appPath of packagedMacApps(result.outputPaths)) {
          execFileSync("xcrun", ["stapler", "staple", appPath], { stdio: "inherit" });
        }
      } else if (result.platform === "darwin") {
        for (const appPath of packagedMacApps(result.outputPaths)) {
          execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--options", "runtime",
            "--entitlements", resolve("entitlements.plist"), appPath], { stdio: "inherit" });
        }
      }
    },
  },
  packagerConfig: {
    asar: true,
    name: "CryptoBot Labs Agent",
    executableName: "CryptoBot Labs Agent",
    protocols: [{ name: "CryptoBot Labs 安全配對", schemes: ["cryptobot-labs"] }],
    appBundleId: "labs.cryptobot.agent",
    appCategoryType: "public.app-category.finance",
    ...(publicRelease && process.platform === "darwin" ? {
      osxSign: { identity: process.env.APPLE_SIGNING_IDENTITY,
        optionsForFile: () => ({ hardenedRuntime: true, entitlements: resolve("entitlements.plist") }) },
      osxNotarize: { appleId: process.env.APPLE_ID!, appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD!,
        teamId: process.env.APPLE_TEAM_ID! },
    } : {}),
    ...(publicRelease && process.platform === "win32" ? {
      windowsSign: { certificateFile: process.env.WINDOWS_CERTIFICATE_FILE!,
        certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD!, description: "CryptoBot Labs Agent",
        website: "https://github.com/ZUOZUOTW/cryptobot-labs" },
    } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ["darwin"]),
    new MakerSquirrel({ name: "cryptobot_labs_agent", setupExe: "CryptoBot-Labs-Agent-Setup.exe", noMsi: true,
      ...(publicRelease && process.platform === "win32" ? { certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
        certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD } : {}) }, ["win32"]),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main/index.ts", config: "vite.main.config.ts", target: "main" },
        { entry: "src/preload/index.ts", config: "vite.preload.config.ts", target: "preload" },
        { entry: "src/runtime/index.ts", config: "vite.runtime.config.ts", target: "main" },
        { entry: "src/runtime/strategy-thread.ts", config: "vite.strategy-thread.config.ts", target: "main" },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
    new FusesPlugin({ version: FuseVersion.V1, strictlyRequireAllFuses: true,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
      [FuseV1Options.WasmTrapHandlers]: true,
    }),
  ],
};

export default config;
