import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ControlPlaneDatabase, ControlPlaneStatement } from "../db";
import { createAgentDeploymentBundleHandler, createAgentDeploymentBundleService } from "../lib/server/agent-deployment-bundle";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const baseRow = () => ({
  deploymentId: "dep_a", deploymentVersion: 2, strategyVersionId: "sv_a", mode: "paper", state: "running",
  configurationHash: "a".repeat(64), market: "spot", symbol: "BTCUSDT",
  configHash: digest('{"period":14}'), sourceHash: null, configJson: '{"period":14}', sourceCode: null,
  riskId: "risk_a", allowedSymbolsJson: '["BTCUSDT"]', maxOrderNotional: "100", maxPositionNotional: "500",
  maxTotalExposure: "1000", maxSimultaneousPositions: 2, maxDailyLoss: "25", maxLeverage: "1",
  maxSlippageBps: 20, minSignalCooldownMs: 1000, maxConsecutiveFailures: 3,
  operationMode: "approval-required", riskUpdatedAt: 10,
});

function database(row: Record<string, unknown> | null) {
  const binds: unknown[][] = [];
  const statement = {
    bind(...values: unknown[]) { binds.push(values); return statement; },
    first: vi.fn(async () => row), all: vi.fn(), run: vi.fn(),
  } as unknown as ControlPlaneStatement;
  return { binds, database: { prepare: vi.fn(() => statement), batch: vi.fn() } as unknown as ControlPlaneDatabase };
}

describe("signed agent deployment bundle", () => {
  it("binds verified device ownership and version, returns only bounded strategy/risk data, and hashes the exact bundle", async () => {
    const fixture = database(baseRow());
    const verify = vi.fn(async (input) => ({ userId: "usr_a", deviceId: "dev_a", capability: input.capability }));
    const handler = createAgentDeploymentBundleHandler({ verify,
      service: createAgentDeploymentBundleService(fixture.database) });
    const url = "https://labs.test/api/agent/deployments/dep_a?version=2";
    const response = await handler(new Request(url), { params: { id: "dep_a" } });
    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ url, method: "GET", body: new Uint8Array(),
      capability: "agent.deployments.read" }));
    expect(fixture.binds[0]).toEqual(["usr_a", "dev_a", "dep_a", 2]);
    const body = await response.json() as { bundle: unknown; bundleHash: string };
    expect(body.bundleHash).toBe(digest(JSON.stringify(body.bundle)));
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/userId|deviceId|credential|apiKey|passphrase|secret/i);
  });

  it("fails closed on a wrong device/version and never reflects stored credential-like config", async () => {
    const missing = database(null);
    const verify = vi.fn(async (input) => ({ userId: "usr_a", deviceId: "dev_other", capability: input.capability }));
    const fenced = createAgentDeploymentBundleHandler({ verify, service: createAgentDeploymentBundleService(missing.database) });
    expect((await fenced(new Request("https://labs.test/api/agent/deployments/dep_a?version=9"),
      { params: { id: "dep_a" } })).status).toBe(409);
    const sensitive = database({ ...baseRow(), configJson: '{"apiKey":"NEVER_REFLECT"}' });
    const unsafe = createAgentDeploymentBundleHandler({ verify, service: createAgentDeploymentBundleService(sensitive.database) });
    const response = await unsafe(new Request("https://labs.test/api/agent/deployments/dep_a?version=2"), { params: { id: "dep_a" } });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("NEVER_REFLECT");
  });

  it("rejects unsigned shape ambiguity before service access", async () => {
    const fixture = database(baseRow());
    const verify = vi.fn(async (input) => ({ userId: "usr_a", deviceId: "dev_a", capability: input.capability }));
    const handler = createAgentDeploymentBundleHandler({ verify, service: createAgentDeploymentBundleService(fixture.database) });
    expect((await handler(new Request("https://labs.test/api/agent/deployments/dep_a?version=1&version=2"),
      { params: { id: "dep_a" } })).status).toBe(400);
    expect((await handler(new Request("https://labs.test/api/agent/deployments/dep_a?version=2", {
      headers: { "content-type": "application/json" },
    }), { params: { id: "dep_a" } })).status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });
});
