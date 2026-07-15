import Link from "next/link";
import { DemoBacktestHistory } from "../../components/backtests/DemoBacktestHistory";
import { BacktestHistory } from "../../components/backtests/BacktestHistory";
import { demoModeEnabled } from "../../lib/server/demo-mode";

export const dynamic = "force-dynamic";

export default function BacktestsPage() {
  const demoMode = demoModeEnabled();
  return (
    <div className="backtests-page site-container">
      <header className="page-intro backtests-page__intro">
        <p className="eyebrow">HISTORICAL EVIDENCE VAULT</p>
        <h1>歷史回測紀錄</h1>
        <p>{demoMode ? "這裡顯示目前瀏覽器保存的展示回測。" : "這裡顯示你帳號保存的 WEEX 公開行情回測，包含資料品質、成本模型與版本雜湊。"}</p>
        <div className="button-row"><Link className="button button--primary" href="/workshop">前往組裝車間</Link><Link className="button button--ghost" href="/runs">查看 Paper 運行</Link></div>
        <p className="historical-disclaimer" role="note">歷史回測不是實盤績效，也不保證未來結果。</p>
      </header>
      {demoMode ? <DemoBacktestHistory /> : <BacktestHistory />}
    </div>
  );
}
