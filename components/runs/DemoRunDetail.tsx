"use client";

import Link from "next/link";
import { updateDemoRun, useDemoRuns } from "../../lib/demo-runs";

export function DemoRunDetail({ runId }: { runId: string }) {
  const run = useDemoRuns().find((candidate) => candidate.id === runId);
  if (!run) return <section className="runs-empty glass-panel"><p>找不到這個展示運行。</p><Link className="button button--secondary" href="/runs">返回我的運行</Link></section>;
  return <div className="run-detail"><header className="run-detail__header glass-panel"><div><p className="eyebrow">CLOUD RUN / {run.id}</p><h1>{run.botName}</h1><p>Paper · {run.state === "running" ? "運行中" : run.state === "paused" ? "已暫停" : "已停止"}</p></div><div className="run-detail__actions">
    {run.state !== "stopped" && <button className="button button--secondary" onClick={() => updateDemoRun(run.id, run.state === "running" ? "paused" : "running")} type="button">{run.state === "running" ? "暫停 Paper" : "繼續 Paper"}</button>}
    <button className="button button--danger" disabled type="button">Live 展示模式不可用</button></div></header>
    <section className="run-evidence"><div className="section-heading"><p className="eyebrow">PAPER EVIDENCE</p><h2>雲端執行證據</h2></div><dl className="run-facts run-facts--detail"><div><dt>模式</dt><dd>Paper 模擬</dd></div><div><dt>行情</dt><dd>共用公開 K 線</dd></div><div><dt>有效評估</dt><dd>{run.evaluationCount} / 10</dd></div><div><dt>當日損益</dt><dd>{run.pnl.toFixed(2)} USDT</dd></div><div><dt>單日虧損上限</dt><dd>{run.maxDailyLoss} USDT</dd></div><div><dt>未成交訂單</dt><dd>0</dd></div></dl></section>
    <section className="emergency-panel glass-panel"><p className="eyebrow">IMMEDIATE STOP</p><h2>立即停止</h2><p>停止會先阻擋新訂單；這個 Paper 展示不會影響任何真實帳戶或持倉。</p><button className="button button--danger" disabled={run.state === "stopped"} onClick={() => updateDemoRun(run.id, "stopped")} type="button">{run.state === "stopped" ? "已停止" : "立即停止新訂單"}</button></section>
  </div>;
}
