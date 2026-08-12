import type {
  OwnedStrategyVersionRecord,
  StrategyPublicationRecord,
} from "../../db/repositories";
import { publicPublisherName } from "../display-name";
import { validatePublicPublisherName, validatePublicStrategyName } from "../publication-moderation";
import { requireApiUser, type ApiAuthDependencies } from "./auth";
import { errorResponse, HttpProblem, readStrictJson } from "./http";
import { requireSameOrigin, type OriginPolicy } from "./origin";
import {
  parsePublicationInput,
  parseWeexReferralUpdateInput,
  publicationSlug,
  publicStrategyPublicationCacheTag,
  publicStrategyFreshnessHeaders,
  toPublicStrategyPublication,
} from "./strategy-publications";

type StrategyVersionReader = {
  getOwned(userId: string, strategyVersionId: string): Promise<OwnedStrategyVersionRecord | null>;
};

type StrategyPublicationStore = {
  hasApprovedReferral(userId: string): Promise<boolean>;
  publish(input: {
    id: string;
    userId: string;
    strategyVersionId: string;
    backtestJobId: string;
    slug: string;
    description: string;
    publisherName: string;
    now: number;
  }): Promise<StrategyPublicationRecord | null>;
  getBySlug(slug: string): Promise<StrategyPublicationRecord | null>;
  activateApprovedReferral(input: {
    userId: string;
    slug: string;
    now: number;
  }): Promise<boolean>;
  listByUser(userId: string, limit?: number): Promise<StrategyPublicationRecord[]>;
};

export interface StrategyPublicationRouteDependencies {
  auth: ApiAuthDependencies;
  versions: StrategyVersionReader;
  publications: StrategyPublicationStore;
  originPolicy: OriginPolicy;
  now(): number;
  newPublicationId(): string;
  revalidate: {
    path(path: string): void;
    tag(tag: string): void;
  };
}

type RouteContext = { params: Promise<{ slug: string }> };

const response = (status: number, body: unknown): Response => Response.json(body, {
  status,
  headers: publicStrategyFreshnessHeaders,
});

const failure = (error: unknown, operation: string, fallbackStatus: number): Response => {
  if (error instanceof HttpProblem) return errorResponse(error, { status: error.status, code: error.code });
  console.error(`[strategy-publications] ${operation} failed`, {
    name: error instanceof Error ? error.name : "Error",
  });
  return errorResponse(error, { status: fallbackStatus, code: "publication_service_unavailable" });
};

export function createStrategyPublicationRouteHandlers(dependencies: StrategyPublicationRouteDependencies) {
  return {
    post: async (request: Request): Promise<Response> => {
      try {
        requireSameOrigin(request, dependencies.originPolicy);
        const identity = await requireApiUser(request, dependencies.auth);
        if (!identity.ok) return identity.response;
        const input = await readStrictJson(request, {
          maximumBytes: 8_192,
          parse: parsePublicationInput,
        });
        const version = await dependencies.versions.getOwned(identity.user.id, input.strategyVersionId);
        if (!version) throw new HttpProblem(409, "verified_backtest_required");
        let savedConfig: unknown;
        try { savedConfig = JSON.parse(version.configJson) as unknown; }
        catch { throw new HttpProblem(422, "invalid_strategy_configuration"); }
        const strategyName = validatePublicStrategyName(
          savedConfig && typeof savedConfig === "object" && !Array.isArray(savedConfig)
            ? (savedConfig as { name?: unknown }).name
            : undefined,
        );
        if (!strategyName.valid) throw new HttpProblem(422, "invalid_strategy_name");
        const preferredPublisherName = validatePublicPublisherName(identity.user.displayName);
        const publisherName = preferredPublisherName.valid
          ? preferredPublisherName
          : validatePublicPublisherName(publicPublisherName(undefined, identity.user.id));
        if (!publisherName.valid) throw new Error("safe publisher fallback is invalid");
        const publicationId = dependencies.newPublicationId();
        const saved = await dependencies.publications.publish({
          id: publicationId,
          userId: identity.user.id,
          strategyVersionId: input.strategyVersionId,
          backtestJobId: input.backtestJobId,
          slug: publicationSlug(publicationId),
          description: input.description,
          publisherName: publisherName.value,
          now: dependencies.now(),
        });
        if (!saved) throw new HttpProblem(409, "verified_backtest_required");
        const record = await dependencies.publications.getBySlug(saved.slug);
        if (!record) throw new Error("published record could not be loaded");
        const publication = toPublicStrategyPublication(record);
        const canActivateApprovedReferral = await dependencies.publications.hasApprovedReferral(identity.user.id);
        dependencies.revalidate.tag(publicStrategyPublicationCacheTag(saved.slug));
        dependencies.revalidate.path("/api/strategy-publications");
        dependencies.revalidate.path("/bots");
        dependencies.revalidate.path(`/strategies/${saved.slug}`);
        return response(saved.id === publicationId ? 201 : 200, {
          publication,
          capabilities: { canActivateApprovedReferral },
        });
      } catch (error) {
        return failure(error, "publish", 500);
      }
    },

    patch: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        requireSameOrigin(request, dependencies.originPolicy);
        const identity = await requireApiUser(request, dependencies.auth);
        if (!identity.ok) return identity.response;
        await readStrictJson(request, {
          maximumBytes: 4_096,
          parse: parseWeexReferralUpdateInput,
        });
        const { slug } = await context.params;
        const updated = await dependencies.publications.activateApprovedReferral({
          userId: identity.user.id,
          slug,
          now: dependencies.now(),
        });
        if (!updated) throw new HttpProblem(403, "approved_promoter_required");
        const record = await dependencies.publications.getBySlug(slug);
        if (!record) throw new HttpProblem(404, "not_found");
        const publication = toPublicStrategyPublication(record);
        dependencies.revalidate.tag(publicStrategyPublicationCacheTag(slug));
        dependencies.revalidate.path(`/strategies/${slug}`);
        return response(200, { publication });
      } catch (error) {
        return failure(error, "referral update", 500);
      }
    },

    mine: async (request: Request): Promise<Response> => {
      try {
        const identity = await requireApiUser(request, dependencies.auth);
        if (!identity.ok) return identity.response;
        const records = await dependencies.publications.listByUser(identity.user.id, 100);
        const publications = records.flatMap((record) => {
          try { return [toPublicStrategyPublication(record)]; }
          catch (error) {
            console.error("[strategy-publications] skipped invalid owned record", {
              slug: record.slug,
              name: error instanceof Error ? error.name : "Error",
            });
            return [];
          }
        });
        return response(200, { publications });
      } catch (error) {
        return failure(error, "owned list", 503);
      }
    },
  };
}
