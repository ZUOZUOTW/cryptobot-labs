"use client";

import Link from "next/link";
import { demoAuthPath, useDemoUser } from "../../lib/demo-auth";
import { useDemoRuns } from "../../lib/demo-runs";

export function DemoActivitySummary() {
  const user = useDemoUser();
  const runs = useDemoRuns();
  if (!user) return <section className="activity-empty glass-panel"><h2>登入後查看展示活動</h2><p>活動只來自目前瀏覽器的 Paper 展示，不含 API Key、Secret 或 Passphrase。</p><Link className="button button--primary" href={demoAuthPath("/activity")}>Google／Email 登入</Link></section>;
  if (runs.length === 0) return <section className="activity-empty glass-panel"><h2>尚無運行活動</h2><p>開始一個 Paper 運行後，狀態變更與評估摘要會顯示在這裡。</p><Link className="button button--primary" href="/workshop">建立 Paper 運行</Link></section>;
  return <section className="demo-activity-list glass-panel" aria-label="Paper 活動紀錄">{runs.map((run) => <article key={run.id}><div><strong>{run.botName}</strong><p>Paper · {run.state === "running" ? "運行中" : run.state === "paused" ? "已暫停" : "已停止"}</p></div><time dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleString("zh-TW")}</time><Link href={`/runs/${run.id}`}>查看證據</Link></article>)}</section>;
}
