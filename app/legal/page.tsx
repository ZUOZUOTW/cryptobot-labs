import type { Metadata } from "next";
import { headers } from "next/headers";
import { resolveRequestLocale } from "@/lib/i18n/locales";
import { translateMessage } from "@/lib/i18n/messages";

const metadataCopy = {
  title: "使用條款、隱私與風險｜CryptoBot Labs",
  description: "CryptoBot Labs 的研究用途、資料處理原則與策略回測風險說明。",
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const locale = resolveRequestLocale(requestHeaders.get("cookie"), requestHeaders.get("accept-language"));
  return {
    title: translateMessage(locale, metadataCopy.title),
    description: translateMessage(locale, metadataCopy.description),
  };
}

export default function LegalPage() {
  return (
    <div className="legal-page site-container">
      <header className="page-intro">
        <p className="eyebrow">OPEN LEARNING / LEGAL &amp; RISK</p>
        <h1>使用條款、隱私與風險</h1>
      </header>
      <section className="glass-panel legal-copy">
        <h2 id="purpose">項目定位</h2>
        <p>CryptoBot Labs 是以非營利、開放學習為目的的策略研究實驗項目，提供策略範例、視覺化組裝、歷史回測與模擬研究工具。本站不是交易所、券商、投資顧問、資產保管人或收益保證人，所有內容只供學習、測試與研究，不構成個別投資建議。</p>

        <h2 id="terms">使用條款</h2>
        <p>使用者應遵守所在地法律，不得利用本站干擾服務、未經授權存取資料、冒用他人身分或從事違法交易活動。策略範例與研究結果可作為個人、非商業的學習材料；第三方名稱、商標與資料仍歸其權利人所有。</p>
        <p>本站可能更新、暫停或移除實驗功能，也不保證服務、資料或研究結果持續可用、即時、完整或無錯誤。使用者應自行評估任何策略設定與操作決定，並承擔由此產生的結果。</p>

        <h2 id="privacy">隱私與資料原則</h2>
        <p>本站只在提供帳戶、策略草稿、研究結果、偏好設定與基本安全維護所需的範圍內處理資料。可能包含使用者主動提供的帳戶資訊、策略參數、模擬紀錄，以及必要的裝置、時間與錯誤紀錄。</p>
        <p>我們不出售個人資料，也不會把研究資料用於未經說明的資產操作。資料只在合理需要期間保存，之後刪除或去識別化；使用者可依適用規範要求查詢、更正或刪除相關資料。請勿在策略名稱、程式碼或公開分享內容中放入密碼、金鑰或其他敏感資訊。</p>

        <h2 id="risk">策略與交易風險</h2>
        <p>加密資產價格可能劇烈波動，槓桿會同步放大獲利與損失，並可能造成強制平倉。歷史回測與模擬結果受資料品質、取樣期間、手續費、滑價、資金費率、流動性、成交假設與過度擬合影響，不代表未來績效。</p>
        <p>網路延遲、行情缺口、資料錯誤、規則設定不完整或外部服務中斷，都可能使研究結果與實際市場不同。請先在模擬環境驗證、採用可承受的風險上限，並獨立保存必要紀錄。若任何狀態或結果無法確認，應停止操作並重新檢查。</p>

        <h2 id="contact">異議與聯絡</h2>
        <p>若對資料處理、內容權利或本頁說明有疑問，可透過本站提供的聯絡管道提出。強制適用的消費者或個人資料權利，不因本說明而被排除。</p>
      </section>
    </div>
  );
}
