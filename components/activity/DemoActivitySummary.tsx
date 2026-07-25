"use client";

import Link from "next/link";
import { useI18n } from "../I18nProvider";
import { demoAuthPath, useDemoUser } from "../../lib/demo-auth";
import { useDemoRuns } from "../../lib/demo-runs";

export function DemoActivitySummary() {
  const { locale } = useI18n();
  const user = useDemoUser();
  const runs = useDemoRuns();
  if (!user) return <section className="activity-empty glass-panel"><h2>登入後查看展示活動</h2><p>活動只來自目前瀏覽器的模擬展示，不含 API Key、Secret 或 Passphrase。</p><Link className="button button--primary" href={demoAuthPath("/activity")}>Google／Email 登入</Link></section>;
  if (runs.length === 0) return <section className="activity-empty glass-panel"><h2>尚無運行活動</h2><p>開始一個模擬運行後，狀態變更與評估摘要會顯示在這裡。</p><Link className="button button--primary" href="/workshop">建立模擬運行</Link></section>;
  return <section className="demo-activity-list glass-panel" aria-label="模擬活動紀錄">{runs.map((run) => <article key={run.id}><div><strong>{run.botName}</strong><p>模擬 · {run.state === "running" ? "運行中" : run.state === "paused" ? "已暫停" : "已停止"}</p></div><time dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleString(locale)}</time><Link href={`/runs/${run.id}`}>查看證據</Link></article>)}</section>;
}
