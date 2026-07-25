import Link from "next/link";
import { ManualApiConnectionFlow } from "../../components/connections/ManualApiConnectionFlow";
import { OAuthConnectionFlow } from "../../components/connections/OAuthConnectionFlow";
import { demoModeEnabled, productionOAuthReady } from "../../lib/server/demo-mode";

export default function ConnectionsPage() {
  const demoMode = demoModeEnabled();
  const oauthReady = demoMode || productionOAuthReady();
  return (
    <div className="connections-page site-container">
      <header className="page-intro connections-page__intro">
        <p className="eyebrow">WEEX API / AUTOMATED EXECUTION</p>
        <h1>安全連接 WEEX，<br />先從模擬開始</h1>
        <p>直接在網站綁定 WEEX API，策略交由固定 IP 的 AWS Executor 全天候運行。關閉瀏覽器與電腦後，策略仍會持續執行。</p>
        <div className="button-row"><Link className="button button--ghost" href="/workshop">返回組裝車間</Link><Link className="button button--ghost" href="/bots">先看策略</Link></div>
        <p className="connection-safety" role="note"><strong>重要：</strong>API Secret 與 Passphrase 只經由同源加密連線轉送一次，抵達雲端 Executor 後立即由 AWS KMS 加密；平台只使用 Readonly／Spot／Futures，完全不實作提領功能。</p>
      </header>

      <section className="connections-primary" aria-labelledby="manual-api-title">
        <div className="section-heading">
          <p className="eyebrow">AVAILABLE NOW / MANUAL API</p>
          <h2 id="manual-api-title">使用自己的 WEEX API 啟動策略</h2>
          <p>不需下載或安裝本機代理。綁定完成並通過歷史回測後，可從組裝車間明確確認風險，再建立由 AWS Executor 24/7 執行的 WEEX 自動策略。</p>
        </div>
        <ManualApiConnectionFlow />
      </section>

      <section className="connections-secondary" aria-labelledby="oauth-option-title">
        <details className="oauth-disclosure glass-panel">
          <summary>
            <span>
              <span className="eyebrow">OPTIONAL / WEEX OAUTH</span>
              <strong id="oauth-option-title">日後改用 WEEX 官方授權</strong>
              <small>OAuth 核准前不影響手動 API 與 24/7 雲端策略。</small>
            </span>
            <span className="oauth-disclosure__action">查看流程</span>
          </summary>
          <div className="oauth-disclosure__body">
            <p>OAuth 與手動 API 共用策略、風控和運行控制；正式核准後不需要重建策略。</p>
            {oauthReady ? <OAuthConnectionFlow /> : <section className="connection-auth-gate glass-panel"><p className="eyebrow">COMING SOON</p><h2>WEEX OAuth 尚未開放</h2><p>目前請使用上方「手動 API」流程；OAuth 核准前不會阻擋雲端策略運行。</p></section>}
          </div>
        </details>
      </section>
    </div>
  );
}
