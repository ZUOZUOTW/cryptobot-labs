import { HttpProblem, readStrictJson } from "../../../../lib/server/http";
import { runWeexHistoricalPerformance } from "../../../../lib/server/weex-historical-performance";
import { hasBotConfigShape, validateConfig } from "../../../../lib/strategy-validation";
import type { BotConfig } from "../../../../lib/types";
import { backtestConfigFingerprint } from "../../../../lib/backtest";
import { runBacktest } from "../../../../lib/backtest";
import { demoModeEnabled } from "../../../../lib/server/demo-mode";

export const runtime = "nodejs";
const CACHE_MS = 5 * 60 * 1_000;
const resultCache = new Map<string, { expiresAt: number; report: Awaited<ReturnType<typeof runWeexHistoricalPerformance>> }>();
const pending = new Map<string, Promise<Awaited<ReturnType<typeof runWeexHistoricalPerformance>>>>();

const cachedBacktest = async (config: BotConfig) => {
  const key = backtestConfigFingerprint(config);
  const now = Date.now();
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > now) return cached.report;
  let request = pending.get(key);
  if (!request) {
    request = demoModeEnabled()
      ? Promise.resolve(runBacktest(config))
      : runWeexHistoricalPerformance(config);
    pending.set(key, request);
  }
  try {
    const report = await request;
    if (resultCache.size >= 64) resultCache.delete(resultCache.keys().next().value!);
    resultCache.set(key, { expiresAt: now + CACHE_MS, report });
    return report;
  } finally { pending.delete(key); }
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

const parseRequest = (value: unknown): BotConfig => {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value as object).length !== 1 || !("config" in value)) throw new Error("invalid_request");
  const config = (value as { config?: unknown }).config;
  if (!hasBotConfigShape(config) || config.exchange !== "WEEX") throw new Error("invalid_strategy");
  const validation = validateConfig(config);
  if (!validation.valid) throw new Error("invalid_strategy");
  return config as BotConfig;
};

const requireRequestOrigin = (request: Request): void => {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProtocol === "https" || forwardedProtocol === "http"
    ? `${forwardedProtocol}:` : new URL(request.url).protocol;
  if (!host || /[\u0000-\u0020\u007f,\\/?#@%]/.test(host)) throw new HttpProblem(403, "forbidden_origin");
  let expected: string;
  try { expected = new URL(`${protocol}//${host}`).origin; } catch { throw new HttpProblem(403, "forbidden_origin"); }
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let supplied: URL;
    try { supplied = new URL(origin); } catch { throw new HttpProblem(403, "forbidden_origin"); }
    if (supplied.origin !== expected || supplied.username || supplied.password) throw new HttpProblem(403, "forbidden_origin");
    return;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") throw new HttpProblem(403, "forbidden_origin");
};

export async function POST(request: Request): Promise<Response> {
  try {
    requireRequestOrigin(request);
    const config = await readStrictJson(request, { maximumBytes: 262_144, parse: parseRequest });
    const demo = demoModeEnabled();
    const report = await cachedBacktest(config);
    return json({
      report: demo ? { ...report, disclaimer: `DEMO_MODE：${report.disclaimer}` } : report,
      demo,
    });
  } catch (error) {
    if (error instanceof HttpProblem) return json({ error: { code: error.code } }, error.status);
    const message = error instanceof Error ? error.message : "";
    if (/invalid_strategy|策略設定無效/.test(message)) return json({ error: { code: "invalid_strategy" } }, 422);
    if (/完整覆蓋|historical/i.test(message)) return json({ error: { code: "weex_history_incomplete" } }, 422);
    if (/origin|Content-Type|request|json|payload/i.test(message)) return json({ error: { code: "invalid_request" } }, 400);
    console.error("[weex-public-backtest] failed", error instanceof Error ? { name: error.name, message: error.message } : { message: "unknown" });
    return json({ error: { code: "weex_history_unavailable" } }, 503);
  }
}
