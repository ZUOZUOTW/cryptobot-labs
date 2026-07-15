import Link from "next/link";
import { OAuthConnectionFlow } from "../../components/connections/OAuthConnectionFlow";
import { demoModeEnabled, productionOAuthReady } from "../../lib/server/demo-mode";

export default function ConnectionsPage() {
  const demoMode = demoModeEnabled();
  return (
    <div className="connections-page site-container">
      <header className="page-intro connections-page__intro">
        <p className="eyebrow">WEEX OAUTH / CLOUD EXECUTION</p>
        <h1>安全連接 WEEX，<br />先從模擬開始</h1>
        <p>不用安裝桌面程式，也不用複製貼上 API Key。WEEX 官方授權後，由固定 IP 後端完成 KMS 加密與權限檢查。</p>
        <div className="button-row"><Link className="button button--ghost" href="/workshop">返回組裝車間</Link><Link className="button button--ghost" href="/bots">先看策略</Link></div>
        <p className="connection-safety" role="note"><strong>重要：</strong>{demoMode ? "展示模式不會連接 WEEX 或接收任何憑證；" : "正式 OAuth 只會建立無提領權限的加密連線；"}Live 功能保持停用。</p>
      </header>
      {demoMode || productionOAuthReady() ? <OAuthConnectionFlow /> : <section className="connection-auth-gate glass-panel"><p className="eyebrow">FAIL CLOSED</p><h2>WEEX OAuth 尚未開放</h2><p>缺少正式登入或 Executor 交接設定，OAuth start 與 Live 已安全停用。</p></section>}
    </div>
  );
}
