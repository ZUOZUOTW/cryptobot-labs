import { env } from "cloudflare:workers";
import { createControlPlaneDatabase } from "../../db";
import { createConnectionRepository, createUserRepository } from "../../db/repositories";
import { deriveWorkspaceUserId, workspaceIdentityProvider, type PlatformIdentityProvider } from "./auth";
import { createListConnectionsHandler } from "./connections";
import { errorResponse } from "./http";

interface ConnectionEnvironment { DB?: unknown }
export function productionConnectionFailure(error: unknown): Response {
  return errorResponse(error,{status:500,code:"internal"});
}
export function createProductionConnectionHandlers(environment: ConnectionEnvironment=env as unknown as ConnectionEnvironment,
  options: {identityProvider?:PlatformIdentityProvider;now?:()=>number;deriveUserId?:(email:string)=>Promise<string>}={}) {
  const database=createControlPlaneDatabase(environment.DB); const now=options.now??Date.now;
  const auth={identityProvider:options.identityProvider??workspaceIdentityProvider,userRepository:createUserRepository(database),
    deriveUserId:options.deriveUserId??deriveWorkspaceUserId,now};
  return {list:createListConnectionsHandler({auth,connections:createConnectionRepository(database)})};
}
