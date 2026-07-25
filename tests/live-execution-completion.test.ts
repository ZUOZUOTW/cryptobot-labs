import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const files = (path: string): string[] => readdirSync(join(root, path)).flatMap((name) => {
  const relative = join(path, name); const absolute = join(root, relative);
  return statSync(absolute).isDirectory() ? files(relative) : [relative];
});
const source = (paths: string[]) => paths.flatMap((path) => files(path))
  .filter((path) => /\.(?:ts|tsx|sql|md)$/.test(path)).map(read).join("\n");

describe("live execution completion invariants", () => {
  it("keeps exchange secrets out of browser routes and durable website storage", () => {
    const manualRoute = "app/api/connections/weex/manual/route.ts";
    const otherBrowserRoutes = files("app/api")
      .filter((path) => path !== manualRoute && /\.(?:ts|tsx)$/.test(path))
      .map(read)
      .join("\n");
    expect(otherBrowserRoutes).not.toMatch(/secretKey|secret_key|passphrase|apiSecret|api_secret/i);
    const relay = read(manualRoute);
    expect(relay).toMatch(/sec-fetch-site/);
    expect(relay).toMatch(/content-length/);
    expect(relay).toMatch(/cache-control["']?:?\s*["']no-store|cache-control.*no-store/i);
    expect(relay).toMatch(/redirect:\s*"error"/);
    expect(relay).not.toMatch(/console\.(?:log|warn|error)|database.*credentials|insert.*credentials/i);
    expect(source(["drizzle"])).not.toMatch(/secret_key|passphrase|api_secret|access_sign/i);
    expect(read("db/schema.ts")).not.toMatch(/secretKey|secret_key|passphrase|apiSecret|api_secret/i);
  });

  it("keeps evidence classes explicit and avoids unsupported multi-exchange slogans", () => {
    const visible = source(["app", "components"]);
    expect(visible).not.toMatch(/支援 Binance|支援多交易所/);
    for (const label of ["快速模擬", "歷史回測", "模擬運行", "WEEX 合約模擬", "實盤績效"]) {
      expect(visible).toContain(label);
    }
  });

  it("ships the security and manual release gates required before public live acceptance", () => {
    const threat = read("docs/security/live-trading-threat-model.md");
    for (const threatName of ["Stolen website session", "Malicious strategy script", "Forged device request",
      "Replay", "Compromised website", "Telemetry injection", "Stale market data", "Clock drift",
      "WEEX beta schema change", "Duplicate order", "Unknown submit outcome", "Rate limits/network loss",
      "Credential rotation", "Lost or stolen laptop", "Revoked device", "Installer/update compromise", "Emergency failure"]) {
      expect(threat).toContain(threatName);
    }
    expect(read("docs/security/credential-handling.md")).toMatch(/request memory[\s\S]*never logs or persists/i);
    expect(read("docs/operations/agent-release-checklist.md")).toMatch(/signed, notarized|Authenticode|SHA256SUMS|SBOM/);
    expect(read("docs/operations/live-smoke-test-checklist.md")).toMatch(/must never place a real-money order|explicitly authorises|unknown order state/i);
  });
});
