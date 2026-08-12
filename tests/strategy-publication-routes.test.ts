// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OwnedStrategyVersionRecord,
  StrategyPublicationRecord,
  UserRecord,
} from "../db/repositories";
import { STRATEGY_PRESETS } from "../data/strategies";
import type { ApiAuthDependencies } from "../lib/server/auth";
import { createStrategyPublicationRouteHandlers } from "../lib/server/strategy-publication-routes";
import { validFormalEvidenceRow } from "./helpers/formal-evidence";

const config = STRATEGY_PRESETS[2]!;
const description = "This strategy uses complete historical evidence, bounded risk controls, and reviewable rules.";
const slug = "strategy-aaaaaaaaaaaaaaaaaaaa";

const publicationRecord = (overrides: Partial<StrategyPublicationRecord> = {}): StrategyPublicationRecord => ({
  ...validFormalEvidenceRow(),
  id: "publication_aaaaaaaaaaaaaaaaaaaa",
  userId: "usr_owner",
  strategyVersionId: "version_a",
  backtestJobId: "job_a",
  jobId: "job_a",
  requestJson: JSON.stringify({
    ...JSON.parse(validFormalEvidenceRow().requestJson as string),
    strategyVersionId: "version_a",
  }),
  slug,
  name: config.name,
  description,
  publisherName: "Alice",
  weexReferralUrl: null,
  market: config.market,
  symbol: config.symbol,
  configJson: JSON.stringify(config),
  metricsJson: JSON.stringify({
    totalReturn: "0.12",
    annualizedReturn: "0.22",
    maxDrawdown: "0.08",
    winRate: "0.55",
    profitFactor: "1.4",
    sharpe: "1.1",
    trades: 12,
  }),
  equityCurveJson: JSON.stringify([
    { timestamp: 1_000, equity: "10000", funding: "0" },
    { timestamp: 2_999, equity: "11200", funding: "0" },
  ]),
  actualStartAt: 1_000,
  actualEndAt: 2_999,
  discoveryMarket: config.market,
  discoveryTimeframe: config.timeframe,
  discoveryRisk: "中",
  discoveryTotalReturn: 12,
  discoveryMaxDrawdown: 8,
  discoveryWinRate: 55,
  discoveryStability: 50,
  discoveryRecommended: 60,
  publishedAt: 3_000,
  updatedAt: 3_000,
  ...overrides,
});

const identity = (id = "usr_owner", displayName = "Alice") => ({
  identityProvider: {
    getIdentity: vi.fn(async () => ({ subject: id, email: `${id}@example.test`, displayName })),
  },
  userRepository: {
    upsertIdentity: vi.fn(async (input: {
      id: string; email: string; displayName: string; now: number;
    }): Promise<UserRecord> => ({
      id: input.id,
      normalizedEmail: input.email,
      displayName: input.displayName,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  },
  deriveUserId: vi.fn(async () => "derived_user"),
  now: () => 10,
});

const anonymousIdentity = () => ({
  identityProvider: { getIdentity: vi.fn(async () => null) },
  userRepository: { upsertIdentity: vi.fn() },
  deriveUserId: vi.fn(async () => "derived_user"),
  now: () => 10,
});

const ownedVersion = (overrides: Partial<OwnedStrategyVersionRecord> = {}): OwnedStrategyVersionRecord => ({
  id: "version_a",
  userId: "usr_owner",
  strategyId: "strategy_a",
  version: 1,
  market: config.market,
  symbol: config.symbol,
  configHash: "a".repeat(64),
  sourceHash: null,
  configJson: JSON.stringify(config),
  sourceCode: null,
  createdAt: 1,
  ...overrides,
});

const dependencies = (auth: ApiAuthDependencies = identity()) => {
  let stored = publicationRecord();
  const versions = {
    getOwned: vi.fn(async (): Promise<OwnedStrategyVersionRecord | null> => ownedVersion()),
  };
  const publications = {
    hasApprovedReferral: vi.fn(async () => false),
    publish: vi.fn(async (input: {
      id: string; userId: string; strategyVersionId: string; backtestJobId: string;
      slug: string; description: string; publisherName: string; now: number;
    }) => {
      stored = publicationRecord({
        id: input.id,
        userId: input.userId,
        strategyVersionId: input.strategyVersionId,
        backtestJobId: input.backtestJobId,
        slug: input.slug,
        description: input.description,
        publisherName: input.publisherName,
        publishedAt: input.now,
        updatedAt: input.now,
      });
      return stored;
    }),
    getBySlug: vi.fn(async () => stored),
    activateApprovedReferral: vi.fn(async () => {
      stored = publicationRecord({
        weexReferralUrl: "https://www.weex.com/register?inviteCode=SERVER_APPROVED",
      });
      return true;
    }),
    listByUser: vi.fn(async () => [stored]),
  };
  const revalidate = { path: vi.fn(), tag: vi.fn() };
  return {
    handlers: createStrategyPublicationRouteHandlers({
      auth,
      versions,
      publications,
      originPolicy: { publicOrigin: "https://app.example.test" },
      now: () => 20,
      newPublicationId: () => "publication_aaaaaaaaaaaaaaaaaaaa",
      revalidate,
    }),
    versions,
    publications,
    revalidate,
  };
};

const jsonRequest = (path: string, method: "POST" | "PATCH", body: unknown): Request => new Request(
  `https://app.example.test${path}`,
  {
    method,
    headers: {
      "content-type": "application/json",
      "host": "app.example.test",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  },
);

const publicationInput = (overrides: Record<string, unknown> = {}) => ({
  strategyVersionId: "version_a",
  backtestJobId: "job_a",
  description,
  ...overrides,
});

describe("strategy publication route contracts", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
  it("returns 401 from POST, PATCH, and mine before touching owner-scoped stores", async () => {
    const { handlers, versions, publications } = dependencies(anonymousIdentity());
    const post = await handlers.post(jsonRequest("/api/strategy-publications", "POST", publicationInput()));
    const patch = await handlers.patch(jsonRequest(`/api/strategy-publications/${slug}`, "PATCH", {
      action: "activate-approved-referral",
    }), { params: Promise.resolve({ slug }) });
    const mine = await handlers.mine(new Request("https://app.example.test/api/strategy-publications/mine"));

    expect([post.status, patch.status, mine.status]).toEqual([401, 401, 401]);
    expect(versions.getOwned).not.toHaveBeenCalled();
    expect(publications.publish).not.toHaveBeenCalled();
    expect(publications.hasApprovedReferral).not.toHaveBeenCalled();
    expect(publications.activateApprovedReferral).not.toHaveBeenCalled();
    expect(publications.listByUser).not.toHaveBeenCalled();
  });

  it("rejects cross-site or non-JSON publication requests before persistence", async () => {
    const { handlers, publications } = dependencies();
    const crossSite = new Request("https://app.example.test/api/strategy-publications", {
      method: "POST",
      headers: { "content-type": "application/json", "host": "app.example.test", "sec-fetch-site": "cross-site" },
      body: JSON.stringify(publicationInput()),
    });
    const wrongMediaType = new Request("https://app.example.test/api/strategy-publications", {
      method: "POST",
      headers: { "content-type": "text/plain", "host": "app.example.test", "sec-fetch-site": "same-origin" },
      body: JSON.stringify(publicationInput()),
    });

    expect((await handlers.post(crossSite)).status).toBe(403);
    expect((await handlers.post(wrongMediaType)).status).toBe(415);
    expect(publications.publish).not.toHaveBeenCalled();
  });

  it("rejects contradictory Origin or Host even when fetch metadata says same-origin", async () => {
    const { handlers, publications } = dependencies();
    const badOrigin = jsonRequest("/api/strategy-publications", "POST", publicationInput());
    badOrigin.headers.set("origin", "https://evil.example");
    const badHost = jsonRequest("/api/strategy-publications", "POST", publicationInput());
    badHost.headers.set("host", "evil.example");

    expect((await handlers.post(badOrigin)).status).toBe(403);
    expect((await handlers.post(badHost)).status).toBe(403);
    expect(publications.publish).not.toHaveBeenCalled();
  });

  it("publishes an owned version with canonical public text and invalidates every public projection", async () => {
    const { handlers, publications, revalidate } = dependencies(identity("usr_owner", "Ａｌｉｃｅ"));
    const response = await handlers.post(jsonRequest("/api/strategy-publications", "POST", publicationInput({
      description: "Ｔｈｉｓ strategy uses complete historical evidence and reviewable risk controls for members.",
    })));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.publication).toMatchObject({ slug, publisherName: "Alice" });
    expect(body.capabilities).toEqual({ canActivateApprovedReferral: false });
    expect(publications.hasApprovedReferral).toHaveBeenCalledWith("usr_owner");
    expect(publications.publish).toHaveBeenCalledWith(expect.objectContaining({
      userId: "usr_owner",
      publisherName: "Alice",
      description: "This strategy uses complete historical evidence and reviewable risk controls for members.",
    }));
    expect(revalidate.tag).toHaveBeenCalledWith(`public-strategy-publication:v4:${slug}`);
    expect(revalidate.path.mock.calls.map(([path]) => path)).toEqual([
      "/api/strategy-publications",
      "/bots",
      `/strategies/${slug}`,
    ]);
  });

  it("uses the verified owner id for version lookup and refuses another user's immutable version", async () => {
    const { handlers, versions, publications } = dependencies(identity("usr_attacker", "Mallory"));
    versions.getOwned.mockResolvedValueOnce(null);
    const response = await handlers.post(jsonRequest("/api/strategy-publications", "POST", publicationInput()));

    expect(response.status).toBe(409);
    expect(versions.getOwned).toHaveBeenCalledWith("usr_attacker", "version_a");
    expect(publications.publish).not.toHaveBeenCalled();
  });

  it("activates only the server-approved promoter referral from an explicit action intent", async () => {
    const { handlers, publications, revalidate } = dependencies(identity("usr_owner", "Alice"));
    const patch = await handlers.patch(jsonRequest(`/api/strategy-publications/${slug}`, "PATCH", {
      action: "activate-approved-referral",
    }), { params: Promise.resolve({ slug }) });
    const mine = await handlers.mine(new Request("https://app.example.test/api/strategy-publications/mine"));

    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({
      publication: { weexReferralUrl: "https://www.weex.com/register?inviteCode=SERVER_APPROVED" },
    });
    expect(publications.activateApprovedReferral).toHaveBeenCalledWith({
      userId: "usr_owner",
      slug,
      now: 20,
    });
    expect(revalidate.tag).toHaveBeenCalledWith(`public-strategy-publication:v4:${slug}`);
    expect(mine.status).toBe(200);
    expect(publications.listByUser).toHaveBeenCalledWith("usr_owner", 100);
  });

  it.each([
    ["ordinary member", "usr_member"],
    ["disabled promoter", "usr_disabled"],
  ])("fails closed for a %s that submits the fixed activation intent", async (_label, userId) => {
    const { handlers, publications, revalidate } = dependencies(identity(userId, "Member"));
    publications.activateApprovedReferral.mockResolvedValueOnce(false);

    const response = await handlers.patch(jsonRequest(`/api/strategy-publications/${slug}`, "PATCH", {
      action: "activate-approved-referral",
    }), { params: Promise.resolve({ slug }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "approved_promoter_required" } });
    expect(publications.activateApprovedReferral).toHaveBeenCalledWith({ userId, slug, now: 20 });
    expect(publications.getBySlug).not.toHaveBeenCalled();
    expect(revalidate.tag).not.toHaveBeenCalled();
  });

  it("rejects arbitrary browser referral URLs without touching the promoter repository", async () => {
    const { handlers, publications } = dependencies(identity("usr_owner", "Alice"));
    const response = await handlers.patch(jsonRequest(`/api/strategy-publications/${slug}`, "PATCH", {
      weexReferralUrl: "https://www.weex.com/register?inviteCode=BROWSER_UNTRUSTED",
    }), { params: Promise.resolve({ slug }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(publications.activateApprovedReferral).not.toHaveBeenCalled();
  });

  it("returns the approved-referral capability only when the server store proves it", async () => {
    const { handlers, publications } = dependencies(identity("usr_promoter", "Promoter"));
    publications.hasApprovedReferral.mockResolvedValueOnce(true);

    const response = await handlers.post(jsonRequest("/api/strategy-publications", "POST", publicationInput()));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      capabilities: { canActivateApprovedReferral: true },
    });
    expect(publications.hasApprovedReferral).toHaveBeenCalledWith("usr_promoter");
  });

  it.each(["ＷＥＥＸ Official", "ᏔЕЕХ Official"])(
    "keeps every authenticated member eligible by replacing unsafe public identity %s",
    async (displayName) => {
      const { handlers, publications } = dependencies(identity("usr_owner", displayName));
      const response = await handlers.post(jsonRequest("/api/strategy-publications", "POST", publicationInput()));

      expect(response.status).toBe(201);
      expect(publications.publish).toHaveBeenCalledWith(expect.objectContaining({
        publisherName: "Member USROWNER",
      }));
    },
  );

  it.each(["Alice ❤️", "Trader 👨‍💻"]) (
    "publishes for an authenticated member whose private profile label is %s",
    async (displayName) => {
      const { handlers, publications } = dependencies(identity("usr_emoji", displayName));
      const response = await handlers.post(jsonRequest("/api/strategy-publications", "POST", publicationInput()));

      expect(response.status).toBe(201);
      expect(publications.publish).toHaveBeenCalledWith(expect.objectContaining({
        publisherName: "Member USREMOJI",
      }));
    },
  );

  it.each([
    "WΕΕX Official",
    "WЕЕX Official",
    "WEEX 公式",
    "WEEX официальный",
    "ᏔЕЕХ Official",
  ])("rejects an official-looking public strategy name before publication: %s", async (name) => {
    const { handlers, publications, versions } = dependencies();
    versions.getOwned.mockResolvedValueOnce(ownedVersion({
      configJson: JSON.stringify({ ...config, name }),
    }));

    const response = await handlers.post(jsonRequest(
      "/api/strategy-publications",
      "POST",
      publicationInput(),
    ));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_strategy_name" } });
    expect(publications.publish).not.toHaveBeenCalled();
  });

  it("rejects fraudulent descriptions and hides unsafe legacy records fail-closed", async () => {
    const { handlers, publications, versions } = dependencies();
    const rejected = await handlers.post(jsonRequest("/api/strategy-publications", "POST", publicationInput({
      description: "This strategy provides guaranteed profits and risk-free returns for every user.",
    })));
    expect(rejected.status).toBe(422);
    expect(versions.getOwned).not.toHaveBeenCalled();
    expect(publications.publish).not.toHaveBeenCalled();

    const impersonation = await handlers.post(jsonRequest(
      "/api/strategy-publications",
      "POST",
      publicationInput({
        description: "This is the official ᏔЕЕХ strategy authorized for all community members.",
      }),
    ));
    expect(impersonation.status).toBe(422);
    expect(await impersonation.json()).toMatchObject({
      error: { code: "invalid_publication_description" },
    });
    expect(versions.getOwned).not.toHaveBeenCalled();
    expect(publications.publish).not.toHaveBeenCalled();

    publications.listByUser.mockResolvedValueOnce([
      publicationRecord({ publisherName: "WEEX Official" }),
    ]);
    const mine = await handlers.mine(new Request("https://app.example.test/api/strategy-publications/mine"));
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual({ publications: [] });
  });

  it("fails closed with credential-safe errors when publication storage is unavailable", async () => {
    const { handlers, publications } = dependencies();
    publications.publish.mockRejectedValueOnce(new Error("DATABASE_URL=postgres://secret"));
    const post = await handlers.post(jsonRequest("/api/strategy-publications", "POST", publicationInput()));
    publications.listByUser.mockRejectedValueOnce(new Error("service_role=secret"));
    const mine = await handlers.mine(new Request("https://app.example.test/api/strategy-publications/mine"));

    expect(post.status).toBe(500);
    expect(mine.status).toBe(503);
    expect(await post.json()).toMatchObject({ error: { code: "publication_service_unavailable" } });
    const mineText = await mine.text();
    expect(mineText).toContain("publication_service_unavailable");
    expect(mineText).not.toContain("service_role");
  });
});
