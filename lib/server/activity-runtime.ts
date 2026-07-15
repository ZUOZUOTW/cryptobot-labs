import { env } from "./platform-env";
import { requireControlPlaneDatabase } from "../../db/control-plane";
import { createActivityRepository, createUserRepository } from "../../db/repositories";
import { deriveWorkspaceUserId, platformIdentityProvider, type PlatformIdentityProvider } from "./auth";
import { createActivityHandlers } from "./activity-export";
import { errorResponse } from "./http";

interface ActivityEnvironment { DB?: unknown }

export function productionActivityFailure(error: unknown): Response {
  return errorResponse(error, { status: 500, code: "internal" });
}

export function createProductionActivityHandlers(environment: ActivityEnvironment = env as unknown as ActivityEnvironment,
  options: { identityProvider?: PlatformIdentityProvider; deriveUserId?: (email: string) => Promise<string>;
    now?: () => number } = {}) {
  const database = requireControlPlaneDatabase(environment.DB); const now = options.now ?? Date.now;
  const auth = { identityProvider: options.identityProvider ?? platformIdentityProvider,
    userRepository: createUserRepository(database), deriveUserId: options.deriveUserId ?? deriveWorkspaceUserId, now };
  return createActivityHandlers({ auth, activity: createActivityRepository(database) });
}
