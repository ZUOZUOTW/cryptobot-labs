import type { BacktestReport, BotConfig, WeexHistoricalPerformance } from "./types";
import { backtestConfigFingerprint } from "./backtest";

interface HistoricalBacktestResponse { report?: BacktestReport; demo?: boolean; error?: { code?: string; message?: string } }
interface BotPerformanceResponse { performances?: Record<string, WeexHistoricalPerformance>; updatedAt?: string; demo?: boolean }
let botPerformanceRequest: Promise<{ performances: Record<string, WeexHistoricalPerformance>; updatedAt: string; demo: boolean }> | null = null;
const backtestRequests = new Map<string, Promise<BacktestReport>>();

const errorMessage = (body: HistoricalBacktestResponse | null): string => {
  if (body?.error?.code === "weex_history_incomplete") return "WEEX 歷史行情尚未完整覆蓋此區間，請稍後重試或更換時間週期。";
  if (body?.error?.code === "invalid_strategy") return "目前策略設定無法執行歷史行情回測。";
  return body?.error?.message || "暫時無法取得 WEEX 歷史行情，請稍後重試。";
};

export async function runWeexHistoricalBacktest(config: BotConfig): Promise<BacktestReport> {
  const key = backtestConfigFingerprint(config);
  const existing = backtestRequests.get(key);
  if (existing) return existing;
  if (backtestRequests.size >= 20) backtestRequests.delete(backtestRequests.keys().next().value!);
  const pending = (async () => {
    const response = await fetch("/api/weex/historical-backtest", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ config }),
    });
    let body: HistoricalBacktestResponse | null = null;
    try { body = await response.json() as HistoricalBacktestResponse; } catch { body = null; }
    if (!response.ok || !body?.report || (body.demo !== true && body.report.evidence?.provider !== "WEEX")) throw new Error(errorMessage(body));
    return body.report;
  })().finally(() => { backtestRequests.delete(key); });
  backtestRequests.set(key, pending);
  return pending;
}

export async function loadWeexBotPerformance(): Promise<{
  performances: Record<string, WeexHistoricalPerformance>; updatedAt: string; demo: boolean;
}> {
  botPerformanceRequest ??= (async () => {
    const response = await fetch("/api/weex/bot-performance", { cache: "force-cache", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("WEEX 歷史績效暫時無法載入");
    const body = await response.json() as BotPerformanceResponse;
    if (!body.performances || typeof body.updatedAt !== "string") throw new Error("WEEX 歷史績效格式無效");
    return { performances: body.performances, updatedAt: body.updatedAt, demo: body.demo === true };
  })().finally(() => { botPerformanceRequest = null; });
  return botPerformanceRequest;
}
