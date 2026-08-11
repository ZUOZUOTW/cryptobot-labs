import { createControlPlaneDatabase } from "@/db";
import {
  createStrategyPublicationRepository,
  createStrategyVersionRepository,
  createUserRepository,
} from "@/db/repositories";
import { requireApiUser, platformIdentityProvider, deriveWorkspaceUserId } from "@/lib/server/auth";
import { HttpProblem, errorResponse } from "@/lib/server/http";
import { env } from "@/lib/server/platform-env";
import { validateStrategyName } from "@/lib/strategy-name";
import { revalidatePath, revalidateTag } from "next/cache";
import {
  parsePublicationInput,
  publicationSlug,
  publicStrategyPublicationCacheTag,
  publicStrategyFreshnessHeaders,
  servePublicStrategyPublicationList,
  toPublicStrategyPublication,
} from "@/lib/server/strategy-publications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const response = (status: number, body: unknown) => Response.json(body, {
  status,
  headers: publicStrategyFreshnessHeaders,
});

const database = () => createControlPlaneDatabase(env.DB);

export async function GET(request: Request): Promise<Response> {
  return servePublicStrategyPublicationList(request, createStrategyPublicationRepository(database()));
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
    const version = await createStrategyVersionRepository(db).getOwned(identity.user.id, input.strategyVersionId);
    if (!version) throw new HttpProblem(409, "verified_backtest_required");
    let savedConfig: unknown;
    try { savedConfig = JSON.parse(version.configJson) as unknown; }
    catch { throw new HttpProblem(422, "invalid_strategy_configuration"); }
    const strategyName = validateStrategyName(
      savedConfig && typeof savedConfig === "object" && !Array.isArray(savedConfig)
        ? (savedConfig as { name?: unknown }).name
        : undefined,
    );
    if (!strategyName.valid) throw new HttpProblem(422, "invalid_strategy_name");
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
      now: Date.now(),
    });
    if (!saved) throw new HttpProblem(409, "verified_backtest_required");
    const record = await repository.getBySlug(saved.slug);
    if (!record) throw new Error("published record could not be loaded");
    revalidateTag(publicStrategyPublicationCacheTag(saved.slug), { expire: 0 });
    revalidatePath("/api/strategy-publications");
    revalidatePath("/bots");
    revalidatePath(`/strategies/${saved.slug}`);
    return response(saved.id === publicationId ? 201 : 200, {
      publication: toPublicStrategyPublication(record),
    });
  } catch (error) {
    if (error instanceof HttpProblem) return errorResponse(error, { status: error.status, code: error.code });
    console.error("[strategy-publications] publish failed", { name: error instanceof Error ? error.name : "Error" });
    return errorResponse(error, { status: 500, code: "publication_service_unavailable" });
  }
}
