import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkshopPage from "../app/workshop/page";
import { PublishedStrategyCard } from "../components/PublishedStrategyCard";
import { STRATEGY_PRESETS } from "../data/strategies";
import type { PublicStrategyPublication } from "../lib/strategy-publications";

const base = STRATEGY_PRESETS[0];
const publication: PublicStrategyPublication = {
  slug: "strategy-communitycopy",
  name: "會員趨勢策略",
  description: "使用公開歷史行情驗證，可帶入組裝車間建立自己的可編輯版本。",
  publisherName: "發布者 A",
  weexReferralUrl: "https://www.weex.com/register?inviteCode=TEST",
  market: base.market,
  symbol: base.symbol,
  timeframe: base.timeframe,
  leverage: base.leverage,
  logicMode: base.logicMode,
  tradeDirection: "long",
  hasPrivateSource: false,
  blocks: base.blocks.map((block) => ({
    ...block,
    parameters: block.parameters.map((parameter) => ({ ...parameter })),
  })),
  metrics: {
    totalReturn: "0.12",
    annualizedReturn: "0.24",
    maxDrawdown: "-0.08",
    winRate: "0.56",
    profitFactor: "1.4",
    sharpe: "1.2",
    trades: 18,
  },
  equityCurve: [
    { timestamp: 1_700_000_000_000, equity: "10000" },
    { timestamp: 1_700_086_400_000, equity: "11200" },
  ],
  actualStartAt: 1_700_000_000_000,
  actualEndAt: 1_700_086_400_000,
  publishedAt: 1_700_086_400_000,
  updatedAt: 1_700_086_400_000,
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/workshop");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("public strategy reuse", () => {
  it("offers both viewing and one-click workshop reuse from the public card", () => {
    render(<PublishedStrategyCard publication={publication} />);
    expect(screen.getByRole("link", { name: "套用到組裝車間" }))
      .toHaveAttribute("href", "/workshop?publication=strategy-communitycopy");
    expect(screen.getByRole("link", { name: "查看公開策略" }))
      .toHaveAttribute("href", "/strategies/strategy-communitycopy");
  });

  it("loads a validated public strategy as an editable local copy", async () => {
    window.history.replaceState(null, "", "/workshop?publication=strategy-communitycopy");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ publication }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    render(<WorkshopPage />);

    await waitFor(() => expect(screen.getByRole("textbox", { name: "策略名稱" }))
      .toHaveValue("會員趨勢策略"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/strategy-publications/strategy-communitycopy",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getByText(/已載入「會員趨勢策略」的公開可編輯副本/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("cryptobot-labs:draft:v1") ?? "{}"))
      .toMatchObject({ name: "會員趨勢策略", id: "published-strategy-communitycopy" });
  });

  it("shows immediate name guidance and disables save and publish for blocked names", async () => {
    const user = userEvent.setup();
    render(<WorkshopPage />);
    const name = await screen.findByRole("textbox", { name: "策略名稱" });
    await user.clear(name);
    await user.type(name, "保證獲利零風險");

    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText("策略名稱包含敏感詞、不雅字眼或誤導性用語，請重新命名"))
      .not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "保存策略" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "建立分享連結" })).toBeDisabled();
  });
});
