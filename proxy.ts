import { type NextRequest, NextResponse } from "next/server";
import { demoModeEnabled } from "./lib/server/demo-mode";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
  clearSessionCookies,
  getSupabaseAuthConfig,
  refreshSupabaseSession,
  setSessionCookies,
} from "./lib/server/supabase-auth";

function accessTokenNeedsRefresh(token: string | undefined, now = Date.now()): boolean {
  if (!token) return true;
  try {
    const segment = token.split(".")[1];
    if (!segment) return true;
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp !== "number" || payload.exp <= Math.floor(now / 1000) + 120;
  } catch { return true; }
}

function withCookie(header: string | null, name: string, value: string): string {
  const entries = (header ?? "").split(";").map((part) => part.trim()).filter(Boolean)
    .filter((part) => !part.startsWith(`${name}=`));
  entries.push(`${name}=${value}`);
  return entries.join("; ");
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (demoModeEnabled() || request.nextUrl.pathname.startsWith("/_next/") || request.method === "OPTIONS") {
    return NextResponse.next();
  }
  let config;
  try { config = getSupabaseAuthConfig(); } catch { return NextResponse.next(); }
  const accessToken = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(AUTH_REFRESH_COOKIE)?.value;
  if (!refreshToken || !accessTokenNeedsRefresh(accessToken)) return NextResponse.next();
  const session = await refreshSupabaseSession(refreshToken, config).catch(() => null);
  if (!session) {
    const response = NextResponse.next();
    clearSessionCookies(response.cookies);
    return response;
  }
  const requestHeaders = new Headers(request.headers);
  let cookieHeader = withCookie(requestHeaders.get("cookie"), AUTH_ACCESS_COOKIE, session.accessToken);
  cookieHeader = withCookie(cookieHeader, AUTH_REFRESH_COOKIE, session.refreshToken);
  requestHeaders.set("cookie", cookieHeader);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  setSessionCookies(response.cookies, session);
  return response;
}
