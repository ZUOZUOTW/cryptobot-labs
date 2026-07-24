"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
    return () => window.clearTimeout(timer);
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
    {state === "ready" && runs.length === 0 && <div className="runs-empty"><p>尚無雲端運行。先綁定 WEEX API，再從組裝車間啟動策略。</p>
      <div className="button-row"><Link className="button button--primary button--small" href="/connections">綁定 WEEX API</Link>
        <Link className="button button--ghost button--small" href="/workshop">前往組裝車間</Link></div></div>}
    {runs.length > 0 && <ul className="run-list">{runs.map((run) => {
      const signal = typeof run.lastSignalJson === "string" ? JSON.parse(run.lastSignalJson) as Record<string, unknown>
        : run.lastSignalJson;
      return <li key={run.id}><article className="run-card glass-panel">
        <div className="run-card__header"><div><p className="eyebrow">{run.mode === "live" ? "LIVE" : "WEEX FUTURES DEMO"}</p>
          <h3>{run.name}</h3></div><span className={`status-chip status-chip--${run.state}`}>{stateLabel[run.state]}</span></div>
        <dl className="run-card__metrics"><div><dt>最後評估</dt><dd>{time(run.lastEvaluatedAt)}</dd></div>
          <div><dt>最後訊號</dt><dd>{typeof signal?.action === "string" ? signal.action : "等待中"}</dd></div>
          <div><dt>連續錯誤</dt><dd>{run.consecutiveFailures}</dd></div></dl>
        {run.lastErrorCode && <p className="control-feedback" role="alert">執行器暫停原因：{run.lastErrorCode}</p>}
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
