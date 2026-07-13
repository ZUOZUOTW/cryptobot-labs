import { env } from "./platform-env";
import { requireControlPlaneDatabase } from "../../db/control-plane";
import { createCommandRepository, createDeploymentRepository, createUserRepository } from "../../db/repositories";
import { createLiveDataRepository } from "../../db/repositories/live";
import { deriveWorkspaceUserId, workspaceIdentityProvider, type PlatformIdentityProvider } from "./auth";
import { createCommandService } from "./commands";
import { errorResponse } from "./http";
import { createRunHandlers, createRunService } from "./runs";

interface RunEnvironment { DB?: unknown; PUBLIC_ORIGIN?: unknown }
export function productionRunFailure(error:unknown):Response{return errorResponse(error,{status:500,code:"internal"})}
export function createProductionRunHandlers(environment:RunEnvironment=env as unknown as RunEnvironment,options:{identityProvider?:PlatformIdentityProvider;deriveUserId?:(email:string)=>Promise<string>;now?:()=>number}={}){
  if(typeof environment.PUBLIC_ORIGIN!=="string")throw new Error("PUBLIC_ORIGIN deployment binding is required");
  const parsed=new URL(environment.PUBLIC_ORIGIN);const loopback=parsed.hostname==="localhost"||parsed.hostname==="127.0.0.1"||parsed.hostname==="[::1]";
  if((parsed.protocol!=="https:"&&!(parsed.protocol==="http:"&&loopback))||parsed.username||parsed.password||parsed.pathname!=="/"||parsed.search||parsed.hash||parsed.origin!==environment.PUBLIC_ORIGIN.replace(/\/$/,""))throw new Error("PUBLIC_ORIGIN deployment binding is invalid");
  const database=requireControlPlaneDatabase(environment.DB),now=options.now??Date.now;
  const auth={identityProvider:options.identityProvider??workspaceIdentityProvider,userRepository:createUserRepository(database),deriveUserId:options.deriveUserId??deriveWorkspaceUserId,now};
  const service=createRunService({deployments:createDeploymentRepository(database),liveData:createLiveDataRepository(database),commands:createCommandService(createCommandRepository(database),{now}),now});
  return createRunHandlers({auth,originPolicy:{publicOrigin:parsed.origin},service});
}
