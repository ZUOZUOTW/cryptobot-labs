import Link from "next/link";
import { DemoRunsPanel } from "../../components/runs/DemoRunsPanel";
import { RunsPanel } from "../../components/runs/RunsPanel";
import { demoModeEnabled } from "../../lib/server/demo-mode";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const demoMode = demoModeEnabled();
  return (
    <div className="runs-page site-container">
      <header className="page-intro runs-page__intro">
        <p className="eyebrow">TRADING CONTROL CENTER</p>
        <h1>運行證據<br />與風險控制</h1>
        <p>集中查看模擬／實盤模式、心跳、行情、風險用量、掛單與持倉摘要。所有新運行一律先從模擬模式開始。</p>
        <div className="button-row"><Link className="button button--primary" href="/workshop">準備模擬策略</Link><Link className="button button--ghost" href="/connections">管理 WEEX 連線</Link></div>
        <p className="paper-default-note" role="note"><strong>{demoMode ? "展示模式：只允許模擬運行" : "正式會員：優先模擬"}</strong>。{demoMode
          ? "雲端執行器不會開啟 WEEX 私有 WebSocket，也不會送出真實訂單。"
          : "實盤仍需通過 WEEX 權限、風險設定、模擬證據及獨立同意閘門。"}</p>
      </header>
      {demoMode ? <DemoRunsPanel /> : <RunsPanel />}
    </div>
  );
}
