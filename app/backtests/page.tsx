import Link from "next/link";
import { requireChatGPTUser } from "../chatgpt-auth";
import { BacktestHistory } from "../../components/backtests/BacktestHistory";

export const dynamic = "force-dynamic";

export default async function BacktestsPage() {
  const user = await requireChatGPTUser("/backtests");
  return (
    <div className="backtests-page site-container">
      <header className="page-intro backtests-page__intro">
        <p className="eyebrow">HISTORICAL EVIDENCE VAULT</p>
        <h1>歷史回測紀錄</h1>
        <p>{user.displayName}，這裡只顯示屬於你的 WEEX 公開行情回測。每份結果保留資料品質、成本模型與雜湊溯源。</p>
        <div className="button-row"><Link className="button button--primary" href="/workshop">前往組裝車間</Link><a className="button button--ghost" href="/signout-with-chatgpt?return_to=%2F">登出</a></div>
        <p className="historical-disclaimer" role="note">歷史回測不是實盤績效，也不保證未來結果。</p>
      </header>
      <BacktestHistory />
    </div>
  );
}
