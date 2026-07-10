import Link from "next/link";
import { BOT_CATALOG } from "../data/bots";
import { BotCard } from "../components/BotCard";
import { OrbitalHero } from "../components/OrbitalHero";

const steps = [
  ["01", "挑選", "從現貨、合約與不同風險等級中，找到符合想法的策略起點。"],
  ["02", "組裝", "加入多個條件與風控積木，或使用 JavaScript 描述進階邏輯。"],
  ["03", "回測與下載", "先檢視可重現的模擬結果，再下載 WEEX 專屬策略包。"],
] as const;

const leaderboardPreview = BOT_CATALOG.toSorted((a, b) => b.metrics.totalReturn - a.metrics.totalReturn).slice(0, 3);

export default function Home() {
  return (
    <div className="landing-page">
      <OrbitalHero />

      <section className="landing-section site-container" aria-label="三步驟開始使用">
        <p className="eyebrow">FROM IDEA TO PACKAGE</p>
        <h2 id="flow-title">三步，讓策略開始運轉。</h2>
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
          <span>RSI REBOUND</span><span>＋</span><span>ATR SENTINEL</span><span>＋</span><span>FIXED RISK</span>
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

      <section className="landing-section site-container" aria-labelledby="featured-title">
        <p className="eyebrow">CURATED BOTS</p><h2 id="featured-title">熱門機器人</h2>
        <div className="bot-grid bot-grid--featured">
          {[BOT_CATALOG[0], BOT_CATALOG[5], BOT_CATALOG[9]].map((bot) => <BotCard bot={bot} key={bot.id} />)}
        </div>
      </section>

      <section className="landing-section site-container" aria-labelledby="leaderboard-preview-title">
        <p className="eyebrow">SIMULATED LEADERBOARD</p><h2 id="leaderboard-preview-title">績效排行榜預覽</h2>
        <div className="leaderboard-preview glass-panel">
          <ol>
            {leaderboardPreview.map((bot, index) => (
              <li key={bot.id}>
                <span className="leaderboard-preview__rank">0{index + 1}</span>
                <div><strong>{bot.name}</strong><span>{bot.market === "spot" ? "現貨" : "合約"} · {bot.risk}風險</span></div>
                <dl><div><dt>累積收益</dt><dd>+{bot.metrics.totalReturn.toFixed(1)}%</dd></div><div><dt>夏普比率</dt><dd>{bot.metrics.sharpe.toFixed(2)}</dd></div></dl>
              </li>
            ))}
          </ol>
          <div className="leaderboard-preview__footer">
            <p className="simulation-disclosure" role="note">模擬回測資料，不代表未來績效</p>
            <Link className="text-link" href="/leaderboard">查看完整排行榜</Link>
          </div>
        </div>
      </section>

      <section className="landing-section site-container boundary-panel glass-panel">
        <div><p className="eyebrow">EXCHANGE BOUNDARY</p><h2>只為 WEEX 而生。</h2></div>
        <p>所有交易所設定與策略包都固定為 WEEX。首版不接受 API Key、不連接帳戶，也不執行真實下單。</p>
      </section>

      <section className="landing-section landing-cta site-container">
        <p className="eyebrow">READY TO ASSEMBLE?</p><h2>下一個策略，從這裡開始。</h2>
        <div className="button-row"><Link className="button button--primary" href="/bots">探索 10 組策略</Link><Link className="button button--secondary" href="/workshop">從空白開始</Link></div>
      </section>
    </div>
  );
}
