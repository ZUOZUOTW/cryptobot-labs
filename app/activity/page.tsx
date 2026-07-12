import Link from "next/link";
import { ActivityTable } from "../../components/activity/ActivityTable";
import { requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const user = await requireChatGPTUser("/activity");
  return (
    <div className="activity-page site-container">
      <header className="page-intro activity-page__intro">
        <p className="eyebrow">AUDIT &amp; ORDER EVIDENCE</p>
        <h1>每個決策<br />都有可查證軌跡</h1>
        <p>{user.displayName}，這裡集中顯示網站與本機代理回傳的活動證據。你可以核對版本、風險判斷、訂單識別碼與 correlation ID。</p>
        <div className="button-row"><Link className="button button--primary" href="/runs">查看運行</Link><Link className="button button--ghost" href="/connections">管理連線</Link></div>
        <p className="activity-safety" role="note"><strong>安全邊界：</strong>活動紀錄與匯出檔不包含 API Key、API Secret 或 Passphrase；交易憑證只保存在本機代理。</p>
      </header>
      <ActivityTable />
    </div>
  );
}
