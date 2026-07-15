import Link from "next/link";

export const metadata = { title: "服務條款｜CryptoBot Labs" };

export default function TermsPage() {
  return <div className="legal-page site-container"><header className="page-intro"><p className="eyebrow">TERMS OF SERVICE</p><h1>服務條款</h1><p>更新日期：2026 年 7 月 14 日。使用 CryptoBot Labs 前，請閱讀並同意本條款與相關風險揭露。</p></header>
    <section className="glass-panel legal-copy"><h2>服務性質</h2><p>CryptoBot Labs 提供策略建立、歷史回測、模擬執行及在使用者明確授權後連接 WEEX API 的自動交易工具。本站不是交易所、券商、投資顧問、資產保管人或收益保證人；任何內容均不構成個別投資建議。</p>
      <h2>使用資格與帳戶責任</h2><p>你必須符合所在地及 WEEX 對帳戶、衍生品與 API 交易的資格要求，並確保提供資料正確。不得繞過地區限制、冒用他人帳戶、干擾安全控制、逆向取得憑證，或利用服務進行違法、市場操縱及未授權交易。</p>
      <h2>授權與交易控制</h2><p>你只授權本站依已保存的策略版本、交易標的及風控限制提交交易指令。實盤啟用必須經過獨立確認；停止新訂單、取消掛單與平倉是不同操作。你應持續監控帳戶，必要時可在本站緊急停止並直接到 WEEX 撤銷 API key。</p>
      <h2>費用與推薦關係</h2><p>WEEX 可能收取交易、資金費率或其他費用。部分註冊連結可能包含推薦代碼，本站可能依 WEEX 計畫取得利益；詳見<Link href="/disclosures/affiliate">推薦關係揭露</Link>。任何平台方案或費用會在收費前另行明示。</p>
      <h2>可用性與變更</h2><p>交易所 API、網路、雲端服務、市場資料或軟體可能中斷、延遲或變更。為保護使用者與系統，本站得暫停策略、撤銷連線或拒絕高風險指令。重大條款變更會在生效前以合理方式通知。</p>
      <h2>責任限制與終止</h2><p>在法律允許範圍內，使用者承擔交易決策與市場損益；本站不保證策略收益、成交價格或不中斷運作。你可以停止服務並撤銷 WEEX 授權；違反條款或造成安全風險時，本站也可停用帳戶。強制適用的消費者權利不因本條款而排除。</p>
      <p>實盤前必須另行閱讀並接受<Link href="/disclosures/risk">交易風險揭露</Link>與<Link href="/privacy">隱私權政策</Link>。營運主體、管轄法律、爭議處理及正式聯絡資訊須於正式收費或對外營運前完成法務核定。</p></section>
  </div>;
}
