// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StrategyPublicationRecord } from "../db/repositories";
import { STRATEGY_PRESETS } from "../data/strategies";

const mocks = vi.hoisted(() => ({
  record: null as StrategyPublicationRecord | null,
  keyParts: [] as string[],
  tags: [] as string[],
}));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: () => Promise<unknown>, keyParts: string[], options: { tags: string[] }) => {
    mocks.keyParts = keyParts;
    mocks.tags = options.tags;
    return callback;
  },
}));
vi.mock("../db", () => ({ createControlPlaneDatabase: vi.fn(() => ({})) }));
vi.mock("../db/repositories", () => ({
  createStrategyPublicationRepository: vi.fn(() => ({ getBySlug: async () => mocks.record })),
}));
vi.mock("../lib/server/platform-env", () => ({ env: { DB: undefined } }));

import { loadPublicStrategyPublication } from "../lib/server/public-strategy-loader";

const config = STRATEGY_PRESETS[0]!;
const record = (overrides: Partial<StrategyPublicationRecord> = {}): StrategyPublicationRecord => ({
  id: "publication_legacy",
  userId: "usr_owner",
  strategyVersionId: "version_legacy",
  backtestJobId: "job_legacy",
  slug: "strategy-memberlegacy",
  name: config.name,
  description: "This strategy uses complete historical evidence and reviewable risk controls.",
  publisherName: "Alice",
  weexReferralUrl: null,
  market: config.market,
  symbol: config.symbol,
  configJson: JSON.stringify(config),
  metricsJson: JSON.stringify({
    totalReturn: "0.1",
    annualizedReturn: "0.2",
    maxDrawdown: "0.05",
    winRate: "0.55",
    profitFactor: "1.3",
    sharpe: "1.1",
    trades: 12,
  }),
  equityCurveJson: JSON.stringify([
    { timestamp: 1_000, equity: "10000" },
    { timestamp: 2_000, equity: "11000" },
  ]),
  actualStartAt: 1_000,
  actualEndAt: 2_000,
  publishedAt: 3_000,
  updatedAt: 3_000,
  ...overrides,
});
describe("public strategy loader trust boundary", () => {
  beforeEach(() => {
    mocks.record = null;
    mocks.keyParts = [];
    mocks.tags = [];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("maps moderation-invalid legacy records to not-found and versions the persistent cache", async () => {
    mocks.record = record({ publisherName: "WΕΕX Official" });

    await expect(loadPublicStrategyPublication("strategy-memberlegacy")).resolves.toBeNull();
    expect(mocks.keyParts).toEqual(["public-strategy-publication", "v2", "strategy-memberlegacy"]);
    expect(mocks.tags).toEqual(["public-strategy-publication:v2:strategy-memberlegacy"]);
  });

  it("still surfaces non-moderation data corruption instead of caching it as not-found", async () => {
    mocks.record = record({ configJson: "{" });
    await expect(loadPublicStrategyPublication("strategy-memberlegacy")).rejects.toThrow();
  });
});
