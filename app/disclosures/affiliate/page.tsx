import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveRequestLocale } from "@/lib/i18n/locales";
import { translateMessage } from "@/lib/i18n/messages";

const metadataCopy = {
  title: "推廣與推薦關係揭露｜CryptoBot Labs",
  description: "說明 CryptoBot Labs 策略頁中的 WEEX 推廣來源、推薦關係與使用者選擇。",
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const locale = resolveRequestLocale(requestHeaders.get("cookie"), requestHeaders.get("accept-language"));
  return {
    title: translateMessage(locale, metadataCopy.title),
    description: translateMessage(locale, metadataCopy.description),
  };
}

export default function AffiliateDisclosurePage() {
  return (
    <div className="legal-page site-container">
      <header className="page-intro">
        <p className="eyebrow">AFFILIATE / REFERRAL DISCLOSURE</p>
        <h1>推廣與推薦關係揭露</h1>
        <p>清楚說明策略分享頁中的 WEEX 邀請連結如何產生，以及它可能帶來的推薦關係。</p>
      </header>

      <section className="glass-panel legal-copy">
        <h2>連結如何核准</h2>
        <p>只有經 CryptoBot Labs 伺服器確認為有效且已核准的 KOL／BD，才能在公開策略頁顯示自己的 WEEX 邀請連結。普通會員、待審核、已停用或不存在的推廣來源都不能加入自訂邀請連結。</p>

        <h2>可能的推薦關係</h2>
        <p><strong>此連結可能包含推薦關係，您的使用費用不因此增加。</strong> 若您透過該連結註冊或使用 WEEX，CryptoBot Labs 或該策略發布者可能依 WEEX 的實際規則取得推廣權益。是否成立、如何計算及是否可歸因，均以 WEEX 的正式紀錄與規則為準。</p>

        <h2>你的選擇</h2>
        <p>使用邀請連結不是查看、複製、回測或使用公開策略的必要條件。你可以略過邀請按鈕，直接前往 WEEX，且既有 WEEX 帳戶的推薦關係不會由本站變更或重新綁定。</p>

        <h2>不影響策略證據</h2>
        <p>推薦關係不會改變公開策略的歷史回測、風險揭露或排序證據，也不代表收益保證、投資建議或 WEEX 對該策略的背書。</p>

        <p><Link className="text-button" href="/legal">查看使用條款、隱私與風險說明</Link></p>
      </section>
    </div>
  );
}
