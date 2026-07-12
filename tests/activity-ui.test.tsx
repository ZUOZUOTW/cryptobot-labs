import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityTable } from "../components/activity/ActivityTable";
import { parseActivityList } from "../components/activity/activity-parser";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const event = {
  id: "audit_1",
  type: "order-state",
  occurredAt: 1_700_000_000_000,
  actorType: "device" as const,
  deviceId: "device_1",
  deploymentId: "run_1",
  deploymentVersion: 4,
  strategyVersionId: "strategy_version_1",
  strategyVersion: 3,
  configurationHash: "a".repeat(64),
  scriptHash: "b".repeat(64),
  reason: "signal-approved",
  riskDecision: "allowed",
  clientOrderId: "client_order_1",
  exchangeOrderId: "exchange_order_1",
  status: "acknowledged",
  correlationId: "correlation_1",
};

describe("activity response parser", () => {
  it("accepts only the exact safe activity contract", () => {
    expect(parseActivityList({ items: [event], nextCursor: "next_page" })).toEqual({ items: [event], nextCursor: "next_page" });
  });

  it("rejects secrets, unknown fields, malformed hashes, and invalid versions", () => {
    expect(parseActivityList({ items: [{ ...event, apiSecret: "must-not-render" }], nextCursor: null })).toBeNull();
    expect(parseActivityList({ items: [{ ...event, configurationHash: "short" }], nextCursor: null })).toBeNull();
    expect(parseActivityList({ items: [{ ...event, deploymentVersion: 0 }], nextCursor: null })).toBeNull();
    expect(parseActivityList({ items: [event], nextCursor: "not a cursor" })).toBeNull();
  });
});

describe("activity table", () => {
  it("renders UTC and local time plus the complete safe execution evidence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ items: [event], nextCursor: null }), { status: 200 }));
    render(<ActivityTable />);

    const row = await screen.findByRole("row", { name: /order-state/ });
    expect(within(row).getByText(/UTC/)).toBeInTheDocument();
    expect(within(row).getByText(/本地/)).toBeInTheDocument();
    expect(row).toHaveTextContent("裝置 · device_1");
    expect(row).toHaveTextContent("run_1 · v4");
    expect(row).toHaveTextContent("strategy_version_1 · v3");
    expect(row).toHaveTextContent("aaaaaaaaaaaa");
    expect(row).toHaveTextContent("bbbbbbbbbbbb");
    expect(row).toHaveTextContent("signal-approved");
    expect(row).toHaveTextContent("allowed");
    expect(row).toHaveTextContent("client_order_1");
    expect(row).toHaveTextContent("exchange_order_1");
    expect(row).toHaveTextContent("acknowledged");
    expect(row).toHaveTextContent("correlation_1");
    expect(screen.getByRole("link", { name: "匯出 CSV" })).toHaveAttribute("href", expect.stringContaining("/api/activity/export?format=csv"));
    expect(screen.getByRole("link", { name: "匯出 JSON" })).toHaveAttribute("href", expect.stringContaining("/api/activity/export?format=json"));
    expect(screen.getByText(/匯出檔不包含 API 憑證/)).toBeInTheDocument();
  });

  it("applies bounded time filters, filters loaded rows, and follows the opaque cursor", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [event], nextCursor: "next_page" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ ...event, id: "audit_2", actorType: "user", deviceId: null, type: "run.started" }], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));
    render(<ActivityTable />);
    await screen.findByText("order-state");

    await user.click(screen.getByRole("button", { name: "載入更多" }));
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, expect.stringContaining("cursor=next_page"), expect.anything());
    await screen.findByText("run.started");
    await user.selectOptions(screen.getByLabelText("操作者"), "device");
    expect(screen.queryByText("run.started")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("開始時間"), "2026-07-01T00:00");
    await user.type(screen.getByLabelText("結束時間"), "2026-07-02T00:00");
    await user.click(screen.getByRole("button", { name: "套用時間範圍" }));
    expect(globalThis.fetch).toHaveBeenNthCalledWith(3, expect.stringMatching(/from=\d+&to=\d+/), expect.anything());
  });

  it("shows loading, empty, error, and expired-session states without stale evidence", async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));
    render(<ActivityTable />);
    expect(screen.getByText("正在載入活動紀錄…")).toBeInTheDocument();
    resolveFirst(new Response("{}", { status: 401 }));
    expect(await screen.findByText(/登入狀態已過期/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新整理" }));
    expect(await screen.findByText("無法載入活動紀錄。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重試載入" }));
    expect(await screen.findByText(/尚無符合條件的活動紀錄/)).toBeInTheDocument();
  });
});
