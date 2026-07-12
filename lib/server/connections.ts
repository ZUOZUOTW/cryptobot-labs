import type { SafeConnectionDevice } from "../../db/repositories";
import type { ApiAuthDependencies } from "./auth";
import { requireApiUser } from "./auth";
import { HttpProblem, errorResponse, jsonResponse } from "./http";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type Connections = { listForUser(userId: string, options: {limit:number;cursor?:string}): Promise<{
  items: SafeConnectionDevice[]; nextCursor: string | null;
}> };

export function createListConnectionsHandler(dependencies: { auth: ApiAuthDependencies; connections: Connections }) {
  return async (request: Request): Promise<Response> => {
    try {
      const authenticated=await requireApiUser(request,dependencies.auth);
      if(!authenticated.ok)return authenticated.response;
      const url=new URL(request.url);
      for(const key of url.searchParams.keys())if(key!=="limit"&&key!=="cursor")throw new HttpProblem(400,"invalid_request");
      const rawLimit=url.searchParams.get("limit");
      const limit=rawLimit===null?50:Number(rawLimit);
      const cursor=url.searchParams.get("cursor")??undefined;
      if(!Number.isSafeInteger(limit)||limit<1||limit>100||(cursor!==undefined&&!ID.test(cursor)))throw new HttpProblem(400,"invalid_request");
      const result=await dependencies.connections.listForUser(authenticated.user.id,{limit,cursor});
      return jsonResponse({connections:result.items,nextCursor:result.nextCursor});
    } catch(error) {
      if(error instanceof HttpProblem)return errorResponse(error,{status:error.status,code:error.code});
      return errorResponse(error,{status:500,code:"internal"});
    }
  };
}
