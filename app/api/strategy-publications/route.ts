import { createControlPlaneDatabase } from "@/db";
import {
  createStrategyPublicationRepository,
  createUserRepository,
} from "@/db/repositories";
import { requireApiUser, platformIdentityProvider, deriveWorkspaceUserId } from "@/lib/server/auth";
import { HttpProblem, errorResponse } from "@/lib/server/http";
import { env } from "@/lib/server/platform-env";
import {
  parsePublicationInput,
  publicationSlug,
  toPublicStrategyPublication,
} from "@/lib/server/strategy-publications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const response = (status: number, body: unknown) => Response.json(body, {
  status,
  headers: { "cache-control": status === 200 ? "public, max-age=30, s-maxage=300, stale-while-revalidate=3600" : "no-store" },
});

const database = () => createControlPlaneDatabase(env.DB);

export async function GET(): Promise<Response> {
  try {
    const records = await createStrategyPublicationRepository(database()).list(24);
    const publications = records.flatMap((record) => {
      try { return [toPublicStrategyPublication(record)]; }
      catch (error) {
        console.error("[strategy-publications] skipped invalid public record", {
          slug: record.slug,
          name: error instanceof Error ? error.name : "Error",
        });
        return [];
      }
    });
    return response(200, { publications });
  } catch (error) {
    console.error("[strategy-publications] list failed", { name: error instanceof Error ? error.name : "Error" });
    return response(503, { error: "publication_service_unavailable" });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get("sec-fetch-site") !== "same-origin") throw new HttpProblem(403, "forbidden_origin");
    const db = database();
    const identity = await requireApiUser(request, {
      identityProvider: platformIdentityProvider,
      userRepository: createUserRepository(db),
      deriveUserId: deriveWorkspaceUserId,
      now: Date.now,
    });
    if (!identity.ok) return identity.response;
    let raw: unknown;
    try { raw = await request.json(); } catch { throw new HttpProblem(400, "invalid_request"); }
    const input = parsePublicationInput(raw);
    const repository = createStrategyPublicationRepository(db);
    const publicationId = `publication_${crypto.randomUUID()}`;
    const saved = await repository.publish({
      id: publicationId,
      userId: identity.user.id,
      strategyVersionId: input.strategyVersionId,
      backtestJobId: input.backtestJobId,
      slug: publicationSlug(publicationId),
      description: input.description,
      publisherName: identity.user.displayName,
      weexReferralUrl: input.weexReferralUrl,
      now: Date.now(),
    });
    if (!saved) throw new HttpProblem(409, "verified_backtest_required");
    const record = await repository.getBySlug(saved.slug);
    if (!record) throw new Error("published record could not be loaded");
    return response(saved.id === publicationId ? 201 : 200, {
      publication: toPublicStrategyPublication(record),
    });
  } catch (error) {
    if (error instanceof HttpProblem) return errorResponse(error, { status: error.status, code: error.code });
    console.error("[strategy-publications] publish failed", { name: error instanceof Error ? error.name : "Error" });
    return errorResponse(error, { status: 500, code: "publication_service_unavailable" });
  }
}
