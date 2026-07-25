import { cookies } from "next/headers";
import { createExecutorOAuthHandoff, sha256Base64Url } from "@cryptobot-labs/weex-client";

import { createControlPlaneDatabase } from "@/db";
import { createUserRepository } from "@/db/repositories";
import { env } from "@/lib/server/platform-env";
import { AUTH_ACCESS_COOKIE, getCurrentSupabaseUser } from "@/lib/server/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (status: number, body: unknown) => Response.json(body, { status,
  headers: { "cache-control": "no-store" } });

const SAFE_FAILURE_REASONS = new Set([
  "invalid_credentials",
  "ip_not_allowed",
  "permission_denied",
  "clock_error",
  "rate_limited",
  "weex_unavailable",
  "invalid_weex_response",
  "hedge_mode_required",
  "verification_failed",
]);

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("sec-fetch-site") !== "same-origin") return reply(403, { error: "forbidden_origin" });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reply(415, { error: "unsupported_media_type" });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(length) || length < 1 || length > 4_096) return reply(400, { error: "invalid_request" });
  const user = await getCurrentSupabaseUser();
  if (!user) return reply(401, { error: "unauthorized" });
  const accessToken = (await cookies()).get(AUTH_ACCESS_COOKIE)?.value;
  if (!accessToken) return reply(401, { error: "unauthorized" });
  let body: unknown;
  try { body = await request.json(); } catch { return reply(400, { error: "invalid_request" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).sort().join(",") !== "apiKey,passphrase,secretKey") {
    return reply(400, { error: "invalid_request" });
  }
  const value = body as Record<string, unknown>;
  for (const key of ["apiKey", "secretKey", "passphrase"]) {
    const secret = value[key];
    if (typeof secret !== "string" || secret.length < 1 || secret.length > 256
      || /[\u0000-\u001f\u007f]/.test(secret)) return reply(400, { error: "invalid_request" });
  }
  const credentials = {
    apiKey: (value.apiKey as string).trim(),
    secretKey: (value.secretKey as string).trim(),
    passphrase: (value.passphrase as string).trim(),
  };
  if (Object.values(credentials).some((secret) => !secret)) {
    return reply(400, { error: "invalid_request" });
  }
  try {
    await createUserRepository(createControlPlaneDatabase(env.DB)).upsertIdentity({
      id: user.id, email: user.email, displayName: user.displayName, now: Date.now(),
    });
    const handoff = await createExecutorOAuthHandoff({ userId: user.id,
      sessionHash: await sha256Base64Url(accessToken), returnTo: "/connections",
      secret: String(env.EXECUTOR_HANDOFF_SECRET) });
    const executorOrigin = new URL(String(env.EXECUTOR_API_ORIGIN));
    const response = await fetch(new URL("/connections/weex/manual", executorOrigin), {
      method: "POST",
      headers: { Authorization: `Handoff ${handoff}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(credentials),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as { reason?: unknown } | null;
      const reason = typeof failure?.reason === "string" && SAFE_FAILURE_REASONS.has(failure.reason)
        ? failure.reason
        : "verification_failed";
      return reply(400, { error: "connection_verification_failed", reason });
    }
    const result = await response.json() as { maskedApiKeySuffix?: unknown; liveReady?: unknown };
    if (typeof result.maskedApiKeySuffix !== "string") return reply(502, { error: "invalid_executor_response" });
    return reply(200, { connection: { status: "active", maskedApiKeySuffix: result.maskedApiKeySuffix,
      futuresDemoReady: true, liveReady: result.liveReady === true } });
  } catch {
    return reply(503, { error: "executor_unavailable" });
  }
}
