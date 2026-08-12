import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseDashboard,
  RunPortfolioDashboard,
  type DashboardPayload,
} from "../components/runs/RunPortfolioDashboard";
import { parseOwnedPublicationSummary } from "../components/runs/ControlCenterJourney";
import { BOT_CATALOG } from "../data/bots";
import { saveDraft } from "../lib/storage";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const observedAt = new Date("2026-08-12T12:00:00+08:00").getTime();

const run = (
  id: string,
  name: string,
  symbol: string,
  state: "running" | "paused" | "stopped" | "error",
  overrides: Partial<DashboardPayload["runs"][number]> = {},
): DashboardPayload["runs"][number] => ({
  id,
  name,
  mode: "live",
  state,
  market: "futures",
  symbol,
  allowedSymbols: [symbol],
  evaluationCount: 12,
  signalCount: 4,
  lastEvaluatedAt: observedAt - 5_000,
  lastSignalJson: { action: "BUY" },
  lastErrorCode: null,
  consecutiveFailures: 0,
  maxTotalExposure: "100",
  maxDailyLoss: "20",
  ...overrides,
});

const account = (positions: DashboardPayload["account"] extends infer T
  ? T extends { positions: infer P } ? P : never : never): NonNullable<DashboardPayload["account"]> => ({
  connectionStatus: "active",
  syncStatus: "ready",
  accountUid: "account-1",
  observedAt,
  balances: [{ asset: "USDT", total: "100", available: "80", frozen: "20", unrealizedPnl: "10" }],
  positions,
  accountEquity: "100",
  availableEquity: "80",
  unrealizedPnl: "10",
  lastErrorCode: null,
});

const payload = (runs: DashboardPayload["runs"], positions: NonNullable<DashboardPayload["account"]>["positions"]): DashboardPayload => ({
  generatedAt: observedAt,
  runs,
  account: account(positions),
  realizedPnl: {
    asset: "USDT",
    total: "3",
    tradeCount: 1,
    points: [{ observedAt, netPnl: "3", cumulativeNetPnl: "3", tradeCount: 1 }],
  },
});

describe("control center product experience", () => {
  it("turns an authenticated empty account into a trustworthy setup dashboard", async () => {
    expect(saveDraft(BOT_CATALOG[0]!)).toEqual({ ok: true });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/strategy-publications/mine")) {
        return new Response(JSON.stringify({
          publications: [{ slug: "strategy-owned123", name: "公開網格", publishedAt: observedAt }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        runs: [],
        account: null,
        realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
      }), { status: 200 });
    });

    render(<RunPortfolioDashboard />);

    expect(await screen.findByRole("heading", { name: "先建立安全連線" })).toBeInTheDocument();
    expect(await screen.findByText(BOT_CATALOG[0]!.name)).toBeInTheDocument();
    expect(await screen.findByText("1 個已發布")).toBeInTheDocument();
    expect(screen.getByText(/保存在這個瀏覽器/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `繼續編輯 ${BOT_CATALOG[0]!.name}` })).toHaveAttribute("href", "/workshop");
    expect(screen.getAllByRole("link", { name: "連接 WEEX API" })).not.toHaveLength(0);
    expect(screen.getAllByText("等待快照").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("+0.00 USDT")).not.toBeInTheDocument();
  });

  it("keeps a pending connection usable before the first account snapshot exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      runs: [],
      account: {
        connectionStatus: "processing",
        syncStatus: "pending",
        accountUid: null,
        observedAt: null,
        balancesJson: null,
        positionsJson: null,
        accountEquity: null,
        availableEquity: null,
        unrealizedPnl: null,
        lastErrorCode: null,
      },
      realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
    }), { status: 200 }));

    render(<RunPortfolioDashboard />);

    expect(await screen.findByText("WEEX 連線驗證中")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "完成 WEEX 連線驗證" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看連線進度" })).toHaveAttribute("href", "/connections");
    expect(screen.getAllByText("等待快照").length).toBeGreaterThanOrEqual(2);
  });

  it("supports professional and quant reading layers plus search and sorting", async () => {
    const user = userEvent.setup();
    const dashboard = payload([
      run("beta", "Beta Reversal", "ETHUSDT", "error", { consecutiveFailures: 2, lastEvaluatedAt: observedAt - 20_000 }),
      run("alpha", "Alpha Trend", "BTCUSDT", "running"),
    ], [
      { symbol: "BTCUSDT", side: "long", leverage: "2", size: "1", openValue: "25", unrealizedPnl: "4", updatedAt: observedAt },
      { symbol: "ETHUSDT", side: "short", leverage: "1", size: "2", openValue: "40", unrealizedPnl: "6", updatedAt: observedAt },
    ]);
    render(<RunPortfolioDashboard autoRefresh={false} initialPayload={dashboard} />);

    expect(screen.getByRole("button", { name: "專業監控" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "量化證據" }));
    expect(screen.getByRole("columnheader", { name: "評估 / 訊號" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "連續失敗" })).toBeInTheDocument();
    expect(screen.getAllByText("12 / 4")).toHaveLength(2);

    const search = screen.getByRole("searchbox", { name: "搜尋策略名稱或市場" });
    await user.type(search, "BTC");
    expect(screen.getByRole("row", { name: /Alpha Trend/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Beta Reversal/ })).not.toBeInTheDocument();
    await user.clear(search);
    await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "name");
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Alpha Trend")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Beta Reversal")).toBeInTheDocument();
  });

  it("changes filters only from the swipe rail and preserves the table scroller at 768px", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 768 });
    const dashboard = payload([
      run("alpha", "Alpha Trend", "BTCUSDT", "running"),
      run("beta", "Beta Reversal", "ETHUSDT", "error"),
    ], []);
    render(<RunPortfolioDashboard autoRefresh={false} initialPayload={dashboard} />);
    const rail = screen.getByRole("group", { name: "滑動切換策略篩選" });
    const table = screen.getByRole("table");
    expect(rail).toHaveStyle({ touchAction: "pan-y" });
    expect(screen.getByRole("button", { name: "全部" })).toHaveStyle({ minHeight: "2.75rem" });

    fireEvent.touchStart(table, { touches: [{ clientX: 220, clientY: 100 }] });
    fireEvent.touchEnd(table, { changedTouches: [{ clientX: 120, clientY: 112 }] });
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.touchStart(rail, { touches: [{ clientX: 220, clientY: 100 }] });
    fireEvent.touchEnd(rail, { changedTouches: [{ clientX: 120, clientY: 112 }] });
    expect(screen.getByRole("button", { name: "運行中" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("row", { name: /Alpha Trend/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Beta Reversal/ })).not.toBeInTheDocument();

    fireEvent.touchStart(rail, { touches: [{ clientX: 200, clientY: 80 }] });
    fireEvent.touchEnd(rail, { changedTouches: [{ clientX: 150, clientY: 190 }] });
    expect(screen.getByRole("button", { name: "運行中" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not duplicate shared-market positions across strategies", () => {
    const dashboard = payload([
      run("one", "BTC One", "BTCUSDT", "running"),
      run("two", "BTC Two", "BTCUSDT", "running"),
    ], [{
      symbol: "BTCUSDT",
      side: "long",
      leverage: "2",
      size: "1",
      openValue: "50",
      unrealizedPnl: "10",
      updatedAt: observedAt,
    }]);
    render(<RunPortfolioDashboard autoRefresh={false} initialPayload={dashboard} />);

    expect(screen.getByText("重複交易目標無法安全對應")).toBeInTheDocument();
    expect(screen.getAllByText("不可歸屬").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("+10.00 USDT")).toHaveLength(1);
  });

  it("assigns a futures position to the unique non-stopped target instead of its stopped predecessor", () => {
    const dashboard = payload([
      run("old", "Stopped BTC", "BTCUSDT", "stopped"),
      run("current", "Running BTC", "BTCUSDT", "running"),
    ], [{
      symbol: "BTCUSDT",
      side: "long",
      leverage: "2",
      size: "1",
      openValue: "50",
      unrealizedPnl: "10",
      updatedAt: observedAt,
    }]);
    render(<RunPortfolioDashboard autoRefresh={false} initialPayload={dashboard} />);

    const stoppedRow = screen.getByRole("row", { name: /Stopped BTC/ });
    const runningRow = screen.getByRole("row", { name: /Running BTC/ });
    expect(within(stoppedRow).getAllByText("已停止，不歸屬目前合約部位")).not.toHaveLength(0);
    expect(within(stoppedRow).queryByText("+10.00 USDT")).not.toBeInTheDocument();
    expect(within(runningRow).getByText("+10.00 USDT")).toBeInTheDocument();
    expect(screen.queryByText("重複交易目標無法安全對應")).not.toBeInTheDocument();
  });

  it("does not let a spot target absorb or obscure the same-symbol futures position", () => {
    const dashboard = payload([
      run("spot", "Spot BTC", "BTCUSDT", "running", { market: "spot" }),
      run("futures", "Futures BTC", "BTCUSDT", "running", { market: "futures" }),
    ], [{
      symbol: "BTCUSDT",
      side: "long",
      leverage: "2",
      size: "1",
      openValue: "50",
      unrealizedPnl: "10",
      updatedAt: observedAt,
    }]);
    render(<RunPortfolioDashboard autoRefresh={false} initialPayload={dashboard} />);

    const spotRow = screen.getByRole("row", { name: /Spot BTC/ });
    const futuresRow = screen.getByRole("row", { name: /Futures BTC/ });
    expect(within(spotRow).getAllByText("現貨策略不歸屬合約部位")).not.toHaveLength(0);
    expect(within(spotRow).queryByText("+10.00 USDT")).not.toBeInTheDocument();
    expect(within(futuresRow).getByText("+10.00 USDT")).toBeInTheDocument();
    expect(screen.queryByText("重複交易目標無法安全對應")).not.toBeInTheDocument();
  });

  it("does not treat a broad risk allowlist as the run's execution target", () => {
    const dashboard = payload([
      run("eth", "ETH target", "ETHUSDT", "running", { allowedSymbols: ["BTCUSDT", "ETHUSDT"] }),
    ], [{
      symbol: "BTCUSDT",
      side: "long",
      leverage: "2",
      size: "1",
      openValue: "50",
      unrealizedPnl: "10",
      updatedAt: observedAt,
    }]);
    render(<RunPortfolioDashboard autoRefresh={false} initialPayload={dashboard} />);

    const row = screen.getByRole("row", { name: /ETH target/ });
    expect(within(row).queryByText("+10.00 USDT")).not.toBeInTheDocument();
    expect(within(row).getByText("目前無持倉")).toBeInTheDocument();
    expect(screen.getAllByText("+10.00 USDT")).toHaveLength(1);
  });

  it("blocks target attribution while Executor reports an unmanaged position", () => {
    const dashboard = payload([
      run("unmanaged", "Unmanaged BTC", "BTCUSDT", "error", {
        lastErrorCode: "unmanaged_position_state",
      }),
    ], [{
      symbol: "BTCUSDT",
      side: "long",
      leverage: "2",
      size: "1",
      openValue: "50",
      unrealizedPnl: "10",
      updatedAt: observedAt,
    }]);
    render(<RunPortfolioDashboard autoRefresh={false} initialPayload={dashboard} />);

    const row = screen.getByRole("row", { name: /Unmanaged BTC/ });
    expect(within(row).getAllByText("不可歸屬").length).toBeGreaterThanOrEqual(2);
    expect(within(row).getAllByText("帳戶部位狀態未受此運行管理")).not.toHaveLength(0);
    expect(within(row).queryByText("+10.00 USDT")).not.toBeInTheDocument();
    expect(screen.getAllByText("+10.00 USDT")).toHaveLength(1);
  });

  it("does not let a futures-demo run absorb or obscure a live account position", () => {
    const dashboard = payload([
      run("demo", "Demo BTC", "BTCUSDT", "running", { mode: "futures-demo" }),
      run("live", "Live BTC", "BTCUSDT", "running"),
    ], [{
      symbol: "BTCUSDT",
      side: "long",
      leverage: "2",
      size: "1",
      openValue: "50",
      unrealizedPnl: "10",
      updatedAt: observedAt,
    }]);
    render(<RunPortfolioDashboard autoRefresh={false} initialPayload={dashboard} />);

    const demoRow = screen.getByRole("row", { name: /Demo BTC/ });
    const liveRow = screen.getByRole("row", { name: /Live BTC/ });
    expect(within(demoRow).getAllByText("模擬運行不歸屬實盤帳戶部位")).not.toHaveLength(0);
    expect(within(demoRow).queryByText("+10.00 USDT")).not.toBeInTheDocument();
    expect(within(liveRow).getByText("+10.00 USDT")).toBeInTheDocument();
    expect(screen.queryByText("重複交易目標無法安全對應")).not.toBeInTheDocument();
  });

  it("marks malformed position evidence unavailable instead of silently treating it as zero", () => {
    const dashboard = payload([
      run("invalid", "Invalid evidence", "BTCUSDT", "running"),
    ], [{
      symbol: "BTCUSDT",
      side: "long",
      leverage: "2",
      size: "1",
      openValue: "invalid",
      unrealizedPnl: "invalid",
      updatedAt: observedAt,
    }]);
    render(<RunPortfolioDashboard autoRefresh={false} initialPayload={dashboard} />);

    const row = screen.getByRole("row", { name: /Invalid evidence/ });
    expect(within(row).getByText("尚無可信證據")).toBeInTheDocument();
    expect(within(row).queryByText("+0.00 USDT")).not.toBeInTheDocument();
    expect(within(row).queryByText("0%")).not.toBeInTheDocument();
  });

  it("treats duplicate live targets as attention even with no current position", () => {
    const dashboard = payload([
      run("one", "BTC One", "BTCUSDT", "running"),
      run("two", "BTC Two", "BTCUSDT", "running"),
    ], []);
    render(<RunPortfolioDashboard autoRefresh={false} initialPayload={dashboard} />);

    expect(screen.getByText("重複交易目標無法安全對應")).toBeInTheDocument();
    expect(screen.getByText(/即使目前空倉/)).toBeInTheDocument();
    expect(screen.getByText("2 個需注意")).toBeInTheDocument();
  });

  it("prioritizes danger alerts and reports the full alert count beyond the two-card summary", () => {
    const dashboard = payload([
      run("risk", "Risk Near Limit", "BTCUSDT", "running"),
      run("danger", "Critical Failure", "ETHUSDT", "error"),
    ], [{
      symbol: "BTCUSDT",
      side: "long",
      leverage: "2",
      size: "1",
      openValue: "90",
      unrealizedPnl: "4",
      updatedAt: observedAt,
    }]);
    dashboard.account!.lastErrorCode = "account_sync_unavailable";
    render(<RunPortfolioDashboard autoRefresh={false} initialPayload={dashboard} />);

    const alertPanel = screen.getByRole("heading", { name: "需要處理" }).closest("aside");
    expect(alertPanel).not.toBeNull();
    const alertView = within(alertPanel!);
    expect(alertView.getByText("3")).toBeInTheDocument();
    const visibleAlerts = alertView.getAllByRole("listitem");
    expect(visibleAlerts).toHaveLength(2);
    expect(visibleAlerts[0]).toHaveAttribute("data-tone", "danger");
    expect(within(visibleAlerts[0]!).getByText("Critical Failure 需要處理")).toBeInTheDocument();
    expect(alertView.queryByText("Risk Near Limit 曝險接近上限")).not.toBeInTheDocument();

    fireEvent.click(alertView.getByRole("button", { name: "查看全部提醒" }));
    expect(alertView.getAllByRole("listitem")).toHaveLength(3);
    expect(alertView.getByText("Risk Near Limit 曝險接近上限")).toBeInTheDocument();
    expect(alertView.getByRole("button", { name: "收合提醒" })).toHaveAttribute("aria-expanded", "true");
  });

  it("requires the persisted market and symbol target in dashboard API payloads", () => {
    const persisted = run("target", "Persisted target", "BTCUSDT", "running", {
      allowedSymbols: ["BTCUSDT", "ETHUSDT"],
    });
    expect(parseDashboard({
      generatedAt: observedAt,
      runs: [persisted],
      account: null,
      realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
    })?.runs[0]).toMatchObject({ mode: "live", market: "futures", symbol: "BTCUSDT" });
    const withoutMarket: Record<string, unknown> = { ...persisted };
    delete withoutMarket.market;
    expect(parseDashboard({
      generatedAt: observedAt,
      runs: [withoutMarket],
      account: null,
      realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
    })).toBeNull();
    const withoutMode: Record<string, unknown> = { ...persisted };
    delete withoutMode.mode;
    expect(parseDashboard({
      generatedAt: observedAt,
      runs: [withoutMode],
      account: null,
      realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
    })).toBeNull();
  });

  it("accepts only bounded owned-publication summaries", () => {
    expect(parseOwnedPublicationSummary({
      publications: [
        { slug: "strategy-older123", name: "Older", publishedAt: 100 },
        { slug: "strategy-latest12", name: "Latest", publishedAt: 200 },
      ],
    })).toEqual({ count: 2, latest: { slug: "strategy-latest12", name: "Latest", publishedAt: 200 } });
    expect(parseOwnedPublicationSummary({
      publications: [{ slug: "../unsafe", name: "Unsafe", publishedAt: 200 }],
    })).toBeNull();
  });
});
