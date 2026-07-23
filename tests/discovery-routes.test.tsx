import { existsSync } from "node:fs";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BotDetailPage, { generateStaticParams } from "../app/bots/[id]/page";
import { benchmarkSeries } from "../lib/benchmark-series";
import BotsPage from "../app/bots/page";
import FavoritesPage from "../app/favorites/page";
import NotFoundPage from "../app/not-found";
import Home from "../app/page";
import { StrategyShareActions } from "../components/StrategyShareActions";
import { BOT_CATALOG } from "../data/bots";
import { signInDemo } from "../lib/demo-auth";
import type { WeexHistoricalPerformance } from "../lib/types";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const REAL_RETURNS: Record<string, number> = {
  "momentum-forge": 15.4,
  "orbit-dca": 0.5,
  "grid-navigator": 0.4,
  "golden-cross": 0.1,
  "bollinger-pulse": 0,
  "rsi-rebound": -0.5,
  "dual-side-ranger": -3.6,
  "atr-sentinel": -5.1,
  "leverage-guardian": -19.5,
  "breakout-hunter": -24.9,
};
const historicalReturn = (botId: string) => REAL_RETURNS[botId] ?? 1;

const performanceFixture = (): Record<string, WeexHistoricalPerformance> => Object.fromEntries(BOT_CATALOG.map((bot) => [bot.id, {
  metrics: { ...bot.metrics, totalReturn: historicalReturn(bot.id) },
  equityCurve: bot.equityCurve.map((point, index) => ({ ...point, value: 100 + (historicalReturn(bot.id) * index / Math.max(bot.equityCurve.length - 1, 1)) })),
  generatedAt: "2026-07-13T12:00:00.000Z",
  disclaimer: "WEEX 歷史行情回測，不代表未來績效",
  evidence: {
    level: "historical", provider: "WEEX", market: bot.market, symbol: bot.symbol, interval: bot.timeframe,
    startTime: 1_751_846_400_000, endTime: 1_754_438_400_000, collectedAt: 1_754_438_400_000,
    candleCount: bot.market === "spot" ? 180 : 720, complete: true, feeRate: "0.001", slippageRate: "0.0005",
    fundingIncluded: false, datasetDigest: "d".repeat(64), engineVersion: "test",
  },
}]));

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
    performances: performanceFixture(),
    updatedAt: "2026-07-13T12:00:00.000Z",
  }), { status: 200 }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
  else Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("landing page", () => {
  it("introduces the approved WEEX-recommended discovery flow", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1, name: "簡單點選，實現自動化策略" })).toBeInTheDocument();
    expect(screen.queryByText("WEEX 專用 · 先模擬")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "探索策略" })).toHaveAttribute("href", "/bots");
    expect(screen.getByRole("link", { name: "從空白組裝" })).toHaveAttribute("href", "/workshop?new=1");
  });

  it("presents the three-step flow and required product sections", async () => {
    render(<Home />);

    const flow = screen.getByRole("region", { name: "三步驟開始使用" });
    expect(within(flow).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "自由組裝各種策略" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "策略模組依序加入並完成組裝的動畫" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "支援匯入交易策略代碼" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "交易策略代碼輸入、掃描並完成匯入驗證的動畫" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "熱門機器人" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "近期績效排行榜" })).not.toBeInTheDocument();
    expect(screen.queryByText("SECURE CONNECTION")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看安全連線流程" })).not.toBeInTheDocument();
  });

  it("uses an explicit blank-workshop flag for the landing CTA", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: "從空白開始" })).toHaveAttribute("href", "/workshop?new=1");
  });

  it("renders featured bot cards from WEEX historical performance with complete metrics and accessible actions", async () => {
    render(<Home />);

    const featured = await screen.findByRole("region", { name: "熱門機器人" });
    expect(within(featured).getAllByRole("article")).toHaveLength(3);
    expect(within(featured).getByText("動能鍛造者")).toBeInTheDocument();
    expect(within(featured).queryByText("突破獵手")).not.toBeInTheDocument();
    expect(within(featured).getByText("+15.4%")).toBeInTheDocument();
    expect(within(featured).getAllByText("交易績效")).toHaveLength(3);
    expect(within(featured).getAllByText("最大回撤")).toHaveLength(3);
    expect(within(featured).getAllByText("勝率")).toHaveLength(3);
    expect(within(featured).getAllByRole("link", { name: /查看策略/ })).toHaveLength(3);
    expect(within(featured).getAllByRole("link", { name: /直接套用/ })).toHaveLength(3);
    expect(within(featured).queryByRole("button", { name: /下載/ })).not.toBeInTheDocument();
    expect(within(featured).getAllByText("公開歷史行情回測，不代表未來績效")).toHaveLength(3);
  });

  it("keeps the removed ranking preview off the homepage", async () => {
    render(<Home />);

    await screen.findByRole("region", { name: "熱門機器人" });
    expect(screen.queryByRole("region", { name: "近期績效排行榜" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看完整排行榜" })).not.toBeInTheDocument();
  });

  it("does not fall back to simulated featured rankings when WEEX data fails", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("offline"));
    render(<Home />);

    const errorRegion = screen.getByRole("region", { name: "熱門機器人近期績效" });
    expect(await within(errorRegion).findByRole("alert")).toHaveTextContent("近期熱門策略暫時無法取得");
    expect(within(errorRegion).queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("+142.8%")).not.toBeInTheDocument();
  });
});

describe("bot catalog route", () => {
  it("exports a renderable catalog page", async () => {
    await expect(import("../app/bots/page")).resolves.toHaveProperty("default");
  });

  it("filters the ten bots by market, risk, and strategy tag", async () => {
    const user = userEvent.setup();
    const { container } = render(<BotsPage />);

    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.getByRole("heading", { name: "登入後，繼續探索完整策略庫" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登入繼續探索" })).toHaveAttribute("href", "/auth?return_to=%2Fbots");
    expect(screen.queryByText(/另外\s*\d+\s*組策略/)).not.toBeInTheDocument();
    expect(screen.getByText("目前顯示 6 組符合策略")).toBeInTheDocument();
    expect(container.querySelector(".catalog-member-preview")).not.toBeInTheDocument();
    expect(container.querySelector(".catalog-member-backdrop")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".catalog-member-backdrop__card")).toHaveLength(3);
    expect(container.querySelectorAll(".catalog-member-backdrop__card img")).toHaveLength(3);
    const dataNote = await screen.findByText("研究資料說明");
    const resultsGrid = container.querySelector(".bot-grid");
    const memberVault = container.querySelector(".catalog-member-vault");
    expect(resultsGrid?.nextElementSibling).toBe(memberVault);
    expect(memberVault?.nextElementSibling).toBe(dataNote.closest(".research-data-note--catalog"));
    await user.click(screen.getByRole("button", { name: /^現貨/ }));
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.queryByText("動能鍛造者")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "風險等級" }), "中");
    expect(screen.getAllByRole("article")).toHaveLength(4);

    await user.selectOptions(screen.getByRole("combobox", { name: "策略類型" }), "風控");
    expect(screen.getByText("沒有符合條件的策略")).toBeInTheDocument();
  });

  it("unlocks the complete strategy catalog after login", () => {
    act(() => signInDemo({ displayName: "策略會員", email: "member@example.test", provider: "email" }));
    render(<BotsPage />);

    expect(screen.getAllByRole("article")).toHaveLength(20);
    expect(screen.queryByRole("heading", { name: "登入後，繼續探索完整策略庫" })).not.toBeInTheDocument();
    expect(screen.getByText("顯示 20 / 20 組符合策略")).toBeInTheDocument();
  });

  it("sorts visible bots from derived catalog data", async () => {
    const user = userEvent.setup();
    render(<BotsPage />);

    await user.selectOptions(screen.getByRole("combobox", { name: "排序方式" }), "return-desc");
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("動能鍛造者"));

    await user.selectOptions(screen.getByRole("combobox", { name: "排序方式" }), "drawdown-asc");
    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("布林脈衝");
    expect(screen.getByText("目前顯示 6 組符合策略")).toBeInTheDocument();
  });

  it("filters by trading timeframe", async () => {
    const user = userEvent.setup();
    render(<BotsPage />);

    await user.click(screen.getByRole("button", { name: /^4h/ }));

    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.queryByText("動能鍛造者")).not.toBeInTheDocument();
  });

  it("favorites bots and persists favorites plus recent discovery preferences", async () => {
    const user = userEvent.setup();
    const first = render(<BotsPage />);

    await user.click(screen.getByRole("button", { name: "收藏 軌道定投" }));
    await user.click(screen.getByRole("button", { name: /^現貨/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "風險等級" }), "中");
    await user.selectOptions(screen.getByRole("combobox", { name: "策略類型" }), "均線");
    await user.click(screen.getByRole("button", { name: /^4h/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "排序方式" }), "stability-desc");
    first.unmount();

    render(<BotsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^現貨/ })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("combobox", { name: "風險等級" })).toHaveValue("中");
    expect(screen.getByRole("combobox", { name: "策略類型" })).toHaveValue("均線");
    expect(screen.getByRole("button", { name: /^4h/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "排序方式" })).toHaveValue("stability-desc");
    await user.click(screen.getByRole("button", { name: "重設篩選" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消收藏 軌道定投" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("fails safely when discovery preferences cannot be stored", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const user = userEvent.setup();
    render(<BotsPage />);

    await user.click(screen.getByRole("button", { name: /^現貨/ }));

    expect(screen.getByText(/無法儲存探索偏好/)).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(5);
  });

  it("ignores unknown stored filters and favorite ids", async () => {
    localStorage.setItem("cryptobot-labs:discovery:v1", JSON.stringify({
      market: "all", risk: "all", tag: "未知標籤", timeframe: "99h",
      sort: "return-desc", favorites: ["unknown-bot"],
    }));

    render(<BotsPage />);

    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 10)); });
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.getByRole("combobox", { name: "策略類型" })).toHaveValue("all");
    expect(within(screen.getByRole("group", { name: "交易週期" })).getByRole("button", { name: /^全部/ }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /取消收藏/ })).not.toBeInTheDocument();
  });

});

describe("favorite strategies route", () => {
  it("shows saved strategies and removes them from the shared discovery preferences", async () => {
    localStorage.setItem("cryptobot-labs:discovery:v1", JSON.stringify({
      market: "all",
      risk: "all",
      tag: "all",
      timeframe: "all",
      sort: "recommended",
      favorites: ["orbit-dca", "momentum-forge"],
    }));
    const user = userEvent.setup();
    render(<FavoritesPage />);

    expect(await screen.findByRole("heading", { name: "軌道定投" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "動能鍛造者" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消收藏 軌道定投" }));

    expect(screen.queryByRole("heading", { name: "軌道定投" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("cryptobot-labs:discovery:v1") ?? "{}")).toMatchObject({
      favorites: ["momentum-forge"],
    });
  });

  it("guides an empty collection back to strategy discovery", async () => {
    render(<FavoritesPage />);

    expect(await screen.findByRole("heading", { name: "尚未收藏任何策略" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "探索策略" })).toHaveAttribute("href", "/bots");
  });
});

describe("bot detail route", () => {
  it("exports a renderable dynamic detail page", async () => {
    await expect(import("../app/bots/[id]/page")).resolves.toHaveProperty("default");
  });

  it("offers direct share shortcuts for major social platforms", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    render(<StrategyShareActions botId="orbit-dca" botName="軌道定投" via="cryptobot-labs" />);

    const quickShare = screen.getByRole("group", { name: "快速分享到社群媒體" });
    expect(within(quickShare).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["LINE", "X", "Facebook", "Telegram"]);
    await user.click(within(quickShare).getByRole("button", { name: "LINE" }));
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("https://line.me/R/share?text="),
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("prebuilds and resolves every catalog bot id", async () => {
    expect(generateStaticParams()).toEqual(BOT_CATALOG.map((bot) => ({ id: bot.id })));

    for (const bot of BOT_CATALOG) {
      const view = await BotDetailPage({ params: Promise.resolve({ id: bot.id }) });
      const { unmount } = render(view);
      expect(screen.getByRole("heading", { level: 1, name: bot.name })).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "直接套用" }).every((link) => link.getAttribute("href") === `/workshop?bot=${bot.id}&version=1`)).toBe(true);
      expect(screen.queryByRole("button", { name: /下載/ })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("renders full metrics, equity, monthly performance, and strategy guidance", async () => {
    const view = await BotDetailPage({ params: Promise.resolve({ id: "orbit-dca" }) });
    render(view);

    const metrics = await screen.findByRole("region", { name: "完整績效指標" });
    expect(within(metrics).getAllByRole("article")).toHaveLength(9);
    expect(within(metrics).getByText("WEEX 歷史行情回測，不代表未來績效")).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: /軌道定投 交易績效曲線/ })).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: /市場基準曲線/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "策略與基準比較摘要" })).toHaveTextContent("期末淨值");
    expect(screen.getByRole("table", { name: "軌道定投 分段表現" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "策略原理" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "適用市場" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "風險說明" })).toBeInTheDocument();
    expect(screen.getAllByText("WEEX 歷史行情回測，不代表未來績效").length).toBeGreaterThan(0);
  });

  it("derives a deterministic benchmark series beside each bot", () => {
    expect(benchmarkSeries(BOT_CATALOG[0])).toEqual(benchmarkSeries(BOT_CATALOG[0]));
    expect(benchmarkSeries(BOT_CATALOG[0])).toHaveLength(BOT_CATALOG[0].equityCurve.length);
    expect(benchmarkSeries(BOT_CATALOG[0])).not.toEqual(BOT_CATALOG[0].equityCurve);
  });

  it("throws the framework 404 boundary for unknown ids", async () => {
    await expect(BotDetailPage({ params: Promise.resolve({ id: "unknown-bot" }) }))
      .rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("provides an app-level not-found recovery route", () => {
    expect(existsSync("app/not-found.tsx")).toBe(true);
  });

  it("renders Traditional Chinese recovery actions at the not-found boundary", () => {
    render(<NotFoundPage />);

    expect(screen.getByRole("heading", { name: "找不到這個頁面" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回首頁" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "探索策略" })).toHaveAttribute("href", "/bots");
  });
});
