import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ControlCommand } from "../src/main/control-client";
import type { DeploymentBundle } from "../src/main/deployment-client";
import { createLiveUnlockService } from "../src/main/live-unlock-service";

const risk = {
  id: "risk_1",
  allowedSymbols: ["BTCUSDT"],
  maxOrderNotional: "100",
  maxPositionNotional: "500",
  maxTotalExposure: "1000",
  maxSimultaneousPositions: 2,
  maxDailyLoss: "50",
  maxLeverage: "1",
  maxSlippageBps: 30,
  minSignalCooldownMs: 0,
  maxConsecutiveFailures: 3,
  operationMode: "automatic" as const,
  updatedAt: 100,
};

const canonical = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
};

const riskHash = createHash("sha256").update(canonical({
  id: risk.id,
  versionFence: { updatedAt: risk.updatedAt },
  allowedSymbols: risk.allowedSymbols,
  maxOrderNotional: risk.maxOrderNotional,
  maxPositionNotional: risk.maxPositionNotional,
  maxTotalExposure: risk.maxTotalExposure,
  maxSimultaneousPositions: risk.maxSimultaneousPositions,
  maxDailyLoss: risk.maxDailyLoss,
  maxLeverage: risk.maxLeverage,
  maxSlippageBps: risk.maxSlippageBps,
  minSignalCooldownMs: risk.minSignalCooldownMs,
  maxConsecutiveFailures: risk.maxConsecutiveFailures,
  operationMode: risk.operationMode,
})).digest("hex");

const bundle: DeploymentBundle = {
  schemaVersion: 1,
  deployment: { id: "dep_1", version: 2, strategyVersionId: "strategy_1", mode: "paper", state: "stopped",
    configurationHash: "a".repeat(64) },
  strategy: { market: "spot", symbol: "BTCUSDT", configHash: "b".repeat(64), sourceHash: null,
    config: { timeframe: "1h" }, source: null },
  risk,
};

const command = (hash = riskHash): ControlCommand & { type: "request-live-unlock" } => ({
  id: "cmd_1",
  deploymentId: "dep_1",
  type: "request-live-unlock",
  version: 1,
  correlationId: "corr_1",
  expectedDeploymentVersion: 2,
  payload: { revalidate: { deploymentConfigurationHash: "a".repeat(64), strategyMarket: "spot",
    strategyVersionId: "strategy_1", allowedSymbols: ["BTCUSDT"],
    riskPolicy: { id: "risk_1", versionFence: { updatedAt: 100 }, hash } } },
  createdAt: 100,
  expiresAt: 1_000,
});

const verified = {
  provider: "WEEX" as const,
  apiKeySuffix: "ABCD",
  verifiedAt: "2026-07-12T00:00:00.000Z",
  permissions: { read: true, spotTrade: true, futuresTrade: false, withdrawal: false as const },
};

describe("live unlock service", () => {
  it("revalidates local WEEX permissions and current product metadata before staging live", async () => {
    const record = vi.fn();
    const collect = vi.fn(async () => ({ candles: [], collectedAt: Date.parse(verified.verifiedAt), rules: {
      market: "spot" as const, symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", tickSize: "0.1",
      stepSize: "0.001", minimumQuantity: "0.001", minimumNotional: "5",
    } }));
    const service = createLiveUnlockService({
      deployments: { fetchBundle: vi.fn(async () => bundle) },
      verifier: { verify: vi.fn(async () => verified) },
      connection: { record },
      market: { collect },
    });

    await expect(service.prepare(command())).resolves.toEqual({ deploymentId: "dep_1", configurationVersion: "v2",
      scriptHash: "b".repeat(64), mode: "live", market: "spot", symbol: "BTCUSDT" });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ canTrade: true, withdrawalPermission: "absent" }));
    expect(collect).toHaveBeenCalledWith({ market: "spot", symbol: "BTCUSDT", timeframe: "1h" });
  });

  it("fails closed on a changed risk approval before touching credentials or market data", async () => {
    const verify = vi.fn(async () => verified);
    const collect = vi.fn();
    const service = createLiveUnlockService({
      deployments: { fetchBundle: async () => bundle }, verifier: { verify }, connection: { record: vi.fn() },
      market: { collect },
    });

    await expect(service.prepare(command("c".repeat(64)))).rejects.toThrow("risk fence");
    expect(verify).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
  });

  it("fails closed when local trade permissions are insufficient", async () => {
    const service = createLiveUnlockService({
      deployments: { fetchBundle: async () => bundle },
      verifier: { verify: async () => ({ ...verified, permissions: { ...verified.permissions, spotTrade: false } }) },
      connection: { record: vi.fn() }, market: { collect: vi.fn() },
    });
    await expect(service.prepare(command())).rejects.toThrow("permission verification");
  });
});
