import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import LeaderboardPage from "../app/leaderboard/page";
import { BOT_CATALOG } from "../data/bots";

afterEach(cleanup);

function renderLeaderboard() {
  return render(<LeaderboardPage />);
}

function rowFor(name: string) {
  return screen.getByRole("row", { name: new RegExp(name) });
}

describe("dynamic leaderboard", () => {
  it("projects total return for the 30, 90, and 365 day periods with fixed factors", async () => {
    const user = userEvent.setup();
    renderLeaderboard();

    const table = screen.getByRole("table", { name: "完整機器人績效排名" });
    expect(within(rowFor("Breakout Hunter")).getByText("+142.8%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "30 天" }));
    expect(within(rowFor("Breakout Hunter")).getByText("+20.0%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "90 天" }));
    expect(within(rowFor("Breakout Hunter")).getByText("+52.8%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1 年" }));
    expect(within(rowFor("Breakout Hunter")).getByText("+142.8%")).toBeInTheDocument();
    expect(table).toBeInTheDocument();
  });

  it("sorts by return, stability, lowest absolute drawdown, and Sharpe", async () => {
    const user = userEvent.setup();
    renderLeaderboard();
    const sort = screen.getByRole("combobox", { name: "排序指標" });

    const rankedIds = () => within(screen.getByRole("table", { name: "完整機器人績效排名" }))
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.getAttribute("data-bot-id"));

    expect(rankedIds()).toEqual([
      "breakout-hunter", "momentum-forge", "dual-side-ranger", "atr-sentinel", "bollinger-pulse",
      "leverage-guardian", "golden-cross", "grid-navigator", "rsi-rebound", "orbit-dca",
    ]);

    await user.selectOptions(sort, "stability");
    expect(rankedIds()).toEqual([
      "orbit-dca", "leverage-guardian", "grid-navigator", "rsi-rebound", "atr-sentinel",
      "golden-cross", "bollinger-pulse", "momentum-forge", "dual-side-ranger", "breakout-hunter",
    ]);

    await user.selectOptions(sort, "drawdown");
    expect(rankedIds()).toEqual([
      "orbit-dca", "rsi-rebound", "leverage-guardian", "grid-navigator", "golden-cross",
      "bollinger-pulse", "atr-sentinel", "momentum-forge", "dual-side-ranger", "breakout-hunter",
    ]);
    expect(screen.getByRole("heading", { name: "最大回撤比較（越短越好）" })).toBeInTheDocument();

    await user.selectOptions(sort, "sharpe");
    expect(rankedIds()).toEqual([
      "leverage-guardian", "atr-sentinel", "momentum-forge", "breakout-hunter", "grid-navigator",
      "bollinger-pulse", "rsi-rebound", "dual-side-ranger", "golden-cross", "orbit-dca",
    ]);
  });

  it("does not mutate the shared bot catalog while projecting and sorting", async () => {
    const before = JSON.stringify(BOT_CATALOG);
    const user = userEvent.setup();
    renderLeaderboard();

    await user.click(screen.getByRole("button", { name: "30 天" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "排序指標" }), "drawdown");

    expect(JSON.stringify(BOT_CATALOG)).toBe(before);
  });

  it("renders all ten bots in an accessible complete table", async () => {
    renderLeaderboard();

    const table = screen.getByRole("table", { name: "完整機器人績效排名" });
    expect(within(table).getAllByRole("row")).toHaveLength(BOT_CATALOG.length + 1);
    for (const bot of BOT_CATALOG) {
      expect(within(table).getByRole("row", { name: new RegExp(bot.name) })).toHaveAttribute("data-bot-id", bot.id);
    }
  });

  it("labels controls and performance surfaces and repeats the exact simulation disclosure", async () => {
    renderLeaderboard();

    expect(screen.getByRole("group", { name: "績效期間" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "排序指標" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "前三名頒獎台" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "機器人績效比較" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "風險與收益分布" })).toBeInTheDocument();
    expect(screen.getAllByText("模擬回測資料，不代表未來績效").length).toBeGreaterThanOrEqual(5);
  });

  it("leaves the root layout as the only main landmark", () => {
    const { container } = renderLeaderboard();

    expect(container.querySelector("main")).toBeNull();
  });

  it("keeps risk and return data points exposed as native links", () => {
    renderLeaderboard();

    const panel = screen.getByRole("region", { name: "風險與收益分布" });
    expect(within(panel).getAllByRole("link")).toHaveLength(BOT_CATALOG.length);
    expect(within(panel).getAllByRole("listitem")).toHaveLength(BOT_CATALOG.length);
  });

  it("uses relative day labels for projected short-period curves", async () => {
    const user = userEvent.setup();
    renderLeaderboard();

    await user.click(screen.getByRole("button", { name: "30 天" }));
    const chart = screen.getByRole("figure", { name: /30 天收益曲線/ });
    expect(within(chart).getByRole("listitem", { name: /第 1 天/ })).toBeInTheDocument();
    expect(within(chart).getByRole("listitem", { name: /第 30 天/ })).toBeInTheDocument();
    expect(within(chart).queryByRole("listitem", { name: /7月/ })).not.toBeInTheDocument();
  });
});
