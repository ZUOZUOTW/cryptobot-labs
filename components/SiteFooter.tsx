import Link from "next/link";

export const SIMULATION_DISCLOSURE = "模擬回測資料，不代表未來績效";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-container site-footer__inner">
        <div className="site-footer__brand">
          <Link className="brand brand--footer" href="/" aria-label="CryptoBot Labs 首頁">
            <span className="brand__orbit" aria-hidden="true">
              <span className="brand__core" />
            </span>
            <span className="brand__wordmark">
              <strong>CryptoBot</strong>
              <span>Labs</span>
            </span>
          </Link>
          <p>自動策略實驗室</p>
        </div>

        <div className="site-footer__disclosure" role="note" aria-label="回測資料揭露">
          <strong>回測結果，不代表未來績效</strong>
          <p>
            公開績效皆為歷史回測或模擬資料。正式連線使用 WEEX OAuth，憑證由後端加密保存；展示模式不接收任何憑證。
          </p>
        </div>

        <div className="site-footer__links">
          <p className="site-footer__label">LEGAL / RISK</p>
          <nav className="site-footer__legal" aria-label="法律與風險資訊">
            <Link href="/privacy">隱私權政策</Link>
            <Link href="/terms">服務條款</Link>
            <Link href="/disclosures/risk">交易風險揭露</Link>
            <Link href="/disclosures/affiliate">推薦關係揭露</Link>
          </nav>
        </div>

        <div className="site-footer__bottom">
          <span>CRYPTOBOT LABS / AUTOMATED STRATEGY RESEARCH</span>
          <span>© {new Date().getFullYear()} CryptoBot Labs</span>
        </div>
      </div>
    </footer>
  );
}
