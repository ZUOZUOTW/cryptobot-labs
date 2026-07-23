import Link from "next/link";
import { DemoActivitySummary } from "../../components/activity/DemoActivitySummary";
import { ActivityTable } from "../../components/activity/ActivityTable";
import { demoModeEnabled } from "../../lib/server/demo-mode";

export const dynamic = "force-dynamic";

export default function ActivityPage() {
  const demoMode = demoModeEnabled();
  return (
    <div className="activity-page site-container">
      <header className="page-intro activity-page__intro">
        <p className="eyebrow">AUDIT &amp; ORDER EVIDENCE</p>
        <h1>每個決策<br />都有可查證軌跡</h1>
        <p>這裡集中顯示{demoMode ? "展示網站產生的模擬運行" : "帳號內的模擬運行、風險與執行"}活動證據。你可以核對策略版本、風險狀態與運行時間。</p>
        <div className="button-row"><Link className="button button--primary" href="/runs">查看運行</Link><Link className="button button--ghost" href="/connections">管理連線</Link></div>
        <p className="activity-safety" role="note"><strong>安全邊界：</strong>活動紀錄不包含 API Key、API Secret 或 Passphrase。</p>
      </header>
      {demoMode ? <DemoActivitySummary /> : <ActivityTable />}
    </div>
  );
}
