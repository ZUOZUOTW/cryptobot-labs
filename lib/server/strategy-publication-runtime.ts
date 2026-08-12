import { createControlPlaneDatabase } from "../../db";
import {
  createStrategyPublicationRepository,
  createStrategyVersionRepository,
  createUserRepository,
} from "../../db/repositories";
import { revalidatePath, revalidateTag } from "next/cache";
import { deriveWorkspaceUserId, platformIdentityProvider } from "./auth";
import { errorResponse } from "./http";
import { env } from "./platform-env";
import { createStrategyPublicationRouteHandlers } from "./strategy-publication-routes";

export function createProductionStrategyPublicationHandlers() {
  const publicOrigin = env.PUBLIC_ORIGIN;
  if (typeof publicOrigin !== "string") throw new Error("PUBLIC_ORIGIN deployment binding is required");
  const database = createControlPlaneDatabase(env.DB);
  return createStrategyPublicationRouteHandlers({
    auth: {
      identityProvider: platformIdentityProvider,
      userRepository: createUserRepository(database),
      deriveUserId: deriveWorkspaceUserId,
      now: Date.now,
    },
    versions: createStrategyVersionRepository(database),
    publications: createStrategyPublicationRepository(database),
    originPolicy: { publicOrigin },
    now: Date.now,
    newPublicationId: () => `publication_${crypto.randomUUID()}`,
    revalidate: {
      path: revalidatePath,
      tag: (tag) => revalidateTag(tag, { expire: 0 }),
    },
  });
}

const productionFailure = (error: unknown): Response => {
  console.error("[strategy-publications] production dependencies unavailable", {
    name: error instanceof Error ? error.name : "Error",
  });
  return errorResponse(error, { status: 503, code: "publication_service_unavailable" });
};

export async function serveProductionStrategyPublicationRoute(
  invoke: (handlers: ReturnType<typeof createProductionStrategyPublicationHandlers>) => Promise<Response>,
): Promise<Response> {
  try {
    return await invoke(createProductionStrategyPublicationHandlers());
  } catch (error) {
    return productionFailure(error);
  }
}
