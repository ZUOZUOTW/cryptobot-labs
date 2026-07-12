import Link from "next/link";

const DISCLOSURE = "模擬回測資料，不代表未來績效";

export function OrbitalHero() {
  return (
    <section className="orbital-hero site-container" aria-labelledby="orbital-hero-title">
      <div className="orbital-hero__copy">
        <span className="exchange-badge">
          <span className="exchange-badge__signal" aria-hidden="true" />
          WEEX API · 推薦
        </span>
        <p className="eyebrow">AUTOMATED STRATEGY LAB / 01</p>
        <h1 id="orbital-hero-title">把交易想法，<br />組裝成你的機器人。</h1>
        <p className="orbital-hero__lead">
          從 10 組經典策略開始，組合交易條件、調整風控，用可重現的模擬回測理解每一個決策。
        </p>
        <div className="button-row">
          <Link className="button button--primary" href="/bots">探索機器人</Link>
          <Link className="button button--secondary" href="/workshop">開始組裝</Link>
        </div>
        <p className="simulation-disclosure" role="note">{DISCLOSURE}</p>
      </div>

      <div className="orbital-hero__visual" aria-label="策略核心與模擬績效概覽">
        <div className="orbital-core" aria-hidden="true">
          <span className="orbital-core__ring orbital-core__ring--outer" />
          <span className="orbital-core__ring orbital-core__ring--inner" />
          <span className="orbital-core__node orbital-core__node--one" />
          <span className="orbital-core__node orbital-core__node--two" />
          <span className="orbital-core__signal" />
          <span className="orbital-core__label">STRATEGY<br />CORE</span>
        </div>
        <article className="hero-metric hero-metric--return glass-panel float-motion">
          <span>模擬累積收益</span><strong>+126.4%</strong><small>{DISCLOSURE}</small>
        </article>
        <article className="hero-metric hero-metric--risk glass-panel float-motion">
          <span>最大回撤</span><strong>−17.9%</strong><small>{DISCLOSURE}</small>
        </article>
        <article className="hero-metric hero-metric--status glass-panel">
          <span className="status-dot" aria-hidden="true" />
          固定種子模擬中
        </article>
      </div>
    </section>
  );
}
