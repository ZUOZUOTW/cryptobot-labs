import Link from "next/link";
import { OrbitalHero } from "../components/OrbitalHero";
import {
  DeferredHomePerformanceSections,
  DeferredStrategyAssemblyPlayer,
  DeferredStrategyCodePlayer,
} from "../components/home/DeferredHomeContent";

const steps = [
  ["01", "挑選", "從現貨、合約與不同風險等級中，找到符合想法的策略起點。"],
  ["02", "組裝", "組裝條件與風控，先用公開歷史行情回測，再決定是否運行。"],
  ["03", "自動運行", "通過回測與設置後，準備開始自動運行"],
] as const;

export default function Home() {
  return (
    <div className="landing-page">
      <OrbitalHero />

      <section className="landing-section site-container" aria-label="三步驟開始使用">
        <p className="eyebrow">PICK / SIMULATE / RUN</p>
        <h2 id="flow-title">三步，從想法到自動實現</h2>
        <ol className="step-grid">
          {steps.map(([number, title, description]) => (
            <li className="step-card glass-panel" key={number}>
              <span>{number}</span><h3>{title}</h3><p>{description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section site-container split-feature">
        <div>
          <p className="eyebrow">NO-CODE WORKSHOP</p>
          <h2>自由組裝各種策略</h2>
          <p>把進場、確認、出場、倉位與風控用點擊組合的方式，簡單實現你的交易想法。</p>
          <Link className="text-link" href="/workshop">進入組裝車間 <span aria-hidden="true">→</span></Link>
        </div>
        <DeferredStrategyAssemblyPlayer />
      </section>

      <section className="landing-section site-container split-feature split-feature--reverse">
        <div>
          <p className="eyebrow">ADVANCED MODE</p>
          <h2>支援匯入交易策略代碼</h2>
          <p>支持使用自行編寫的交易策略，幫助你開啟更多可能性</p>
          <Link className="text-link" href="/workshop?mode=javascript">開啟 JavaScript 模式 <span aria-hidden="true">→</span></Link>
        </div>
        <DeferredStrategyCodePlayer />
      </section>

      <DeferredHomePerformanceSections />

      <section className="landing-section landing-cta site-container">
        <p className="eyebrow">START WITH EVIDENCE</p><h2>選擇策略範本，或是由你從零開始組裝</h2>
        <div className="button-row"><Link className="button button--primary" href="/bots">先選一個策略</Link><Link className="button button--secondary" href="/workshop?new=1">從空白開始</Link></div>
      </section>
    </div>
  );
}
