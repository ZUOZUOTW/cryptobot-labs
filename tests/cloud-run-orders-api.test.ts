// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  orders: vi.fn(),
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
  return { ...original, createCloudRunRepository: vi.fn(() => ({ orders: mocks.orders })) };
});

import { GET } from "../app/api/cloud-runs/[id]/route";

const context = (id = "crun_owner_1") => ({ params: Promise.resolve({ id }) });

describe("cloud run order evidence API", () => {
  beforeEach(() => {
    mocks.requireApiUser.mockReset().mockResolvedValue({ ok: true, user: { id: "user_1" } });
    mocks.orders.mockReset().mockResolvedValue([]);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("reads only the authenticated owner's run evidence with a bounded limit", async () => {
    mocks.orders.mockResolvedValue([{ runId: "crun_owner_1", lifecycleStatus: "unknown" }]);

    const response = await GET(new Request("https://cryptobot.example/api/cloud-runs/crun_owner_1"), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      orders: [{ runId: "crun_owner_1", lifecycleStatus: "unknown" }],
    });
    expect(mocks.orders).toHaveBeenCalledWith("user_1", "crun_owner_1", 20);
  });

  it("returns authentication failures before any evidence query", async () => {
    mocks.requireApiUser.mockResolvedValue({ ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }) });

    const response = await GET(new Request("https://cryptobot.example/api/cloud-runs/crun_owner_1"), context());

    expect(response.status).toBe(401);
    expect(mocks.orders).not.toHaveBeenCalled();
  });

  it("rejects an invalid run id before querying the owner projection", async () => {
    const response = await GET(new Request("https://cryptobot.example/api/cloud-runs/invalid"), context("bad/id"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.orders).not.toHaveBeenCalled();
  });

  it("sanitizes database failures and fails the evidence read closed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.orders.mockRejectedValue(Object.assign(new Error("postgres://secret@host/user_1"), {
      name: "PostgresError", code: "08006", detail: "user_1",
    }));

    const response = await GET(new Request("https://cryptobot.example/api/cloud-runs/crun_owner_1"), context());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cloud_run_order_evidence_unavailable" });
    expect(log).toHaveBeenCalledWith("[cloud-runs] order evidence read failed", {
      name: "PostgresError", code: "08006", constraint: "unknown",
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|user_1/);
  });
});
