import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import BotDetailPage, { generateStaticParams } from "../app/bots/[id]/page";
import BotsPage from "../app/bots/page";
import Home from "../app/page";
import { BOT_CATALOG } from "../data/bots";

afterEach(cleanup);

describe("landing page", () => {
  it("introduces the approved WEEX-only discovery flow", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1, name: "把交易想法，組裝成你的機器人。" })).toBeInTheDocument();
    expect(screen.getByText("WEEX ONLY")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "探索機器人" })).toHaveAttribute("href", "/bots");
    expect(screen.getByRole("link", { name: "開始組裝" })).toHaveAttribute("href", "/workshop");
  });

  it("presents the three-step flow and required product sections", () => {
    render(<Home />);

    const flow = screen.getByRole("region", { name: "三步驟開始使用" });
    expect(within(flow).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "多策略，自由組裝。" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "用 JavaScript 寫下你的交易邏輯。" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "熱門機器人" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "績效排行榜預覽" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "只為 WEEX 而生。" })).toBeInTheDocument();
  });

  it("renders featured bot cards with complete metrics and accessible actions", () => {
    render(<Home />);

    const featured = screen.getByRole("region", { name: "熱門機器人" });
    expect(within(featured).getAllByRole("article")).toHaveLength(3);
    expect(within(featured).getByText("Orbit DCA")).toBeInTheDocument();
    expect(within(featured).getAllByText("累積收益")).toHaveLength(3);
    expect(within(featured).getAllByText("最大回撤")).toHaveLength(3);
    expect(within(featured).getAllByText("勝率")).toHaveLength(3);
    expect(within(featured).getAllByRole("link", { name: /查看詳情/ })).toHaveLength(3);
    expect(within(featured).getAllByRole("link", { name: /複製到組裝車間/ })).toHaveLength(3);
    expect(within(featured).getAllByRole("button", { name: /快速下載/ })).toHaveLength(3);
    expect(within(featured).getAllByText("模擬回測資料，不代表未來績效")).toHaveLength(3);
  });

  it("shows a disclosed leaderboard preview with a real destination", () => {
    render(<Home />);

    const preview = screen.getByRole("region", { name: "績效排行榜預覽" });
    expect(within(preview).getAllByRole("listitem")).toHaveLength(3);
    expect(within(preview).getByText("Breakout Hunter")).toBeInTheDocument();
    expect(within(preview).getByText("模擬回測資料，不代表未來績效")).toBeInTheDocument();
    expect(within(preview).getByRole("link", { name: "查看完整排行榜" })).toHaveAttribute("href", "/leaderboard");
  });
});

describe("bot catalog route", () => {
  it("exports a renderable catalog page", async () => {
    await expect(import("../app/bots/page")).resolves.toHaveProperty("default");
  });

  it("filters the ten bots by market, risk, and strategy tag", async () => {
    const user = userEvent.setup();
    render(<BotsPage />);

    expect(screen.getAllByRole("article")).toHaveLength(10);
    await user.selectOptions(screen.getByRole("combobox", { name: "市場" }), "spot");
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.queryByText("Momentum Forge")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "風險等級" }), "中");
    expect(screen.getAllByRole("article")).toHaveLength(4);

    await user.selectOptions(screen.getByRole("combobox", { name: "策略類型" }), "風控");
    expect(screen.getByText("沒有符合條件的機器人")).toBeInTheDocument();
  });

  it("sorts visible bots from derived catalog data", async () => {
    const user = userEvent.setup();
    render(<BotsPage />);

    await user.selectOptions(screen.getByRole("combobox", { name: "排序方式" }), "return-desc");
    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("Breakout Hunter");

    await user.selectOptions(screen.getByRole("combobox", { name: "排序方式" }), "drawdown-asc");
    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("Orbit DCA");
    expect(screen.getByText("顯示 10 / 10 組策略")).toBeInTheDocument();
  });
});

describe("bot detail route", () => {
  it("exports a renderable dynamic detail page", async () => {
    await expect(import("../app/bots/[id]/page")).resolves.toHaveProperty("default");
  });

  it("prebuilds and resolves every catalog bot id", async () => {
    expect(generateStaticParams()).toEqual(BOT_CATALOG.map((bot) => ({ id: bot.id })));

    for (const bot of BOT_CATALOG) {
      const view = await BotDetailPage({ params: Promise.resolve({ id: bot.id }) });
      const { unmount } = render(view);
      expect(screen.getByRole("heading", { level: 1, name: bot.name })).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "複製到組裝車間" }).every((link) => link.getAttribute("href") === `/workshop?bot=${bot.id}`)).toBe(true);
      expect(screen.getAllByRole("button", { name: `下載官方策略包 ${bot.name}` }).length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("renders full metrics, equity, monthly performance, and strategy guidance", async () => {
    const view = await BotDetailPage({ params: Promise.resolve({ id: "orbit-dca" }) });
    render(view);

    const metrics = screen.getByRole("region", { name: "完整績效指標" });
    expect(within(metrics).getAllByRole("article")).toHaveLength(9);
    expect(screen.getByRole("figure", { name: /Orbit DCA 累積收益曲線/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Orbit DCA 月度表現" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "策略原理" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "適用市場" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "風險說明" })).toBeInTheDocument();
    expect(screen.getAllByText("模擬回測資料，不代表未來績效").length).toBeGreaterThan(0);
  });

  it("renders a clear not-found state for unknown ids", async () => {
    const view = await BotDetailPage({ params: Promise.resolve({ id: "unknown-bot" }) });
    render(view);

    expect(screen.getByRole("heading", { name: "找不到這台機器人" })).toBeInTheDocument();
    expect(screen.getByText("unknown-bot")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回機器人市場" })).toHaveAttribute("href", "/bots");
  });
});
