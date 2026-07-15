"use client";

import Link from "next/link";
import { demoAuthPath, useDemoUser } from "../../lib/demo-auth";
import { useDemoRuns } from "../../lib/demo-runs";

export function DemoRunsPanel() {
  const user = useDemoUser(); const runs = useDemoRuns();
  if (!user) return <section className="runs-empty glass-panel"><h2>登入後查看你的雲端運行</h2><p>策略草稿仍保留在瀏覽器；登入後會回到這裡。</p><Link className="button button--primary" href={demoAuthPath("/runs")}>Google／Email 登入</Link></section>;
  if (!runs.length) return <section className="runs-empty glass-panel"><h2>還沒有 Paper 運行</h2><p>先套用策略、完成快速回測與風險設定，再建立第一個模擬運行。</p><Link className="button button--primary" href="/workshop?bot=orbit-dca">選擇策略</Link></section>;
  return <section className="runs-panel" aria-labelledby="runs-title"><div className="runs-panel__heading"><div><p className="eyebrow">CLOUD EXECUTOR / DEMO</p><h2 id="runs-title">我的運行</h2></div><span className="paper-mode-badge">PAPER</span></div>
    <ul className="run-list">{runs.map((run) => <li key={run.id}><article className="run-card glass-panel"><div className="run-card__heading"><div><p className="eyebrow">{run.id}</p><h3>{run.botName}</h3></div><span className="paper-mode-badge">Paper</span></div>
      <dl className="run-facts"><div><dt>執行狀態</dt><dd>{run.state === "running" ? "運行中" : run.state === "paused" ? "已暫停" : "已停止"}</dd></div><div><dt>行情狀態</dt><dd>共用公開行情</dd></div><div><dt>有效評估</dt><dd>{run.evaluationCount} / 10</dd></div><div><dt>今日損益</dt><dd>{run.pnl.toFixed(2)} USDT</dd></div></dl>
      <Link className="button button--secondary button--small" href={`/runs/${run.id}`}>查看運行與停止控制</Link></article></li>)}</ul>
  </section>;
}
