import Link from "next/link";
import { DemoRunsPanel } from "../../components/runs/DemoRunsPanel";
import { RunsPanel } from "../../components/runs/RunsPanel";
import { CloudRunsPanel } from "../../components/runs/CloudRunsPanel";
import { RunPortfolioDashboard } from "../../components/runs/RunPortfolioDashboard";
import { demoModeEnabled } from "../../lib/server/demo-mode";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const demoMode = demoModeEnabled();
  return (
    <div className="runs-page site-container">
      <header className="page-intro runs-page__intro">
        <p className="eyebrow">TRADING CONTROL CENTER</p>
        <h1>24/7 運行狀態<br />與風險控制</h1>
        <p>集中管理 AWS Executor 上的策略、心跳與風險狀態。關閉瀏覽器或電腦後，雲端策略仍會持續執行。</p>
        <div className="button-row"><Link className="button button--primary" href="/workshop">準備模擬策略</Link><Link className="button button--ghost" href="/connections">管理 WEEX 連線</Link></div>
        <p className="paper-default-note" role="note"><strong>{demoMode ? "展示模式：只允許模擬運行" : "正式會員：優先模擬"}</strong>。{demoMode
          ? "雲端執行器不會開啟 WEEX 私有 WebSocket，也不會送出真實訂單。"
          : "實盤仍需通過 WEEX 權限、風險設定、模擬證據及獨立同意閘門。"}</p>
      </header>
      {demoMode ? <DemoRunsPanel /> : <div className="runs-dashboard">
        <RunPortfolioDashboard />
        <CloudRunsPanel />
        <details className="legacy-runs-disclosure glass-panel">
          <summary><span><span className="eyebrow">LEGACY HISTORY</span><strong>舊版運行紀錄</strong></span><span>展開查看</span></summary>
          <div className="legacy-runs-disclosure__body"><RunsPanel /></div>
        </details>
      </div>}
    </div>
  );
}
