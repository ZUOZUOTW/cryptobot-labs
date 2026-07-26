import { getCurrentSupabaseUser } from "@/lib/server/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await getCurrentSupabaseUser();
  return Response.json({ user }, {
    headers: {
      "cache-control": "private, no-store",
      vary: "cookie",
    },
  });
}
