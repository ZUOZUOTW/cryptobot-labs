// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StrategyPublicationRecord } from "../db/repositories";
import { STRATEGY_PRESETS } from "../data/strategies";
import { validFormalEvidenceRow } from "./helpers/formal-evidence";

const mocks = vi.hoisted(() => ({
  record: null as StrategyPublicationRecord | null,
  approvedReferralUrl: null as string | null,
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
  createStrategyPublicationRepository: vi.fn(() => ({
    getBySlug: async () => mocks.record,
    getApprovedReferralUrlBySlug: async () => mocks.approvedReferralUrl,
  })),
}));
vi.mock("../lib/server/platform-env", () => ({ env: { DB: undefined } }));

import { loadPublicStrategyPublication } from "../lib/server/public-strategy-loader";

const config = STRATEGY_PRESETS[2]!;
const record = (overrides: Partial<StrategyPublicationRecord> = {}): StrategyPublicationRecord => ({
  ...validFormalEvidenceRow(),
  id: "publication_legacy",
  userId: "usr_owner",
  strategyVersionId: "version_legacy",
  backtestJobId: "job_legacy",
  jobId: "job_legacy",
  requestJson: JSON.stringify({
    ...JSON.parse(validFormalEvidenceRow().requestJson as string),
    strategyVersionId: "version_legacy",
  }),
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
    { timestamp: 1_000, equity: "10000", funding: "0" },
    { timestamp: 2_999, equity: "11000", funding: "0" },
  ]),
  actualStartAt: 1_000,
  actualEndAt: 2_999,
  discoveryMarket: config.market,
  discoveryTimeframe: config.timeframe,
  discoveryRisk: "中",
  discoveryTotalReturn: 10,
  discoveryMaxDrawdown: 5,
  discoveryWinRate: 55,
  discoveryStability: 50,
  discoveryRecommended: 60,
  publishedAt: 3_000,
  updatedAt: 3_000,
  ...overrides,
});
describe("public strategy loader trust boundary", () => {
  beforeEach(() => {
    mocks.record = null;
    mocks.approvedReferralUrl = null;
    mocks.keyParts = [];
    mocks.tags = [];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("maps moderation-invalid legacy records to not-found and versions the persistent cache", async () => {
    mocks.record = record({ publisherName: "WΕΕX Official" });

    await expect(loadPublicStrategyPublication("strategy-memberlegacy")).resolves.toBeNull();
    expect(mocks.keyParts).toEqual(["public-strategy-publication", "v4", "strategy-memberlegacy"]);
    expect(mocks.tags).toEqual(["public-strategy-publication:v4:strategy-memberlegacy"]);
  });

  it.each(["WΕΕX Official", "WEEX официальный"])(
    "maps a legacy official-looking strategy name to not-found: %s",
    async (name) => {
      mocks.record = record({
        name,
        configJson: JSON.stringify({ ...config, name }),
      });

      await expect(loadPublicStrategyPublication("strategy-memberlegacy")).resolves.toBeNull();
    },
  );

  it("maps corrupted evidence payloads to not-found instead of caching unsafe output", async () => {
    mocks.record = record({ configJson: "{" });
    await expect(loadPublicStrategyPublication("strategy-memberlegacy")).resolves.toBeNull();
  });

  it("maps a legacy publication with incomplete formal evidence to not-found", async () => {
    mocks.record = record({ provenanceJson: "{}" });
    await expect(loadPublicStrategyPublication("strategy-memberlegacy")).resolves.toBeNull();
  });

  it("never serves a cached legacy referral and resolves current approval on every load", async () => {
    mocks.record = record({
      weexReferralUrl: "https://www.weex.com/register?inviteCode=STALE_MARKER",
    });

    await expect(loadPublicStrategyPublication("strategy-memberlegacy")).resolves.toMatchObject({
      weexReferralUrl: null,
    });

    mocks.approvedReferralUrl = "https://www.weex.com/register?inviteCode=CURRENT_APPROVED";
    await expect(loadPublicStrategyPublication("strategy-memberlegacy")).resolves.toMatchObject({
      weexReferralUrl: "https://www.weex.com/register?inviteCode=CURRENT_APPROVED",
    });

    mocks.approvedReferralUrl = null;
    await expect(loadPublicStrategyPublication("strategy-memberlegacy")).resolves.toMatchObject({
      weexReferralUrl: null,
    });
  });
});
