import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LeaderboardPage from "../app/leaderboard/page";
import { BOT_CATALOG } from "../data/bots";
import type { WeexHistoricalPerformance } from "../lib/types";
import { clearWeexBotPerformanceCache } from "../lib/weex-historical-client";
import { verifiedHistoricalPerformance } from "./fixtures/verified-historical-performance";

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

const performanceFixture = (): Record<string, WeexHistoricalPerformance> => Object.fromEntries(BOT_CATALOG.map((bot) => [bot.id,
  verifiedHistoricalPerformance(bot, {
    metrics: { ...bot.metrics, totalReturn: historicalReturn(bot.id) },
    equityCurve: bot.equityCurve.map((point, index) => ({
      ...point,
      value: 100 + ((point.value - 100) * 0.1)
        + (historicalReturn(bot.id) * index / Math.max(bot.equityCurve.length - 1, 1)),
    })),
  }),
]));

beforeEach(() => {
  clearWeexBotPerformanceCache();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
    performances: performanceFixture(),
    updatedAt: "2026-07-13T12:00:00.000Z",
  }), { status: 200 }));
});

afterEach(() => {
  clearWeexBotPerformanceCache();
  cleanup();
  vi.restoreAllMocks();
});

async function renderReady() {
  render(<LeaderboardPage />);
  return await screen.findByRole("table", { name: "完整機器人績效排名" });
}

function rankedIds() {
  return within(screen.getByRole("table", { name: "完整機器人績效排名" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.getAttribute("data-bot-id"));
}

describe("WEEX historical leaderboard", () => {
  it("waits for WEEX results and never presents the old projected static returns", async () => {
    render(<LeaderboardPage />);
    expect(screen.getByRole("status")).toHaveTextContent("正在計算近期績效");
    expect(screen.queryByText("+142.8%")).not.toBeInTheDocument();

    const table = await screen.findByRole("table", { name: "完整機器人績效排名" });
    expect(within(table).getByRole("row", { name: /突破獵手/ })).toHaveTextContent("-24.9%");
    expect(within(table).getByRole("row", { name: /動能鍛造者/ })).toHaveTextContent("+15.4%");
    expect(screen.queryByText("+142.8%")).not.toBeInTheDocument();
  });

  it("uses the truthful 30-day interval instead of synthetic 90-day and annual projections", async () => {
    await renderReady();
    expect(screen.getByText("近 30 天")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "90 天" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "1 年" })).not.toBeInTheDocument();
  });

  it("sorts every leaderboard surface from the loaded historical metrics", async () => {
    const user = userEvent.setup();
    await renderReady();
    expect(rankedIds()[0]).toBe("momentum-forge");
    expect(rankedIds().at(-1)).toBe("breakout-hunter");
    const sortControls = screen.getByRole("group", { name: "戰況排序" });
    const returnButton = within(sortControls).getByRole("button", { name: "交易績效" });
    const winRateButton = within(sortControls).getByRole("button", { name: "勝率" });
    const tradesButton = within(sortControls).getByRole("button", { name: "交易次數" });
    const stabilityButton = within(sortControls).getByRole("button", { name: "穩定度" });
    expect(returnButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("combobox", { name: "排序指標" })).not.toBeInTheDocument();

    await user.click(stabilityButton);
    expect(rankedIds()[0]).toBe("orbit-dca");
    expect(stabilityButton).toHaveAttribute("aria-pressed", "true");
    expect(returnButton).toHaveAttribute("aria-pressed", "false");

    await user.click(within(sortControls).getByRole("button", { name: "低回撤" }));
    expect(rankedIds()[0]).toBe("bollinger-pulse");

    await user.click(winRateButton);
    expect(rankedIds()[0]).toBe([...BOT_CATALOG].toSorted((a, b) => b.metrics.winRate - a.metrics.winRate || a.id.localeCompare(b.id))[0]?.id);
    expect(winRateButton).toHaveAttribute("aria-pressed", "true");

    await user.click(tradesButton);
    expect(rankedIds()[0]).toBe([...BOT_CATALOG].toSorted((a, b) => b.metrics.trades - a.metrics.trades || a.id.localeCompare(b.id))[0]?.id);
    expect(tradesButton).toHaveAttribute("aria-pressed", "true");
  });

  it("sorts the complete performance table from its metric headers in both directions", async () => {
    const user = userEvent.setup();
    const table = await renderReady();
    const returnHeader = within(table).getByRole("columnheader", { name: "交易績效" });
    const winRateHeader = within(table).getByRole("columnheader", { name: "勝率" });

    expect(returnHeader).toHaveAttribute("aria-sort", "descending");
    expect(rankedIds()[0]).toBe("momentum-forge");

    await user.click(within(returnHeader).getByRole("button", { name: "交易績效" }));
    expect(returnHeader).toHaveAttribute("aria-sort", "ascending");
    expect(rankedIds()[0]).toBe("breakout-hunter");

    await user.click(within(winRateHeader).getByRole("button", { name: "勝率" }));
    expect(winRateHeader).toHaveAttribute("aria-sort", "descending");
    expect(rankedIds()[0]).toBe([...BOT_CATALOG].toSorted((a, b) => b.metrics.winRate - a.metrics.winRate || a.id.localeCompare(b.id))[0]?.id);

    await user.click(within(winRateHeader).getByRole("button", { name: "勝率" }));
    expect(winRateHeader).toHaveAttribute("aria-sort", "ascending");
    expect(rankedIds()[0]).toBe([...BOT_CATALOG].toSorted((a, b) => a.metrics.winRate - b.metrics.winRate || a.id.localeCompare(b.id))[0]?.id);
  });

  it("renders an animated, clickable multi-line trading battle chart", async () => {
    await renderReady();
    const battle = screen.getByRole("region", { name: "機器人交易戰況" });
    expect(within(battle).getByRole("heading", { name: "機器人交易戰況" })).toBeInTheDocument();
    expect(within(battle).queryByText("交易績效比較")).not.toBeInTheDocument();
    const lines = battle.querySelectorAll(".battle-chart__line");
    const hitAreas = battle.querySelectorAll(".battle-chart__hit");
    const endLabels = battle.querySelectorAll(".battle-chart__end-label");
    const endCards = battle.querySelectorAll(".battle-chart__end-card");
    const axisLabels = battle.querySelectorAll(".battle-chart__axis-label");
    expect(lines).toHaveLength(10);
    expect(hitAreas).toHaveLength(10);
    expect(endLabels).toHaveLength(10);
    expect(endCards).toHaveLength(10);
    expect(axisLabels.length).toBeGreaterThanOrEqual(10);
    const labelPositions = [...endLabels].map((label) => Number(label.getAttribute("y"))).sort((a, b) => a - b);
    expect(Math.min(...labelPositions)).toBeGreaterThanOrEqual(30);
    expect(Math.max(...labelPositions)).toBeLessThanOrEqual(440);
    expect(labelPositions.slice(1).every((position, index) => position - labelPositions[index]! >= 40)).toBe(true);
    expect([...lines].every((line) => line.getAttribute("fill") === "none" && Boolean(line.getAttribute("stroke")))).toBe(true);
    expect([...hitAreas].every((line) => line.getAttribute("fill") === "none" && line.getAttribute("stroke") === "transparent")).toBe(true);
    expect(within(battle).getByRole("link", { name: /查看 動能鍛造者/ })).toHaveAttribute("href", "/bots/momentum-forge");
    expect(within(battle).getByRole("link", { name: /動能鍛造者\+15\.4%/ })).toHaveAttribute("href", "/bots/momentum-forge");
    const stableBotColor = battle.querySelector('[data-bot-id="rsi-deep-zone-reversal"] .battle-chart__line')?.getAttribute("stroke");
    await userEvent.click(within(battle).getByRole("button", { name: "穩定度" }));
    expect(battle.querySelector('[data-bot-id="rsi-deep-zone-reversal"] .battle-chart__line')?.getAttribute("stroke")).toBe(stableBotColor);
  });

  it("keeps the historical-data explanation to one compact footer note", async () => {
    await renderReady();
    expect(screen.getAllByText(/資料說明：近 30 天 WEEX 公開歷史 K 線/)).toHaveLength(1);
    expect(screen.queryByText(/WEEX 歷史績效更新/)).not.toBeInTheDocument();
    expect(screen.queryByText(/根 K 線/)).not.toBeInTheDocument();
    expect(screen.queryByText(/整體上升|整體下降|整體持平/)).not.toBeInTheDocument();
  });

  it("shows no substitute ranking if the historical endpoint fails", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("offline"));
    render(<LeaderboardPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("近期績效暫時無法取得"));
    expect(screen.queryByRole("table", { name: "完整機器人績效排名" })).not.toBeInTheDocument();
    expect(screen.queryByText("+142.8%")).not.toBeInTheDocument();
  });

  it("renders native links for all risk and return points", async () => {
    await renderReady();
    expect(screen.queryByText("LEADER CURVE")).not.toBeInTheDocument();
    expect(screen.queryByText(/收益軌跡/)).not.toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "風險與收益分布" });
    expect(within(panel).getAllByRole("link")).toHaveLength(BOT_CATALOG.length);
    expect(within(panel).getAllByRole("listitem")).toHaveLength(BOT_CATALOG.length);
  });

  it("uses fast motion timings and respects reduced motion", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const battleCss = readFileSync("components/LeaderboardTable.module.css", "utf8");
    expect(battleCss).toMatch(/battleLineDraw 460ms/);
    expect(battleCss).toMatch(/\.plot[^}]*fill: none/);
    expect(battleCss).toMatch(/\.legend[^}]*display: flex/);
    expect(css).toMatch(/trend-line-draw 480ms/);
    expect(css).toMatch(/arena-trend-draw 440ms/);
    expect(battleCss).toMatch(/prefers-reduced-motion:[\s\S]*\.line/);
  });
});
