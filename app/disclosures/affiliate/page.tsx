import Link from "next/link";

export const metadata = { title: "推薦關係揭露｜CryptoBot Labs" };

export default function AffiliateDisclosurePage() {
  return <div className="legal-page site-container"><header className="page-intro"><p className="eyebrow">AFFILIATE DISCLOSURE</p><h1>推薦關係揭露</h1><p>CryptoBot Labs 的部分 WEEX 註冊連結可能包含推薦代碼。你使用這些連結不會增加本站向你收取的費用。</p></header>
    <section className="glass-panel legal-copy"><h2>我們如何標示</h2><p>含推薦關係的按鈕附近會直接顯示揭露文字與推廣來源。分享連結只接受本站核准的 promoter slug，不接受任意外部網址或未核准代碼。</p><h2>歸屬與資料</h2><p>本站僅保存站內 first-touch、last-touch 與註冊時鎖定的來源。最終推薦歸屬、資格與任何 WEEX Partner／Broker 計畫資料，以 WEEX 實際確認為準。</p><h2>展示版限制</h2><p>目前是展示流程，不會建立真實 OAuth 連線、不會讀取返佣資料，也不會顯示未經 WEEX 核實的佣金或推薦名單。</p><Link className="button button--primary" href="/connections">返回 WEEX 連線流程</Link></section>
  </div>;
}
