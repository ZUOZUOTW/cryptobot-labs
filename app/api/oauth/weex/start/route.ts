import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createExecutorOAuthHandoff, sha256Base64Url } from "@cryptobot-labs/weex-client";

import { createControlPlaneDatabase } from "@/db";
import { createUserRepository } from "@/db/repositories";
import { demoModeEnabled, productionOAuthReady } from "@/lib/server/demo-mode";
import { env } from "@/lib/server/platform-env";
import { AUTH_ACCESS_COOKIE, getCurrentSupabaseUser } from "@/lib/server/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const failure = (request: Request, reason: string): NextResponse =>
  NextResponse.redirect(new URL(`/connections?status=error&reason=${encodeURIComponent(reason)}`, request.url), 303);

export async function GET(request: Request): Promise<Response> {
  if (demoModeEnabled() || !productionOAuthReady()) return failure(request, "oauth_unavailable");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return failure(request, "forbidden_origin");
  try {
    const user = await getCurrentSupabaseUser();
    if (!user) return NextResponse.redirect(new URL("/auth?return_to=%2Fconnections", request.url), 303);
    const store = await cookies();
    const accessToken = store.get(AUTH_ACCESS_COOKIE)?.value;
    if (!accessToken) return NextResponse.redirect(new URL("/auth?return_to=%2Fconnections", request.url), 303);
    const database = createControlPlaneDatabase(env.DB);
    await createUserRepository(database).upsertIdentity({ id: user.id, email: user.email,
      displayName: user.displayName, now: Date.now() });
    const secret = String(env.EXECUTOR_HANDOFF_SECRET);
    const executorOrigin = new URL(String(env.EXECUTOR_API_ORIGIN));
    const handoff = await createExecutorOAuthHandoff({ userId: user.id,
      sessionHash: await sha256Base64Url(accessToken), returnTo: "/connections", secret });
    const response = await fetch(new URL("/oauth/weex/start", executorOrigin), { method: "POST",
      headers: { Authorization: `Handoff ${handoff}`, Accept: "application/json" }, cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return failure(request, response.status === 503 ? "oauth_unavailable" : "oauth_start_failed");
    const body = await response.json() as { authorizationUrl?: unknown };
    if (typeof body.authorizationUrl !== "string" || body.authorizationUrl.length > 4_096) return failure(request, "oauth_start_failed");
    const authorization = new URL(body.authorizationUrl);
    if (authorization.origin !== "https://www.weex.com" || authorization.pathname !== "/oauth") {
      return failure(request, "oauth_start_failed");
    }
    const redirect = NextResponse.redirect(authorization, 303);
    redirect.headers.set("cache-control", "no-store");
    redirect.headers.set("referrer-policy", "no-referrer");
    return redirect;
  } catch {
    return failure(request, "oauth_unavailable");
  }
}
