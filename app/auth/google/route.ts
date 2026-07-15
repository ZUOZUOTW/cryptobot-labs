import { NextResponse } from "next/server";
import { demoModeEnabled } from "../../../lib/server/demo-mode";
import {
  callbackUrl,
  createAuthTransaction,
  getSupabaseAuthConfig,
  safeReturnTo,
  setTransactionCookie,
} from "../../../lib/server/supabase-auth";

export async function GET(request: Request): Promise<Response> {
  const authPage = new URL("/auth?error=unavailable", request.url);
  if (demoModeEnabled()) return NextResponse.redirect(authPage, 303);
  try {
    const config = getSupabaseAuthConfig();
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get("return_to"), "/bots");
    const { transaction, cookieValue, challenge } = await createAuthTransaction(returnTo, config);
    const authorize = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
    authorize.searchParams.set("provider", "google");
    authorize.searchParams.set("redirect_to", callbackUrl(config, transaction.state));
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "s256");
    const response = NextResponse.redirect(authorize, 307);
    setTransactionCookie(response.cookies, cookieValue);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    console.error("[auth/google] unable to start OAuth", error instanceof Error ? error.message : "unknown error");
    return NextResponse.redirect(authPage, 303);
  }
}
