import Link from "next/link";
import { RunsPanel } from "../../components/runs/RunsPanel";
import { requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const user = await requireChatGPTUser("/runs");
  return (
    <div className="runs-page site-container">
      <header className="page-intro runs-page__intro">
        <p className="eyebrow">TRADING CONTROL CENTER</p>
        <h1>運行證據<br />與風險控制</h1>
        <p>{user.displayName}，所有新運行一律從模擬開始。只有通過本機權限、完整風險上限與再次確認，才可向代理申請實盤。</p>
        <div className="button-row"><Link className="button button--primary" href="/workshop">準備模擬策略</Link><Link className="button button--ghost" href="/connections">管理本機連線</Link></div>
        <p className="paper-default-note" role="note"><strong>預設：模擬運行</strong>。網站上的實盤申請不代表已啟用；本機代理必須獨立重新驗證後才可執行。</p>
      </header>
      <RunsPanel />
    </div>
  );
}
