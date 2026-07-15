import Link from "next/link";

export const metadata = { title: "隱私權政策｜CryptoBot Labs" };

export default function PrivacyPage() {
  return <div className="legal-page site-container"><header className="page-intro"><p className="eyebrow">PRIVACY POLICY</p><h1>隱私權政策</h1><p>更新日期：2026 年 7 月 14 日。本政策說明 CryptoBot Labs 在提供策略回測、WEEX 帳戶連線與自動交易控制服務時如何處理資料。</p></header>
    <section className="glass-panel legal-copy"><h2>我們處理的資料</h2><p>我們可能處理帳戶識別資料（電子郵件、顯示名稱及登入供應商識別碼）、策略與回測設定、裝置或雲端執行器狀態、交易指令與稽核事件、WEEX 連線狀態，以及維持服務安全所需的 IP、時間戳記與錯誤紀錄。</p><p>WEEX OAuth 取得的 API key、secret 與 passphrase 只在後端處理，使用雲端 KMS envelope encryption 保存；瀏覽器、網址、分析事件及一般應用程式日誌不得包含這些明文資料。本站不要求或保存 WEEX 密碼。</p>
      <h2>處理目的與依據</h2><p>資料用於驗證身分、執行使用者明確建立的策略、套用風控、提供狀態與交易紀錄、偵測濫用、回復服務及履行法令義務。我們不會出售個人資料，也不會使用交易憑證進行使用者未授權的提幣或資產轉移。</p>
      <h2>第三方與跨境處理</h2><p>服務可能使用 Netlify 提供網站與伺服器功能、Supabase 提供身分驗證與資料庫、AWS 提供固定出口執行環境及 KMS，以及 WEEX 提供交易所 OAuth 與交易 API。資料可能在這些服務商的營運地區處理，並受其安全與隱私條款約束。</p>
      <h2>保存、安全與刪除</h2><p>OAuth state 最長保存十分鐘且只能使用一次。交易與稽核紀錄依安全、爭議處理及法令需求保存；帳戶刪除後會刪除或去識別化不再需要的資料。憑證撤銷時會停止執行、刪除密文並使 KMS 關聯失效。備份中的資料會依備份生命週期淘汰。</p>
      <h2>你的權利</h2><p>你可以要求查詢、更正、匯出或刪除帳戶資料，也可以隨時在 WEEX 撤銷或刪除平台 API key。部分稽核資料可能因安全、交易爭議或法令義務而需保留。正式聯絡窗口會在營運主體與客服信箱完成核定後公告於本頁。</p>
      <p>使用服務前也請閱讀<Link href="/terms">服務條款</Link>與<Link href="/disclosures/risk">交易風險揭露</Link>。</p></section>
  </div>;
}
