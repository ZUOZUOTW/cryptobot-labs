// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  repository: {
    list: vi.fn(),
    account: vi.fn(),
    realizedPnl: vi.fn(),
    create: vi.fn(),
    findMatching: vi.fn(),
    hasActiveTargetConflict: vi.fn(),
    transition: vi.fn(),
    hasTransitionTargetConflict: vi.fn(),
  },
}));

vi.mock("../db", () => ({ createControlPlaneDatabase: vi.fn(() => ({})) }));
vi.mock("../db/repositories", () => ({ createUserRepository: vi.fn(() => ({})) }));
vi.mock("../lib/server/auth", () => ({
  requireApiUser: mocks.requireApiUser,
  platformIdentityProvider: {},
  deriveWorkspaceUserId: vi.fn(),
}));
vi.mock("../lib/server/platform-env", () => ({ env: { DB: {} } }));
vi.mock("@/lib/server/cloud-runs", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/server/cloud-runs")>();
  return { ...original, createCloudRunRepository: vi.fn(() => mocks.repository) };
});

import { PATCH } from "../app/api/cloud-runs/[id]/route";
import { GET, POST } from "../app/api/cloud-runs/route";

const riskPolicy = {
  allowedSymbols: ["BTCUSDT"],
  maxOrderNotional: "25",
  maxPositionNotional: "100",
  maxTotalExposure: "200",
  maxSimultaneousPositions: 1,
  maxDailyLoss: "20",
  maxLeverage: "6",
  maxSlippageBps: 30,
  minSignalCooldownMs: 60_000,
  maxConsecutiveFailures: 3,
  operationMode: "automatic",
};
const conflict = {
  error: "cloud_run_target_conflict",
  message: "Another non-stopped cloud strategy already controls this WEEX account, market, and symbol. Stop it before starting this strategy.",
};
const launchRequest = () => new Request("https://cryptobot.example/api/cloud-runs", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": "cloud-run-request-0001",
    "sec-fetch-site": "same-origin",
  },
  body: JSON.stringify({
    strategyVersionId: "strategy_version_1",
    botName: "BTC breakout",
    configurationHash: "a".repeat(64),
    mode: "live",
    liveConfirmation: { acknowledged: true, acceptedAt: Date.now() },
    riskPolicy,
  }),
});
const resumeRequest = () => new Request("https://cryptobot.example/api/cloud-runs/crun_1", {
  method: "PATCH",
  headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ state: "running", expectedVersion: 3 }),
});

beforeEach(() => {
  for (const method of Object.values(mocks.repository)) method.mockReset();
  mocks.requireApiUser.mockReset().mockResolvedValue({ ok: true, user: { id: "user_1" } });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("cloud run target conflict API", () => {
  it("returns the persisted market and symbol target used by the dashboard", async () => {
    mocks.repository.list.mockResolvedValue([{ id: "crun_1", market: "futures", symbol: "BTCUSDT" }]);
    mocks.repository.account.mockResolvedValue(null);

    const response = await GET(new Request("https://cryptobot.example/api/cloud-runs"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      runs: [{ id: "crun_1", market: "futures", symbol: "BTCUSDT" }],
    });
    expect(mocks.repository.list).toHaveBeenCalledWith("user_1");
    expect(mocks.repository.realizedPnl).not.toHaveBeenCalled();
  });

  it("does not hide an older running strategy behind stopped history", async () => {
    const stopped = Array.from({ length: 101 }, (_, index) => ({
      id: `stopped_${index}`,
      state: "stopped",
    }));
    mocks.repository.list.mockResolvedValue([...stopped, { id: "running_old", state: "running" }]);
    mocks.repository.account.mockResolvedValue(null);

    const response = await GET(new Request("https://cryptobot.example/api/cloud-runs"));
    const body = await response.json() as { runs: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.runs).toHaveLength(102);
    expect(body.runs.at(-1)).toEqual({ id: "running_old", state: "running" });
  });

  it("uses repository all-time totals instead of reducing the truncated chart points", async () => {
    mocks.repository.list.mockResolvedValue([]);
    mocks.repository.account.mockResolvedValue({
      connectionId: "connection_1",
      connectionStatus: "active",
      syncStatus: "ready",
      accountUid: "account_1",
      observedAt: 1,
      balancesJson: [],
      positionsJson: [],
      accountEquity: "5000",
      availableEquity: "5000",
      unrealizedPnl: "0",
      lastErrorCode: null,
      permissionsJson: { read: true, futuresTrade: true },
      withdrawalAccessAbsent: true,
    });
    mocks.repository.realizedPnl.mockResolvedValue({
      total: "368",
      tradeCount: 368,
      points: [{ observedAt: 1, netPnl: "1", cumulativeNetPnl: "368", tradeCount: 1 }],
    });

    const response = await GET(new Request("https://cryptobot.example/api/cloud-runs"));

    expect(response.status).toBe(200);
    expect((await response.json() as { realizedPnl: unknown }).realizedPnl).toEqual({
      asset: "USDT",
      total: "368",
      tradeCount: 368,
      points: [{ observedAt: 1, netPnl: "1", cumulativeNetPnl: "368", tradeCount: 1 }],
    });
    expect(mocks.repository.realizedPnl).toHaveBeenCalledWith("user_1", "connection_1");
  });

  it("returns a clear 409 when a new run would share an active account target", async () => {
    mocks.repository.create.mockResolvedValue(null);
    mocks.repository.findMatching.mockResolvedValue(null);
    mocks.repository.hasActiveTargetConflict.mockResolvedValue(true);
    const response = await POST(launchRequest());

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(conflict);
    expect(mocks.repository.hasActiveTargetConflict).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      strategyVersionId: "strategy_version_1",
    }));
  });

  it("keeps an exact idempotent replay ahead of target conflict classification", async () => {
    const run = { id: "crun_existing" };
    mocks.repository.create.mockResolvedValue(null);
    mocks.repository.findMatching.mockResolvedValue(run);
    mocks.repository.hasActiveTargetConflict.mockResolvedValue(true);

    const response = await POST(launchRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ run, idempotent: true });
    expect(mocks.repository.hasActiveTargetConflict).not.toHaveBeenCalled();
  });

  it("returns the same 409 when resuming would violate the account target fence", async () => {
    mocks.repository.transition.mockResolvedValue(null);
    mocks.repository.hasTransitionTargetConflict.mockResolvedValue(true);
    const response = await PATCH(resumeRequest(), { params: Promise.resolve({ id: "crun_1" }) });

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(conflict);
    expect(mocks.repository.hasTransitionTargetConflict).toHaveBeenCalledWith({
      userId: "user_1",
      id: "crun_1",
    });
  });

  it("maps a raced target unique violation to the fixed 409 without logging tenant data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.repository.transition.mockRejectedValue(Object.assign(new Error("user_1 secret detail"), {
      name: "PostgresError",
      code: "23505",
      constraint_name: "cloud_runs_nonterminal_target_uidx",
      detail: "user_1",
    }));

    const response = await PATCH(resumeRequest(), { params: Promise.resolve({ id: "crun_1" }) });

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(conflict);
    expect(mocks.repository.hasTransitionTargetConflict).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[cloud-runs] transition failed", {
      name: "PostgresError",
      code: "23505",
      constraint: "cloud_runs_nonterminal_target_uidx",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("user_1");
  });

  it("fails other transition database errors closed as a sanitized 503", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.repository.transition.mockRejectedValue(Object.assign(new Error("postgres://secret@host/user_1"), {
      name: "PostgresError",
      code: "08006",
      detail: "user_1",
    }));

    const response = await PATCH(resumeRequest(), { params: Promise.resolve({ id: "crun_1" }) });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "cloud_run_service_unavailable" });
    expect(log).toHaveBeenCalledWith("[cloud-runs] transition failed", {
      name: "PostgresError",
      code: "08006",
      constraint: "unknown",
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|user_1/);
  });
});
