"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BotConfig } from "../../lib/types";
import { RiskPolicyForm, isCompleteRiskPolicy, type RiskPolicyDraft } from "./RiskPolicyForm";
import { refreshCloudRuns } from "./events";

export interface CloudAutomationTemplate {
  config: BotConfig;
  description: string;
  riskNote: string;
  tags: string[];
}

type ConnectionState = "loading" | "ready" | "missing" | "unauthorized" | "error";
type LaunchStage = "idle" | "saving" | "backtesting" | "launching" | "done" | "error" | "unauthorized";
type Attempt = { strategyKey: string; backtestKey: string; runKey: string };

const INTERVAL_MS: Readonly<Record<string, number>> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_historical_range: "歷史回測區間不符合資料限制，請稍後再試。",
  historical_dataset_incomplete: "公開行情資料不完整，系統已停止啟動策略。",
  historical_funding_incomplete: "歷史資金費率資料不完整，系統已停止啟動策略。",
  invalid_strategy_configuration: "策略設定未通過安全驗證，請改用其他策略。",
  data_fetch_failed: "目前無法取得公開行情，請稍後再試。",
  backtest_execution_failed: "歷史回測未能完成，策略尚未啟動。",
  strategy_service_unavailable: "策略服務暫時無法使用，請稍後再試。",
  cloud_run_service_unavailable: "雲端運行服務暫時無法建立策略，請稍後再試。",
  cloud_run_prerequisite_failed: "啟動條件尚未完成。請確認 WEEX API 已啟用此市場的真倉交易權限，並重新整理後再試。",
  live_confirmation_required: "真倉同意已過期，請重新按下啟動按鈕。",
  forbidden_origin: "頁面驗證已過期，請重新整理後再試。",
  conflict: "本次啟動請求與先前資料衝突，請重新選擇策略。",
};

const defaultRisk = (config: BotConfig): RiskPolicyDraft => ({
  allowedSymbols: [config.symbol],
  maxOrderNotional: "25",
  maxPositionNotional: "100",
  maxTotalExposure: "200",
  maxSimultaneousPositions: 1,
  maxDailyLoss: "20",
  maxLeverage: String(config.leverage),
  maxSlippageBps: 30,
  minSignalCooldownMs: 60_000,
  maxConsecutiveFailures: 3,
  operationMode: "automatic",
});
const requestKey = (prefix: string): string => {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`.slice(0, 128);
};
const newAttempt = (): Attempt => ({
  strategyKey: requestKey("console-strategy"),
  backtestKey: requestKey("console-backtest"),
  runKey: requestKey("console-run"),
});
const safeBody = async (response: Response): Promise<unknown> => {
  try { return await response.json(); } catch { return null; }
};
const errorCode = (body: unknown): string => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  return error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code : "";
};
const strategyVersion = (body: unknown): { id: string; configHash: string } | null => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const version = (body as { strategyVersion?: unknown }).strategyVersion;
  if (!version || typeof version !== "object" || Array.isArray(version)) return null;
  const value = version as { id?: unknown; configHash?: unknown };
  return typeof value.id === "string" && value.id.length > 0
    && typeof value.configHash === "string" && /^[a-f0-9]{64}$/.test(value.configHash)
    ? { id: value.id, configHash: value.configHash } : null;
};
const alignedRecentRange = (config: BotConfig): { startTime: number; endTime: number } => {
  const interval = INTERVAL_MS[config.timeframe] ?? 3_600_000;
  const endTime = Math.floor(Date.now() / interval) * interval;
  const maximumCandles = Math.min(2_000, Math.floor(90 * 86_400_000 / interval));
  const candles = Math.max(2, Math.min(maximumCandles, Math.floor(30 * 86_400_000 / interval)));
  return { startTime: endTime - candles * interval, endTime };
};
const backtestEvidence = (body: unknown, strategyVersionId: string): string | null => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const backtest = (body as { backtest?: unknown }).backtest;
  if (!backtest || typeof backtest !== "object" || Array.isArray(backtest)) return null;
  const value = backtest as {
    strategyVersionId?: unknown; status?: unknown; evidenceLevel?: unknown;
    dataset?: { complete?: unknown } | null; result?: { configurationHash?: unknown } | null;
  };
  const hash = value.result?.configurationHash;
  return value.strategyVersionId === strategyVersionId && value.status === "succeeded"
    && value.evidenceLevel === "historical" && value.dataset?.complete === true
    && typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash) ? hash : null;
};
const launchRunId = (body: unknown): string | null => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const run = (body as { run?: unknown }).run;
  if (!run || typeof run !== "object" || Array.isArray(run)) return null;
  const id = (run as { id?: unknown }).id;
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : null;
};

interface CloudStrategyLauncherProps {
  authReturnTo?: string;
  templates: CloudAutomationTemplate[];
  titleId?: string;
  variant?: "page" | "dialog";
}

export function CloudStrategyLauncher({
  authReturnTo = "/runs",
  templates,
  titleId = "automation-launcher-title",
  variant = "page",
}: CloudStrategyLauncherProps) {
  const [selectedId, setSelectedId] = useState(templates[0]?.config.id ?? "");
  const selected = useMemo(() => templates.find(({ config }) => config.id === selectedId) ?? templates[0], [selectedId, templates]);
  const [risk, setRisk] = useState<RiskPolicyDraft>(() => selected ? defaultRisk(selected.config) : defaultRisk({
    id: "unavailable", name: "Unavailable", exchange: "WEEX", market: "futures", symbol: "BTCUSDT",
    timeframe: "1h", logicMode: "all", leverage: 1, blocks: [],
  }));
  const [connection, setConnection] = useState<ConnectionState>("loading");
  const [stage, setStage] = useState<LaunchStage>("idle");
  const [message, setMessage] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const busy = stage === "saving" || stage === "backtesting" || stage === "launching";

  const checkConnection = useCallback(async (
    market: BotConfig["market"] = selected?.config.market ?? "futures",
  ) => {
    setConnection("loading");
    try {
      const response = await fetch("/api/cloud-runs", { cache: "no-store", headers: { Accept: "application/json" } });
      if (response.status === 401) { setConnection("unauthorized"); return; }
      const body = await safeBody(response);
      const account = body && typeof body === "object" ? (body as { account?: unknown }).account : null;
      if (!response.ok) throw new Error("connection_check_failed");
      const details = account && typeof account === "object" && !Array.isArray(account)
        ? account as { connectionStatus?: unknown; permissions?: unknown; withdrawalAccessAbsent?: unknown } : null;
      const permissions = details?.permissions && typeof details.permissions === "object" && !Array.isArray(details.permissions)
        ? details.permissions as { read?: unknown; spotTrade?: unknown; futuresTrade?: unknown } : null;
      const tradePermission = market === "spot" ? permissions?.spotTrade : permissions?.futuresTrade;
      setConnection(details?.connectionStatus === "active" && details.withdrawalAccessAbsent === true
        && permissions?.read === true && tradePermission === true ? "ready" : "missing");
    } catch {
      setConnection("error");
    }
  }, [selected]);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkConnection(), 0);
    return () => window.clearTimeout(timer);
  }, [checkConnection]);

  const selectTemplate = (id: string) => {
    const next = templates.find(({ config }) => config.id === id);
    if (!next) return;
    setSelectedId(id);
    setRisk(defaultRisk(next.config));
    setStage("idle");
    setMessage("");
    setRunId(null);
    attempt.current = null;
    void checkConnection(next.config.market);
  };
  const changeRisk = (next: RiskPolicyDraft) => {
    setRisk(next);
    if (stage === "error") { setStage("idle"); setMessage(""); }
    attempt.current = null;
  };

  const fail = (code: string) => {
    // A completed API rejection is authoritative. Reusing its idempotency key
    // would only replay the already-failed job after the underlying issue is
    // fixed, so the next explicit click must start a fresh bounded workflow.
    if (Object.hasOwn(ERROR_MESSAGES, code)) attempt.current = null;
    setStage("error");
    setMessage(ERROR_MESSAGES[code] ?? "目前無法啟動雲端策略，請稍後再試。");
  };
  const launch = async () => {
    if (!selected || connection !== "ready" || busy || risk.operationMode !== "automatic" || !isCompleteRiskPolicy(risk)) return;
    const keys = attempt.current ?? newAttempt();
    attempt.current = keys;
    setMessage("");
    setRunId(null);
    try {
      setStage("saving");
      const strategyResponse = await fetch("/api/strategies", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": keys.strategyKey },
        body: JSON.stringify({ config: selected.config }),
      });
      if (strategyResponse.status === 401) { setStage("unauthorized"); return; }
      const strategyBody = await safeBody(strategyResponse);
      const version = strategyVersion(strategyBody);
      if (!strategyResponse.ok || !version) throw new Error(errorCode(strategyBody) || "strategy_service_unavailable");

      const range = alignedRecentRange(selected.config);
      setStage("backtesting");
      const backtestResponse = await fetch("/api/backtests", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": keys.backtestKey },
        body: JSON.stringify({
          strategyVersionId: version.id,
          market: selected.config.market,
          symbol: selected.config.symbol,
          interval: selected.config.timeframe,
          ...range,
          initialCapital: "10000",
          feeRate: "0.001",
          slippageRate: "0.0005",
          leverage: String(selected.config.leverage),
          fundingMode: selected.config.market === "futures" ? "historical" : "none",
          gapPolicy: "fail",
        }),
      });
      if (backtestResponse.status === 401) { setStage("unauthorized"); return; }
      const backtestBody = await safeBody(backtestResponse);
      const configurationHash = backtestEvidence(backtestBody, version.id);
      if (!backtestResponse.ok || !configurationHash) {
        const candidate = backtestBody && typeof backtestBody === "object"
          ? (backtestBody as { backtest?: { error?: { code?: unknown } } }).backtest?.error?.code : null;
        throw new Error(typeof candidate === "string" ? candidate : errorCode(backtestBody) || "backtest_execution_failed");
      }

      setStage("launching");
      const runResponse = await fetch("/api/cloud-runs", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": keys.runKey },
        body: JSON.stringify({
          strategyVersionId: version.id,
          botName: selected.config.name,
          configurationHash,
          mode: "live",
          liveConfirmation: { acknowledged: true, acceptedAt: Date.now() },
          riskPolicy: risk,
        }),
      });
      if (runResponse.status === 401) { setStage("unauthorized"); return; }
      const runBody = await safeBody(runResponse);
      const id = launchRunId(runBody);
      if (!runResponse.ok || !id) throw new Error(errorCode(runBody) || "cloud_run_prerequisite_failed");
      setRunId(id);
      setStage("done");
      setMessage("USDT 真倉自動交易策略已啟動。AWS Executor 會在瀏覽器關閉後繼續運行。");
      attempt.current = null;
      refreshCloudRuns();
    } catch (error) {
      fail(error instanceof Error ? error.message : "");
    }
  };

  if (!selected) return null;
  const canLaunch = connection === "ready" && !busy && stage !== "done" && stage !== "unauthorized"
    && risk.operationMode === "automatic" && isCompleteRiskPolicy(risk);
  const progress = [
    { label: "固定策略版本", active: stage === "saving", complete: ["backtesting", "launching", "done"].includes(stage) },
    { label: "歷史行情回測", active: stage === "backtesting", complete: ["launching", "done"].includes(stage) },
    { label: "啟動 AWS Executor", active: stage === "launching", complete: stage === "done" },
  ];
  const authHref = `/auth?return_to=${encodeURIComponent(authReturnTo)}`;

  const dialog = variant === "dialog";

  return <section
    className={`automation-launcher${dialog ? " automation-launcher--dialog" : " glass-panel"}`}
    aria-labelledby={titleId}
    id={dialog ? undefined : "automation-launcher"}
  >
    <header className="automation-launcher__header">
      <div><p className="eyebrow">AUTOMATION LAUNCHER</p><h2 id={titleId}>{dialog ? `啟動 ${selected.config.name}` : "啟動 API 自動交易"}</h2>
        <p>{dialog
          ? "系統會先固定這個策略版本並完成必要歷史回測，再交給固定 IP 的 AWS Executor 全天候運行。"
          : "直接從控制台選擇策略。系統會先保存不可變版本並完成必要歷史回測，再交給固定 IP 的 AWS Executor 全天候運行。"}</p></div>
      <span className="status-chip status-chip--running">WEEX LIVE / USDT</span>
    </header>

    <div className="automation-launcher__safety" role="note">
      <strong>真倉模式</strong>
      <span>策略會使用 WEEX 帳戶中的真實資產（例如 USDT）自動交易，可能產生實際虧損。按下啟動即表示你同意以目前風控上限執行；不需逐筆確認。</span>
    </div>

    <div className={`automation-launcher__grid${templates.length === 1 ? " automation-launcher__grid--single" : ""}`}>
      {templates.length > 1 && <label className="automation-launcher__select"><span>選擇自動交易策略</span>
        <select disabled={busy} onChange={(event) => selectTemplate(event.target.value)} value={selected.config.id}>
          {templates.map((template) => <option key={template.config.id} value={template.config.id}>
            {template.config.name} · {template.config.timeframe} · {template.config.leverage}×
          </option>)}
        </select></label>}
      <article className="automation-launcher__strategy">
        <div><strong>{selected.config.name}</strong><span>{selected.config.symbol} · {selected.config.timeframe} · {selected.config.leverage}×</span></div>
        <p>{selected.description}</p>
        <ul aria-label="策略標籤">{selected.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>
        <small>{selected.riskNote}</small>
      </article>
    </div>

    <div className="automation-prerequisite" data-state={connection}>
      {connection === "loading" && <span>正在確認 WEEX API 連線…</span>}
      {connection === "ready" && <span>WEEX API 已具備{selected.config.market === "spot" ? "現貨" : "合約"}真倉交易權限。</span>}
      {connection === "missing" && <span>WEEX API 尚未完成{selected.config.market === "spot" ? "現貨" : "合約"}真倉權限驗證。 <Link href="/connections">前往連線設定</Link></span>}
      {connection === "unauthorized" && <span>請先 <Link href={authHref}>登入</Link>，再啟動自己的策略。</span>}
      {connection === "error" && <><span>暫時無法確認 WEEX API 連線。</span>
        <button className="button button--ghost button--small" onClick={() => void checkConnection()} type="button">重新檢查</button></>}
    </div>

    <details className="automation-launcher__risk">
      <summary>檢查或調整自動交易風控</summary>
      <RiskPolicyForm
        description="所有欄位都必須完整；AWS Executor 會在每次評估與送單前重新套用風控。"
        disabled={busy}
        legend="自動交易風險上限"
        onChange={changeRisk}
        value={risk}
      />
    </details>

    <ol className="automation-progress" aria-label="啟動進度">
      {progress.map((item, index) => <li data-state={item.complete ? "complete" : item.active ? "active" : "pending"} key={item.label}>
        <span>{item.complete ? "✓" : index + 1}</span><strong>{item.label}</strong>
      </li>)}
    </ol>

    <button className="button button--primary automation-launcher__submit" disabled={!canLaunch}
      onClick={() => void launch()} type="button">
      {stage === "saving" ? "正在固定策略版本…" : stage === "backtesting" ? "正在取得行情並回測…"
        : stage === "launching" ? "正在啟動 AWS Executor…" : stage === "done" ? "真倉策略已啟動" : "同意風險並啟動 USDT 真倉"}
    </button>
    <div aria-live="polite">
      {stage === "unauthorized" && <p className="control-feedback control-feedback--danger">登入狀態已過期。 <Link href={authHref}>重新登入</Link></p>}
      {message && <p className={`control-feedback${stage === "error" ? " control-feedback--danger" : ""}`}
        role={stage === "error" ? "alert" : "status"}>{message}{stage === "done" && runId ? ` 運行編號：${runId}` : ""}</p>}
    </div>
  </section>;
}
