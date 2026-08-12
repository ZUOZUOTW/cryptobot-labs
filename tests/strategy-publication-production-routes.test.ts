// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createControlPlaneDatabase: vi.fn() }));

vi.mock("../db", () => ({ createControlPlaneDatabase: mocks.createControlPlaneDatabase }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("../lib/server/platform-env", () => ({ env: {
  DB: undefined,
  PUBLIC_ORIGIN: "https://app.example.test",
} }));

import { GET, POST } from "../app/api/strategy-publications/route";
import { PATCH } from "../app/api/strategy-publications/[slug]/route";
import { GET as MINE } from "../app/api/strategy-publications/mine/route";

describe("production strategy publication route boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.createControlPlaneDatabase.mockReset().mockImplementation(() => {
      throw new Error("DATABASE_URL=postgres://secret.example");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it.each([
    ["GET", () => GET(new Request("https://app.example.test/api/strategy-publications"))],
    ["POST", () => POST(new Request("https://app.example.test/api/strategy-publications", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ strategyVersionId: "v", backtestJobId: "j", description: "x".repeat(20) }),
    }))],
    ["PATCH", () => PATCH(new Request("https://app.example.test/api/strategy-publications/strategy-aaaaaaaa", {
      method: "PATCH",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ action: "activate-approved-referral" }),
    }), { params: Promise.resolve({ slug: "strategy-aaaaaaaa" }) })],
    ["mine", () => MINE(new Request("https://app.example.test/api/strategy-publications/mine"))],
  ] as const)("returns credential-safe no-store JSON when %s dependency initialization fails", async (_name, call) => {
    const response = await call();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(body).toContain("publication_service_unavailable");
    expect(body).not.toContain("postgres://");
  });
});
