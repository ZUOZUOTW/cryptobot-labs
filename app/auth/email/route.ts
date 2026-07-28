import { NextResponse } from "next/server";
import { demoModeEnabled } from "../../../lib/server/demo-mode";
import { requireSameOrigin } from "../../../lib/server/origin";
import { legacyPlatformLoginEnabled } from "../../../lib/server/weex-auth-stage";
import {
  callbackUrl,
  createAuthTransaction,
  getSupabaseAuthConfig,
  safeReturnTo,
  setTransactionCookie,
} from "../../../lib/server/supabase-auth";

const redirectToAuth = (request: Request, params: Record<string, string>): NextResponse => {
  const target = new URL("/auth", request.url);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("cache-control", "no-store");
  return response;
};

export async function POST(request: Request): Promise<Response> {
  if (demoModeEnabled() || !legacyPlatformLoginEnabled()) {
    return redirectToAuth(request, { error: "unavailable" });
  }
  try {
    const config = getSupabaseAuthConfig();
    requireSameOrigin(request, { publicOrigin: config.origin });
    const length = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(length) || length > 8_192) return redirectToAuth(request, { error: "invalid_email" });
    const form = await request.formData();
    const email = typeof form.get("email") === "string" ? String(form.get("email")).trim().toLowerCase() : "";
    const returnTo = safeReturnTo(typeof form.get("return_to") === "string" ? String(form.get("return_to")) : null, "/bots");
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return redirectToAuth(request, { error: "invalid_email", return_to: returnTo });
    }
    const { transaction, cookieValue, challenge } = await createAuthTransaction(returnTo, config);
    const endpoint = new URL(`${config.supabaseUrl}/auth/v1/otp`);
    endpoint.searchParams.set("redirect_to", callbackUrl(config, transaction.state));
    const result = await fetch(endpoint, {
      method: "POST",
      headers: { apikey: config.publishableKey, "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ email, create_user: true, code_challenge: challenge, code_challenge_method: "s256" }),
    });
    if (!result.ok) return redirectToAuth(request, {
      error: result.status === 429 ? "rate_limited" : "email_unavailable", return_to: returnTo,
    });
    const response = redirectToAuth(request, { sent: "1", return_to: returnTo });
    setTransactionCookie(response.cookies, cookieValue);
    return response;
  } catch {
    return redirectToAuth(request, { error: "email_unavailable" });
  }
}
