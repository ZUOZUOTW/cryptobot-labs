import Link from "next/link";

const DISCLOSURE = "模擬回測資料，不代表未來績效";

export function OrbitalHero() {
  return (
    <section className="orbital-hero site-container" aria-labelledby="orbital-hero-title">
      <div className="orbital-hero__copy">
        <p className="eyebrow">AUTOMATED STRATEGY LAB / 01</p>
        <h1 id="orbital-hero-title">把交易想法，組成能先模擬的自動策略。</h1>
        <p className="orbital-hero__lead">
          不用安裝程式、不用貼 API 金鑰。挑選或組裝策略，先回測與模擬，再安全連接 WEEX。
        </p>
        <div className="button-row">
          <Link className="button button--primary" href="/bots">探索策略</Link>
          <Link className="button button--secondary" href="/workshop?new=1">從空白組裝</Link>
        </div>
        <div className="hero-trust-row" role="note"><span>先模擬</span><span>可隨時停止</span><span>WEEX OAuth</span></div>
        <p className="simulation-disclosure" role="note">{DISCLOSURE}</p>
      </div>

      <div className="orbital-hero__visual" aria-label="策略核心與模擬績效概覽">
        <div className="ai-observatory">
          <div className="ai-observatory__sphere" aria-hidden="true" />
          <span className="ai-observatory__token ai-observatory__token--btc" aria-hidden="true">BTC</span>
          <span className="ai-observatory__token ai-observatory__token--ai" aria-hidden="true">AI</span>
          <span className="ai-observatory__token ai-observatory__token--risk" aria-hidden="true">RISK</span>
          <img alt="親切可愛的 AI 機器人正在分析加密貨幣策略" className="ai-observatory__mascot" height="500" src="/mascots/ai-observer.png" width="560" />
          <div className="ai-observatory__caption"><span aria-hidden="true" />AI STRATEGY OBSERVATORY</div>
        </div>
        <article className="hero-metric hero-metric--return glass-panel float-motion">
          <span>模擬累積收益</span><strong>+126.4%</strong><small>{DISCLOSURE}</small>
        </article>
        <article className="hero-metric hero-metric--risk glass-panel float-motion">
          <span>最大回撤</span><strong>−17.9%</strong><small>{DISCLOSURE}</small>
        </article>
        <article className="hero-metric hero-metric--status glass-panel">
          <span className="status-dot" aria-hidden="true" />
          Paper 模擬中
        </article>
      </div>
    </section>
  );
}
