import type { BacktestReport, BotConfig, WeexHistoricalPerformance } from "./types";
import { backtestConfigFingerprint } from "./backtest";

interface HistoricalBacktestResponse { report?: BacktestReport; demo?: boolean; error?: { code?: string; message?: string } }
export interface PublicHistoricalBacktestAssumptions {
  feeRate: string;
  slippageRate: string;
  fundingMode: "none" | "historical";
  gapPolicy: "fail" | "disclose";
}

export const DEFAULT_PUBLIC_HISTORICAL_ASSUMPTIONS: PublicHistoricalBacktestAssumptions = {
  feeRate: "0.001",
  slippageRate: "0.0005",
  fundingMode: "none",
  gapPolicy: "fail",
};
interface BotPerformanceResponse { performances?: Record<string, WeexHistoricalPerformance>; updatedAt?: string; demo?: boolean }
type BotPerformanceResult = { performances: Record<string, WeexHistoricalPerformance>; updatedAt: string; demo: boolean };
const BOT_PERFORMANCE_CACHE_TTL_MS = 5 * 60 * 1_000;
let botPerformanceCache: { value: BotPerformanceResult; expiresAt: number } | null = null;
let botPerformanceRequest: Promise<BotPerformanceResult> | null = null;
const backtestRequests = new Map<string, Promise<BacktestReport>>();

export function clearWeexBotPerformanceCache(): void {
  botPerformanceCache = null;
  botPerformanceRequest = null;
}

const errorMessage = (body: HistoricalBacktestResponse | null): string => {
  if (body?.error?.code === "weex_history_incomplete") return "WEEX 歷史行情尚未完整覆蓋此區間，請稍後重試或更換時間週期。";
  if (body?.error?.code === "invalid_strategy") return "目前策略設定無法執行歷史行情回測。";
  return body?.error?.message || "暫時無法取得 WEEX 歷史行情，請稍後重試。";
};

export const isVerifiedWeexPerformance = (performance: WeexHistoricalPerformance | undefined): performance is WeexHistoricalPerformance => Boolean(
  performance
  && performance.evidence.provider === "WEEX"
  && performance.evidence.level === "historical"
  && performance.evidence.complete
  && /^[a-f0-9]{64}$/i.test(performance.evidence.datasetDigest),
);

export async function runWeexHistoricalBacktest(
  config: BotConfig,
  assumptions: PublicHistoricalBacktestAssumptions = DEFAULT_PUBLIC_HISTORICAL_ASSUMPTIONS,
): Promise<BacktestReport> {
  const normalizedAssumptions = { ...assumptions, fundingMode: config.market === "spot" ? "none" as const : assumptions.fundingMode };
  const key = `${backtestConfigFingerprint(config)}:${JSON.stringify(normalizedAssumptions)}`;
  const existing = backtestRequests.get(key);
  if (existing) return existing;
  if (backtestRequests.size >= 20) backtestRequests.delete(backtestRequests.keys().next().value!);
  const pending = (async () => {
    const response = await fetch("/api/weex/historical-backtest", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ config, assumptions: normalizedAssumptions }),
    });
    let body: HistoricalBacktestResponse | null = null;
    try { body = await response.json() as HistoricalBacktestResponse; } catch { body = null; }
    const evidence = body?.report?.evidence;
    if (!response.ok || !body?.report || body.demo === true || evidence?.provider !== "WEEX"
      || evidence.level !== "historical" || !evidence.complete) throw new Error(errorMessage(body));
    return body.report;
  })().finally(() => { backtestRequests.delete(key); });
  backtestRequests.set(key, pending);
  return pending;
}

export async function loadWeexBotPerformance(): Promise<{
  performances: Record<string, WeexHistoricalPerformance>; updatedAt: string; demo: boolean;
}> {
  if (botPerformanceCache && botPerformanceCache.expiresAt > Date.now()) return botPerformanceCache.value;
  if (botPerformanceRequest) return botPerformanceRequest;
  const request = (async () => {
    const response = await fetch("/api/weex/bot-performance", { cache: "force-cache", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("WEEX 歷史績效暫時無法載入");
    const body = await response.json() as BotPerformanceResponse;
    if (!body.performances || typeof body.updatedAt !== "string") throw new Error("WEEX 歷史績效格式無效");
    const value = { performances: body.performances, updatedAt: body.updatedAt, demo: body.demo === true };
    botPerformanceCache = { value, expiresAt: Date.now() + BOT_PERFORMANCE_CACHE_TTL_MS };
    return value;
  })().finally(() => {
    if (botPerformanceRequest === request) botPerformanceRequest = null;
  });
  botPerformanceRequest = request;
  return request;
}
