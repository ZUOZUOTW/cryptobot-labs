import { createControlPlaneDatabase } from "@/db";
import { createUserRepository, createWeexOAuthConnectionRepository } from "@/db/repositories";
import { demoModeEnabled } from "@/lib/server/demo-mode";
import { env } from "@/lib/server/platform-env";
import { getCurrentSupabaseUser } from "@/lib/server/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function GET(): Promise<Response> {
  if (demoModeEnabled()) return json({ connection: null, demo: true });
  try {
    const user = await getCurrentSupabaseUser();
    if (!user) return json({ error: "unauthorized" }, 401);
    const database = createControlPlaneDatabase(env.DB);
    await createUserRepository(database).upsertIdentity({ id: user.id, email: user.email,
      displayName: user.displayName, now: Date.now() });
    const connection = await createWeexOAuthConnectionRepository(database).latestForUser(user.id);
    return json({ connection, demo: false });
  } catch {
    return json({ error: "connection_status_unavailable" }, 503);
  }
}
