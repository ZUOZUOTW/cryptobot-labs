import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  AUTH_TRANSACTION_COOKIE,
  clearTransactionCookie,
  exchangeAuthCode,
  getSupabaseAuthConfig,
  readAuthTransaction,
  setSessionCookies,
} from "../../../lib/server/supabase-auth";

const failure = (request: Request): NextResponse => {
  const response = NextResponse.redirect(new URL("/auth?error=callback_failed", request.url), 303);
  clearTransactionCookie(response.cookies);
  response.headers.set("cache-control", "no-store");
  return response;
};

export async function GET(request: Request): Promise<Response> {
  try {
    const config = getSupabaseAuthConfig();
    const query = new URL(request.url).searchParams;
    const state = query.get("state") ?? "";
    const code = query.get("code") ?? "";
    if (query.has("error") || state.length > 256 || code.length > 2_048) {
      console.error("[auth/callback] provider returned an error or oversized parameters");
      return failure(request);
    }
    const store = await cookies();
    const transaction = await readAuthTransaction(store.get(AUTH_TRANSACTION_COOKIE)?.value, state, config);
    if (!transaction) {
      console.error("[auth/callback] transaction validation failed");
      return failure(request);
    }
    const session = await exchangeAuthCode(code, transaction.verifier, config);
    if (!session) {
      console.error("[auth/callback] authorization code exchange failed");
      return failure(request);
    }
    const response = NextResponse.redirect(new URL(transaction.returnTo, config.origin), 303);
    clearTransactionCookie(response.cookies);
    setSessionCookies(response.cookies, session);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    console.error("[auth/callback] unexpected failure", error instanceof Error ? error.message : "unknown error");
    return failure(request);
  }
}
