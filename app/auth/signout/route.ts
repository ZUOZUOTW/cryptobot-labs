import { NextResponse } from "next/server";
import { requireSameOrigin } from "../../../lib/server/origin";
import {
  AUTH_ACCESS_COOKIE,
  clearSessionCookies,
  getSupabaseAuthConfig,
  revokeSupabaseSession,
} from "../../../lib/server/supabase-auth";

export async function POST(request: Request): Promise<Response> {
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.headers.set("cache-control", "no-store");
  try {
    const config = getSupabaseAuthConfig();
    requireSameOrigin(request, { publicOrigin: config.origin });
    const accessToken = request.headers.get("cookie")?.split(";").map((part) => part.trim())
      .find((part) => part.startsWith(`${AUTH_ACCESS_COOKIE}=`))?.slice(AUTH_ACCESS_COOKIE.length + 1);
    await revokeSupabaseSession(accessToken, config);
  } catch {
    // Local session removal remains deterministic even when the remote Auth service is unavailable.
  }
  clearSessionCookies(response.cookies);
  return response;
}
