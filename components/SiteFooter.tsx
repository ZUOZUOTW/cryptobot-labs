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
          <p>WEEX 專屬自動交易策略實驗室</p>
        </div>

        <div className="site-footer__disclosure" role="note" aria-label="模擬交易揭露">
          <strong>{SIMULATION_DISCLOSURE}</strong>
          <p>
            本原型僅支援 WEEX。所有策略與績效皆為模擬內容；不接受 API Key、不連接真實帳戶，也不執行真實下單。
          </p>
        </div>

        <p className="site-footer__meta">
          <span className="exchange-badge">WEEX ONLY</span>
          <span>© {new Date().getFullYear()} CryptoBot Labs</span>
        </p>
      </div>
    </footer>
  );
}
