"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RunCard } from "./RunCard";
import { parseRunList } from "./run-parser";
import type { RunView } from "./types";

export function RunsPanel() {
  const [runs, setRuns] = useState<RunView[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unauthorized">("loading");
  const [nextCursor, setNextCursor] = useState<{ createdAt: number; id: string } | null>(null);
  const [moreState, setMoreState] = useState<"idle" | "loading" | "error">("idle");
  const load = useCallback(async (cursor: { createdAt: number; id: string } | null = null) => {
    const append = cursor !== null;
    if (append) setMoreState("loading"); else setState("loading");
    try {
      const query = cursor ? `?limit=20&cursorCreatedAt=${cursor.createdAt}&cursorId=${encodeURIComponent(cursor.id)}` : "?limit=20";
      const response = await fetch(`/api/runs${query}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (response.status === 401) { setState("unauthorized"); return; }
      const parsed = parseRunList(await response.json());
      if (!response.ok || !parsed) throw new Error("invalid_run_list");
      setRuns((current) => append ? [...current, ...parsed.runs.filter(({ id }) => !current.some((item) => item.id === id))] : parsed.runs);
      setNextCursor(parsed.nextCursor); setMoreState("idle"); setState("ready");
    } catch { if (append) setMoreState("error"); else setState("error"); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  return (
    <section className="runs-panel" aria-labelledby="runs-title">
      <div className="runs-panel__heading"><div><p className="eyebrow">YOUR AGENT RUNS</p><h2 id="runs-title">我的運行</h2></div>{state === "ready" && <button className="button button--ghost button--small" onClick={() => void load()} type="button">重新整理</button>}</div>
      <div aria-live="polite">
        {state === "loading" && <p className="runs-empty">正在載入運行證據…</p>}
        {state === "error" && <div className="runs-empty"><p>無法載入運行。</p><button className="button button--secondary button--small" onClick={() => void load()} type="button">重試載入</button></div>}
        {state === "unauthorized" && <p className="runs-empty">登入狀態已過期。 <Link href="/auth?return_to=%2Fruns">重新登入</Link></p>}
        {state === "ready" && runs.length === 0 && <div className="runs-empty"><p>尚無運行。先在組裝車間完成策略與風險設定；建立後一律從模擬運行開始。</p><Link className="button button--primary button--small" href="/workshop">前往組裝車間</Link></div>}
      </div>
      {state === "ready" && runs.length > 0 && <ul className="run-list" aria-label="我的運行">{runs.map((run) => <li key={run.id}><RunCard run={run} /></li>)}</ul>}
      {state === "ready" && nextCursor && <button className="button button--secondary runs-more" disabled={moreState === "loading"} onClick={() => void load(nextCursor)} type="button">{moreState === "loading" ? "載入更多中…" : moreState === "error" ? "重試載入更多" : "載入更多"}</button>}
    </section>
  );
}
