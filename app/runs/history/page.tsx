import Link from "next/link";
import { RunsPanel } from "../../../components/runs/RunsPanel";

export const dynamic = "force-dynamic";

export default function RunHistoryPage() {
  return <div className="runs-page runs-page--task site-container">
    <Link className="back-link" href="/runs"><span aria-hidden="true">←</span> 返回控制中心</Link>
    <header className="run-task-heading">
      <div><p className="eyebrow">RUN EVIDENCE HISTORY</p><h1>運行紀錄</h1>
        <p>集中查看已停止策略與舊版運行證據，不干擾目前運行中的策略。</p></div>
    </header>
    <section className="glass-panel run-history-shell"><RunsPanel /></section>
  </div>;
}
