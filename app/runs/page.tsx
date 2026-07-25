import Link from "next/link";
import { DemoRunsPanel } from "../../components/runs/DemoRunsPanel";
import { RunPortfolioDashboard } from "../../components/runs/RunPortfolioDashboard";
import { demoModeEnabled } from "../../lib/server/demo-mode";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const demoMode = demoModeEnabled();
  return (
    <div className="runs-page runs-page--control site-container">
      <header className="control-center-heading">
        <div><h1>控制中心</h1><span>{demoMode ? "模擬策略與風控證據" : "帳戶同步與策略狀態即時更新"}</span></div>
        {!demoMode && <Link className="button button--primary" href="/runs/new">啟動新策略</Link>}
      </header>
      {demoMode ? <DemoRunsPanel /> : <RunPortfolioDashboard />}
    </div>
  );
}
