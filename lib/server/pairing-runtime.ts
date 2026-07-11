import { env } from "cloudflare:workers";
import { createControlPlaneDatabase } from "../../db";
import { createDeviceRepository, createUserRepository } from "../../db/repositories";
import { deriveWorkspaceUserId, workspaceIdentityProvider } from "./auth";
import { createBootstrapProofVerifier } from "./device-signature";
import { errorResponse } from "./http";
import {
  createBootstrapCompleteHandler,
  createConsumePairingCodeHandler,
  createDeleteDeviceHandler,
  createIssuePairingCodeHandler,
} from "./pairing-routes";
import { createPairingService } from "./pairing";

interface PairingEnvironment { DB?: unknown; PUBLIC_ORIGIN?: unknown }

export function productionPairingFailure(error: unknown): Response {
  return errorResponse(error, { status: 500, code: "internal" });
}

/**
 * Production origin is an explicit deployment binding. It is deliberately never inferred from Host,
 * X-Forwarded-* or other attacker-controlled request headers.
 */
export function createProductionPairingHandlers(environment: PairingEnvironment = env as unknown as PairingEnvironment) {
  if (typeof environment.PUBLIC_ORIGIN !== "string" || environment.PUBLIC_ORIGIN.length < 1) {
    throw new Error("PUBLIC_ORIGIN deployment binding is required");
  }
  const database = createControlPlaneDatabase(environment.DB);
  const userRepository = createUserRepository(database);
  const deviceRepository = createDeviceRepository(database);
  const pairingService = createPairingService({ database, verifyBootstrapProof: createBootstrapProofVerifier() });
  const now = Date.now;
  const auth = { identityProvider: workspaceIdentityProvider, userRepository, deriveUserId: deriveWorkspaceUserId, now };
  const originPolicy = { publicOrigin: environment.PUBLIC_ORIGIN };
  return {
    issue: createIssuePairingCodeHandler({ auth, originPolicy, pairingService, now }),
    consume: createConsumePairingCodeHandler({ pairingService, now }),
    complete: createBootstrapCompleteHandler({ pairingService, now }),
    deleteDevice: createDeleteDeviceHandler({ auth, originPolicy, deviceRepository, now }),
  };
}
