import { runWeexBotCatalogPerformance } from "../../../../lib/server/weex-historical-performance";
import { demoModeEnabled } from "../../../../lib/server/demo-mode";

export const runtime = "nodejs";

let cached: {
  expiresAt: number;
  updatedAt: string;
  value: Awaited<ReturnType<typeof runWeexBotCatalogPerformance>>;
} | null = null;
let pending: Promise<Awaited<ReturnType<typeof runWeexBotCatalogPerformance>>> | null = null;
const CACHE_MS = 6 * 60 * 60 * 1_000;

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
  ...init,
  headers: { "Content-Type": "application/json; charset=utf-8", ...init?.headers },
});

export async function GET(): Promise<Response> {
  const now = Date.now();
  try {
    if (demoModeEnabled()) return json({ performances: {}, updatedAt: "", demo: true }, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400" },
    });
    if (!cached || cached.expiresAt <= now) {
      pending ??= runWeexBotCatalogPerformance();
      const value = await pending;
      const collectedTimes = Object.values(value).map(({ evidence }) => evidence.collectedAt);
      cached = {
        value,
        expiresAt: now + CACHE_MS,
        updatedAt: new Date(Math.max(...collectedTimes)).toISOString(),
      };
      pending = null;
    }
    return json({ performances: cached.value, updatedAt: cached.updatedAt }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=21600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    pending = null;
    console.error("[weex-bot-performance] failed", error instanceof Error ? { name: error.name, message: error.message } : { message: "unknown" });
    return json({ error: { code: "weex_history_unavailable" } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
