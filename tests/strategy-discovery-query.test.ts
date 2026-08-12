import { describe, expect, it } from "vitest";
import { normalizeDiscoverySearch, strategyPublicationListPath } from "../lib/strategy-discovery-query";
import { publicStrategyRisk } from "../lib/strategy-publications";

describe("strategy discovery query", () => {
  it("makes the member sort explicit and encodes bounded filters", () => {
    expect(strategyPublicationListPath({ sort: "recommended" })).toBe("/api/strategy-publications?sort=recommended");
    expect(strategyPublicationListPath({
      search: "  BTC   breakout  ",
      market: "futures",
      timeframe: "1h",
      risk: "高",
      sort: "return-desc",
    })).toBe("/api/strategy-publications?q=BTC+breakout&market=futures&timeframe=1h&risk=%E9%AB%98&sort=return-desc");
    expect(strategyPublicationListPath({
      limit: 2,
      slugs: ["strategy-releaseone", "strategy-releasetwo"],
      sort: "recommended",
    })).toBe("/api/strategy-publications?limit=2&sort=recommended&slugs=strategy-releaseone%2Cstrategy-releasetwo");
    expect(normalizeDiscoverySearch(` ${"x".repeat(100)} `)).toHaveLength(80);
  });

  it("derives the disclosed member risk from immutable leverage and verified drawdown", () => {
    const metrics = { totalReturn: "0.2", annualizedReturn: "0.2", maxDrawdown: "-0.08",
      winRate: "0.5", profitFactor: "1", sharpe: "1", trades: 10 };
    expect(publicStrategyRisk({ leverage: 1, metrics })).toBe("低");
    expect(publicStrategyRisk({ leverage: 3, metrics })).toBe("中");
    expect(publicStrategyRisk({ leverage: 10, metrics })).toBe("高");
    expect(publicStrategyRisk({ leverage: 1, metrics: { ...metrics, maxDrawdown: "-0.25" } })).toBe("高");
  });
});
