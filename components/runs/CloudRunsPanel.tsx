"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CLOUD_RUNS_REFRESH_EVENT } from "./events";

interface CloudRun {
  id: string; name: string; mode: "futures-demo" | "live";
  state: "running" | "paused" | "stopped" | "error";
  version: number; lastCandleAt: number | null; lastEvaluatedAt: number | null;
  lastSignalJson: string | Record<string, unknown> | null; lastErrorCode: string | null;
  consecutiveFailures: number; createdAt: number; updatedAt: number;
}

const parse = (value: unknown): CloudRun[] | null => {
  if (!value || typeof value !== "object" || !Array.isArray((value as { runs?: unknown }).runs)) return null;
  return (value as { runs: CloudRun[] }).runs;
};
const time = (value: number | null) => value ? new Intl.DateTimeFormat("zh-TW", {
  dateStyle: "short", timeStyle: "medium",
}).format(value) : "尚未完成第一次評估";
const stateLabel: Record<CloudRun["state"], string> = {
  running: "運行中",
  paused: "已暫停",
  stopped: "已停止",
  error: "需要處理",
};
const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  demo_funds_required: "WEEX 合約模擬錢包沒有可用 SUSDT。請先在 WEEX 合約模擬頁領取模擬金，再按「恢復」。",
  account_equity_unavailable: "WEEX 帳戶權益目前不可用。請確認帳戶有可用餘額後再按「恢復」。",
  execution_failed: "策略執行遇到未分類錯誤。系統已安全暫停，請重新整理；若仍發生請聯絡支援。",
  weex_authentication: "WEEX 拒絕 API 驗證。請重新檢查 API 權限或重新連接後再按「恢復」。",
  weex_permission: "WEEX API 缺少所需權限。請啟用讀取與合約交易權限後再按「恢復」。",
  weex_rate_limit: "WEEX API 暫時限制請求。請稍後再按「恢復」。",
  live_trading_disabled: "AWS Executor 的真倉功能尚未啟用。系統沒有送單；請聯絡平台管理員。",
  live_api_permission_required: "WEEX API 缺少此策略所需的真倉交易權限。請更新 API 權限後重新連接。",
  withdrawal_permission_forbidden: "為保護資產，具提幣權限的 API 不允許自動交易。請建立禁止提幣的新 API。",
  hedge_mode_required: "合約帳戶必須使用雙向持倉（Hedge）模式，調整後再按「恢復」。",
  unsupported_market_mode: "這個市場模式不受支援，系統沒有送出任何訂單。",
  unknown_order_state: "交易所訂單狀態無法確認。為避免重複下單，策略已停止；請先在 WEEX 核對訂單後再處理。",
  ambiguous_position_state: "同一交易對同時存在多個方向的持倉，策略無法安全判定要管理哪一筆，已停止且沒有送單。",
  unmanaged_position_state: "啟動前已存在不屬於此策略的持倉。為避免誤動既有資產，策略已停止且沒有送單。",
};

export const cloudRunFailureMessage = (code: string): string =>
  FAILURE_MESSAGES[code] ?? `Executor 回報錯誤代碼：${code}`;

export function CloudRunsPanel() {
  const [runs, setRuns] = useState<CloudRun[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unauthorized">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/cloud-runs", { cache: "no-store" });
      if (response.status === 401) { setState("unauthorized"); return; }
      const value = parse(await response.json());
      if (!response.ok || !value) throw new Error("invalid");
      setRuns(value); setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const refresh = () => void load();
    window.addEventListener(CLOUD_RUNS_REFRESH_EVENT, refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(CLOUD_RUNS_REFRESH_EVENT, refresh);
    };
  }, [load]);

  const transition = async (run: CloudRun, next: "running" | "paused" | "stopped") => {
    setBusy(run.id);
    try {
      const response = await fetch(`/api/cloud-runs/${encodeURIComponent(run.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next, expectedVersion: run.version }),
      });
      const body = await response.json() as { run?: CloudRun };
      if (!response.ok || !body.run) throw new Error("failed");
      setRuns((current) => current.map((item) => item.id === run.id ? body.run! : item));
    } catch { await load(); } finally { setBusy(null); }
  };

  return <section className="runs-panel runs-panel--cloud glass-panel" aria-labelledby="cloud-runs-title">
    <div className="runs-panel__heading"><div><p className="eyebrow">AWS EXECUTOR / ALWAYS ON</p>
      <h2 id="cloud-runs-title">24/7 雲端運行</h2><p>策略在固定 IP 的 AWS Executor 持續執行，瀏覽器只負責查看與控制。</p></div>
      {state === "ready" && <button className="button button--ghost button--small" onClick={() => void load()} type="button">重新整理</button>}</div>
    {state === "loading" && <p className="runs-empty" role="status">正在同步 AWS Executor 運行狀態…</p>}
    {state === "unauthorized" && <p className="runs-empty">請先 <Link href="/auth?return_to=%2Fruns">登入</Link>。</p>}
    {state === "error" && <p className="runs-empty">暫時無法載入雲端運行。</p>}
    {state === "ready" && runs.length === 0 && <div className="runs-empty"><p>尚無雲端運行。可從獨立啟動頁建立第一個策略。</p>
      <div className="button-row"><Link className="button button--primary button--small" href="/connections">綁定 WEEX API</Link>
        <Link className="button button--ghost button--small" href="/runs/new">啟動策略</Link></div></div>}
    {runs.length > 0 && <ul className="run-list">{runs.map((run) => {
      const signal = typeof run.lastSignalJson === "string" ? JSON.parse(run.lastSignalJson) as Record<string, unknown>
        : run.lastSignalJson;
      return <li key={run.id}><article className="run-card glass-panel">
        <div className="run-card__header"><div><p className="eyebrow">{run.mode === "live" ? "WEEX LIVE / REAL FUNDS" : "WEEX FUTURES DEMO"}</p>
          <h3>{run.name}</h3></div><span className={`status-chip status-chip--${run.state}`}>{stateLabel[run.state]}</span></div>
        <dl className="run-card__metrics"><div><dt>最後評估</dt><dd>{time(run.lastEvaluatedAt)}</dd></div>
          <div><dt>最後訊號</dt><dd>{typeof signal?.action === "string" ? signal.action : "等待中"}</dd></div>
          <div><dt>連續錯誤</dt><dd>{run.consecutiveFailures}</dd></div></dl>
        {run.lastErrorCode && <p className="control-feedback" data-error-code={run.lastErrorCode} role="alert">
          執行器暫停原因：{cloudRunFailureMessage(run.lastErrorCode)}
        </p>}
        {run.state !== "stopped" && <div className="button-row">
          {run.state === "running"
            ? <button className="button button--secondary button--small" disabled={busy === run.id}
              onClick={() => void transition(run, "paused")} type="button">暫停</button>
            : <button className="button button--primary button--small" disabled={busy === run.id}
              onClick={() => void transition(run, "running")} type="button">恢復</button>}
          <button className="button button--ghost button--small" disabled={busy === run.id}
            onClick={() => void transition(run, "stopped")} type="button">停止</button>
        </div>}
      </article></li>;
    })}</ul>}
  </section>;
}
