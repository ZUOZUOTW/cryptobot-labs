import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createDeploymentClient, DeploymentClientError } from "../src/main/deployment-client";
import type { ControlDeviceIdentity } from "../src/main/control-client";

const now = 1_700_000_000_000;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
};
const identity = (sign: ControlDeviceIdentity["sign"] = vi.fn(async (data: Uint8Array) => {
  void data; return new Uint8Array(64).fill(4);
})): ControlDeviceIdentity => ({
  deviceId: "dev_a", credential: `cred_${Buffer.alloc(32, 7).toString("base64url")}`,
  credentialExpiresAt: now + 60_000, sign,
});
const bundle = () => ({ schemaVersion: 1, deployment: { id: "dep_a", version: 2, strategyVersionId: "sv_a",
  mode: "paper", state: "running", configurationHash: "a".repeat(64) },
strategy: { market: "spot", symbol: "BTCUSDT", configHash: digest('{"period":14}'), sourceHash: null,
  config: { period: 14 }, source: null },
risk: { id: "risk_a", allowedSymbols: ["BTCUSDT"], maxOrderNotional: "100", maxPositionNotional: "500",
  maxTotalExposure: "1000", maxSimultaneousPositions: 2, maxDailyLoss: "25", maxLeverage: "1",
  maxSlippageBps: 20, minSignalCooldownMs: 1000, maxConsecutiveFailures: 3,
  operationMode: "approval-required", updatedAt: 10 } });
const response = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json", ...headers },
});

describe("deployment client", () => {
  it("signs the exact fenced GET and validates envelope, config, and source hashes", async () => {
    const value = bundle(); const sign = vi.fn(async (data: Uint8Array) => { void data; return new Uint8Array(64).fill(4); });
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input; void init; return response({ bundle: value, bundleHash: digest(canonical(value)) });
    });
    const client = createDeploymentClient({ baseUrl: "https://labs.test", identity: identity(sign), now: () => now,
      crypto: webcrypto as unknown as Crypto, fetch: fetcher as typeof fetch });
    await expect(client.fetchBundle("dep_a", 2)).resolves.toMatchObject({ deployment: { id: "dep_a", version: 2 } });
    expect(fetcher.mock.calls[0]![0]).toBe("https://labs.test/api/agent/deployments/dep_a?version=2");
    const signed = new TextDecoder().decode(sign.mock.calls[0]![0]);
    expect(signed).toMatch(new RegExp(`^GET\\n/api/agent/deployments/dep_a\\?version=2\\n${now}\\nnonce_`));
    expect(fetcher.mock.calls[0]![1]?.body).toBeUndefined();
  });

  it("rejects tampering, oversized responses, version fences, and revocation", async () => {
    const value = bundle(); const badHash = { bundle: value, bundleHash: "f".repeat(64) };
    const tampered = createDeploymentClient({ baseUrl: "https://labs.test", identity: identity(), now: () => now,
      crypto: webcrypto as unknown as Crypto, fetch: vi.fn(async () => response(badHash)) as typeof fetch });
    await expect(tampered.fetchBundle("dep_a", 2)).rejects.toThrow(/bundle hash/i);
    const oversized = createDeploymentClient({ baseUrl: "https://labs.test", identity: identity(), now: () => now,
      crypto: webcrypto as unknown as Crypto,
      fetch: vi.fn(async () => response({}, 200, { "content-length": "999999" })) as typeof fetch });
    await expect(oversized.fetchBundle("dep_a", 2)).rejects.toThrow(/too large/i);
    const fenced = createDeploymentClient({ baseUrl: "https://labs.test", identity: identity(), now: () => now,
      crypto: webcrypto as unknown as Crypto, fetch: vi.fn(async () => response({}, 409)) as typeof fetch });
    await expect(fenced.fetchBundle("dep_a", 2)).rejects.toMatchObject({ code: "deployment-fence" });
    const onRevoked = vi.fn();
    const revoked = createDeploymentClient({ baseUrl: "https://labs.test", identity: identity(), now: () => now,
      crypto: webcrypto as unknown as Crypto, fetch: vi.fn(async () => response({}, 401)) as typeof fetch, onRevoked });
    await expect(revoked.fetchBundle("dep_a", 2)).rejects.toBeInstanceOf(DeploymentClientError);
    expect(onRevoked).toHaveBeenCalledOnce();
  });
});
