import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const loadPublicStrategyPublication = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/public-strategy-loader", () => ({ loadPublicStrategyPublication }));
vi.mock("@/components/PerformanceChart", () => ({
  PerformanceChart: () => <div data-testid="performance-chart" />,
}));
vi.mock("@/components/StrategyShareActions", () => ({
  StrategyShareActions: () => <div data-testid="strategy-share-actions" />,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not found"); },
}));

import StrategyPublicationPage from "../app/strategies/[slug]/page";
import AffiliateDisclosurePage from "../app/disclosures/affiliate/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const publication = (weexReferralUrl: string | null) => ({
  actualEndAt: Date.UTC(2024, 1, 3),
  actualStartAt: Date.UTC(2024, 0, 2),
  blocks: [],
  description: "This public strategy has complete historical evidence and reviewable risk controls.",
  equityCurve: [
    { timestamp: Date.UTC(2024, 0, 2), equity: "10000" },
    { timestamp: Date.UTC(2024, 1, 3), equity: "11200" },
  ],
  hasPrivateSource: false,
  leverage: 1,
  logicMode: "all",
  market: "spot" as const,
  metrics: {
    annualizedReturn: "0.05",
    maxDrawdown: "0.08",
    profitFactor: "1.2",
    sharpe: "0.9",
    totalReturn: "0.12",
    trades: 42,
    winRate: "0.55",
  },
  name: "Approved promoter strategy",
  publishedAt: Date.UTC(2024, 1, 4),
  publisherName: "Publisher",
  slug: "strategy-approvedsource",
  symbol: "BTCUSDT",
  timeframe: "4h",
  tradeDirection: "long" as const,
  updatedAt: Date.UTC(2024, 1, 4),
  weexReferralUrl,
});

describe("public strategy affiliate disclosure", () => {
  it("provides substantive affiliate disclosure content instead of a legal-page redirect", () => {
    render(<AffiliateDisclosurePage />);

    expect(screen.getByRole("heading", { name: "推廣與推薦關係揭露", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "連結如何核准", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "可能的推薦關係", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("此連結可能包含推薦關係，您的使用費用不因此增加。"))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看使用條款、隱私與風險說明" }))
      .toHaveAttribute("href", "/legal");
  });

  it("places a plain-language disclosure and real disclosure link next to every approved referral CTA", async () => {
    loadPublicStrategyPublication.mockResolvedValue(publication(
      "https://www.weex.com/register?inviteCode=SERVER_APPROVED",
    ));

    render(await StrategyPublicationPage({
      params: Promise.resolve({ slug: "strategy-approvedsource" }),
    }));

    const referralCtas = screen.getAllByRole("link").filter((link) => (
      link.getAttribute("href")?.includes("inviteCode=SERVER_APPROVED")
    ));
    expect(referralCtas).toHaveLength(2);
    for (const link of referralCtas) {
      expect(link).toHaveAttribute("rel", expect.stringContaining("sponsored"));
      expect(link).toHaveAttribute("rel", expect.stringContaining("nofollow"));
    }

    const disclosureLinks = screen.getAllByRole("link", { name: "查看完整推廣揭露" });
    expect(disclosureLinks).toHaveLength(2);
    for (const link of disclosureLinks) expect(link).toHaveAttribute("href", "/disclosures/affiliate");
    const disclosureNotes = screen.getAllByRole("note").filter((note) => (
      note.textContent?.includes("此連結可能包含推薦關係，您的使用費用不因此增加。")
    ));
    expect(disclosureNotes).toHaveLength(2);
  });

  it("does not imply a referral relationship when no server-approved URL is present", async () => {
    loadPublicStrategyPublication.mockResolvedValue(publication(null));

    render(await StrategyPublicationPage({
      params: Promise.resolve({ slug: "strategy-approvedsource" }),
    }));

    expect(screen.queryByRole("link", { name: "查看完整推廣揭露" })).not.toBeInTheDocument();
    expect(screen.queryByText(/可能包含推薦關係/u)).not.toBeInTheDocument();
    expect(screen.getAllByRole("note")).toHaveLength(1);
  });
});
