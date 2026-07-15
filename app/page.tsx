import Link from "next/link";
import { HomePerformanceSections } from "../components/HomePerformanceSections";
import { OrbitalHero } from "../components/OrbitalHero";

const steps = [
  ["01", "挑選", "從現貨、合約與不同風險等級中，找到符合想法的策略起點。"],
  ["02", "模擬", "組裝條件與風控，先用公開歷史行情回測，再啟動 Paper。"],
  ["03", "自動運行", "通過模擬與權限檢查後，才連接 WEEX 並設定雲端執行。"],
] as const;

export default function Home() {
  return (
    <div className="landing-page">
      <OrbitalHero />

      <section className="landing-section site-container" aria-label="三步驟開始使用">
        <p className="eyebrow">PICK / SIMULATE / RUN</p>
        <h2 id="flow-title">三步，從想法走到安全運行。</h2>
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
          <h2>多策略，自由組裝。</h2>
          <p>把進場、確認、出場、倉位與風控拆成看得懂的積木，依交易想法自由組合。</p>
          <Link className="text-link" href="/workshop">進入組裝車間 <span aria-hidden="true">→</span></Link>
        </div>
        <div className="feature-placeholder glass-panel" aria-label="多策略積木預覽">
          <span>RSI 反彈</span><span>＋</span><span>ATR 波動倉位</span><span>＋</span><span>固定風控</span>
        </div>
      </section>

      <section className="landing-section site-container split-feature split-feature--reverse">
        <div>
          <p className="eyebrow">ADVANCED MODE</p>
          <h2>用 JavaScript 寫下你的交易邏輯。</h2>
          <p>貼上策略程式後先做靜態檢查與白話摘要；程式不會在瀏覽器執行，也不會連線下單。</p>
          <Link className="text-link" href="/workshop?mode=javascript">開啟 JavaScript 模式 <span aria-hidden="true">→</span></Link>
        </div>
        <pre className="code-preview glass-panel" aria-label="WEEX 策略程式碼預覽"><code>{`if (signal.rsi < 30) {\n  strategy.enter("WEEX", "BTCUSDT");\n}`}</code></pre>
      </section>

      <HomePerformanceSections />

      <section className="landing-section site-container boundary-panel glass-panel">
        <div><p className="eyebrow">SECURE WEEX CONNECTION</p><h2>不用貼 API Key，也能安全準備自動執行。</h2></div>
        <p>正式版透過 WEEX 官方 OAuth 授權，憑證只由固定 IP 後端加密保存。第一個運行固定是 Paper，Live 必須另外通過完整安全門檻。</p>
        <Link className="text-link" href="/connections">查看安全連線流程 <span aria-hidden="true">→</span></Link>
      </section>

      <section className="landing-section landing-cta site-container">
        <p className="eyebrow">START WITH EVIDENCE</p><h2>先選一個策略，看懂風險再開始。</h2>
        <div className="button-row"><Link className="button button--primary" href="/bots">先選一個策略</Link><Link className="button button--secondary" href="/workshop?new=1">從空白開始</Link></div>
      </section>
    </div>
  );
}
