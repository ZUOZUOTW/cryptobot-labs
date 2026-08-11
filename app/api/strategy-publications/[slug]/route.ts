import { createControlPlaneDatabase } from "@/db";
import { createStrategyPublicationRepository, createUserRepository } from "@/db/repositories";
import { deriveWorkspaceUserId, platformIdentityProvider, requireApiUser } from "@/lib/server/auth";
import { errorResponse, HttpProblem, readStrictJson } from "@/lib/server/http";
import { env } from "@/lib/server/platform-env";
import {
  parseWeexReferralUpdateInput,
  publicStrategyPublicationCacheTag,
  publicStrategyFreshnessHeaders,
  toPublicStrategyPublication,
} from "@/lib/server/strategy-publications";
import { revalidatePath, revalidateTag } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug } = await context.params;
    const record = await createStrategyPublicationRepository(createControlPlaneDatabase(env.DB)).getBySlug(slug);
    if (!record) {
      return Response.json({ error: "not_found" }, {
        status: 404,
        headers: publicStrategyFreshnessHeaders,
      });
    }
    let publication;
    try {
      publication = toPublicStrategyPublication(record);
    } catch (error) {
      console.error("[strategy-publication] blocked invalid public record", {
        slug,
        name: error instanceof Error ? error.name : "Error",
      });
      return Response.json({ error: "not_found" }, {
        status: 404,
        headers: publicStrategyFreshnessHeaders,
      });
    }
    return Response.json({ publication }, {
      headers: publicStrategyFreshnessHeaders,
    });
  } catch (error) {
    console.error("[strategy-publication] detail failed", {
      name: error instanceof Error ? error.name : "Error",
    });
    return Response.json({ error: "publication_service_unavailable" }, {
      status: 503,
      headers: publicStrategyFreshnessHeaders,
    });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    if (request.headers.get("sec-fetch-site") !== "same-origin") throw new HttpProblem(403, "forbidden_origin");
    const database = createControlPlaneDatabase(env.DB);
    const identity = await requireApiUser(request, {
      identityProvider: platformIdentityProvider,
      userRepository: createUserRepository(database),
      deriveUserId: deriveWorkspaceUserId,
      now: Date.now,
    });
    if (!identity.ok) return identity.response;
    const input = await readStrictJson(request, {
      maximumBytes: 4_096,
      parse: parseWeexReferralUpdateInput,
    });
    const { slug } = await context.params;
    const repository = createStrategyPublicationRepository(database);
    const updated = await repository.updateReferralUrl({
      userId: identity.user.id,
      slug,
      weexReferralUrl: input.weexReferralUrl,
      now: Date.now(),
    });
    if (!updated) throw new HttpProblem(404, "not_found");
    const record = await repository.getBySlug(slug);
    if (!record) throw new HttpProblem(404, "not_found");
    revalidateTag(publicStrategyPublicationCacheTag(slug), { expire: 0 });
    revalidatePath(`/strategies/${slug}`);
    return Response.json({ publication: toPublicStrategyPublication(record) }, {
      headers: publicStrategyFreshnessHeaders,
    });
  } catch (error) {
    if (error instanceof HttpProblem) return errorResponse(error, { status: error.status, code: error.code });
    console.error("[strategy-publication] referral update failed", {
      name: error instanceof Error ? error.name : "Error",
    });
    return errorResponse(error, { status: 500, code: "publication_service_unavailable" });
  }
}
