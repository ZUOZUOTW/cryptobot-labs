import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunPortfolioDashboard } from "../components/runs/RunPortfolioDashboard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const observedAt = Date.now() - 1_000;
const synchronized = {
  runs: [],
  account: {
    connectionStatus: "active",
    syncStatus: "ready",
    accountUid: "123456789",
    observedAt,
    balancesJson: [
      { asset: "USDT", total: "75", available: "70", frozen: "5", unrealizedPnl: "0" },
      { asset: "USDC", total: "25", available: "25", frozen: "0", unrealizedPnl: "0" },
    ],
    positionsJson: [],
    accountEquity: "75",
    availableEquity: "70",
    unrealizedPnl: "0",
    lastErrorCode: null,
  },
  realizedPnl: {
    asset: "USDT",
    total: "8.5",
    tradeCount: 2,
    points: [
      { observedAt: observedAt - 86_400_000, netPnl: "5", cumulativeNetPnl: "5", tradeCount: 1 },
      { observedAt, netPnl: "3.5", cumulativeNetPnl: "8.5", tradeCount: 1 },
    ],
  },
};

describe("connection-level WEEX dashboard", () => {
  it("renders synchronized account evidence even when the user has no cloud strategy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(synchronized), { status: 200 }));
    render(<RunPortfolioDashboard />);

    expect(await screen.findByText("WEEX 已連線")).toBeInTheDocument();
    expect(screen.getByText("AWS Executor 正常")).toBeInTheDocument();
    expect(screen.getAllByText("75.00 USDT")).toHaveLength(2);
    expect(screen.getByText("+3.50 USDT")).toBeInTheDocument();
    expect(screen.getByText("1 筆今日成交")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /USDT 75\.0%.*USDC 25\.0%/ })).toBeInTheDocument();
  });

  it("directs an authenticated user without a WEEX connection to the connection flow", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      runs: [],
      account: null,
      realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
    }), { status: 200 }));
    render(<RunPortfolioDashboard />);

    expect(await screen.findByText("先完成 WEEX 安全連線")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "連接 WEEX API" })).toHaveAttribute("href", "/connections");
    expect(screen.getByText("+0.00 USDT")).toBeInTheDocument();
  });
});
