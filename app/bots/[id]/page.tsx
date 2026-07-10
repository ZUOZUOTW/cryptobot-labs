import Link from "next/link";
import { notFound } from "next/navigation";
import { BotDownloadButton } from "../../../components/BotCard";
import { MetricCard } from "../../../components/MetricCard";
import { PerformanceChart } from "../../../components/PerformanceChart";
import { BOT_CATALOG } from "../../../data/bots";
import type { BotDefinition } from "../../../lib/types";

interface BotDetailPageProps {
  params: Promise<{ id: string }>;
}

export function generateStaticParams() {
  return BOT_CATALOG.map((bot) => ({ id: bot.id }));
}

const marketLabel = (bot: BotDefinition) => bot.market === "spot" ? "WEEX 現貨" : "WEEX USDT-M 合約";

const monthlyReturns = (bot: BotDefinition) => bot.equityCurve.map((point, index) => {
  const previous = bot.equityCurve[index - 1]?.value ?? point.value;
  const change = previous === 0 ? 0 : ((point.value - previous) / previous) * 100;
  return { ...point, change };
});

export default async function BotDetailPage({ params }: BotDetailPageProps) {
  const { id } = await params;
  const bot = BOT_CATALOG.find((candidate) => candidate.id === id);

  if (!bot) notFound();

  const metrics = bot.metrics;
  const monthly = monthlyReturns(bot);

  return (
    <article className="bot-detail-page">
      <header className="bot-detail-hero site-container">
        <Link className="back-link" href="/bots"><span aria-hidden="true">←</span> 機器人市場</Link>
        <div className="bot-detail-hero__content">
          <div>
            <div className="tag-row">
              <span className="exchange-badge">WEEX ONLY</span>
              <span className="market-badge">{marketLabel(bot)} · {bot.timeframe}</span>
              <span className="risk-badge" data-risk={bot.risk}>{bot.risk}風險</span>
            </div>
            <p className="eyebrow">OFFICIAL STRATEGY / {bot.id.toUpperCase()}</p>
            <h1>{bot.name}</h1>
            <p className="bot-detail-hero__lead">{bot.description}</p>
            <div className="tag-row">{bot.tags.map((tag) => <span className="strategy-tag" key={tag}>{tag}</span>)}</div>
          </div>
          <div className="bot-detail-hero__actions">
            <Link className="button button--primary" href={`/workshop?bot=${bot.id}`}>複製到組裝車間</Link>
            <BotDownloadButton bot={bot} className="button button--secondary" label="下載官方策略包" />
          </div>
        </div>
        <p className="simulation-disclosure" role="note">{bot.disclaimer}</p>
      </header>

      <section className="detail-section site-container" aria-label="完整績效指標">
        <div className="metric-grid">
          <MetricCard label="累積收益" value={`+${metrics.totalReturn.toFixed(1)}%`} hint="模擬期間資產淨值變化" tone="mint" />
          <MetricCard label="年化報酬" value={`+${metrics.annualizedReturn.toFixed(1)}%`} hint="依模擬期間換算的年化值" tone="cyan" />
          <MetricCard label="最大回撤" value={`${metrics.maxDrawdown.toFixed(1)}%`} hint="模擬高點至低點最大跌幅" tone="danger" />
          <MetricCard label="勝率" value={`${metrics.winRate.toFixed(1)}%`} hint="獲利交易占全部交易比例" tone="violet" />
          <MetricCard label="盈虧比" value={metrics.profitFactor.toFixed(2)} hint="總獲利相對總虧損" tone="mint" />
          <MetricCard label="夏普比率" value={metrics.sharpe.toFixed(2)} hint="模擬風險調整後報酬" tone="cyan" />
          <MetricCard label="交易次數" value={metrics.trades} hint="365 日模擬期間成交次數" tone="violet" />
          <MetricCard label="運行天數" value={metrics.runningDays} hint="固定模擬觀察期間" tone="cyan" />
          <MetricCard label="風險等級" value={bot.risk} hint={`穩定度 ${metrics.stability} / 100`} tone={bot.risk === "高" ? "danger" : "mint"} />
        </div>
        <p className="simulation-disclosure" role="note">{bot.disclaimer}</p>
      </section>

      <section className="detail-section site-container detail-chart-grid">
        <div>
          <div className="section-heading"><p className="eyebrow">EQUITY CURVE</p><h2>模擬累積收益</h2></div>
          <PerformanceChart points={bot.equityCurve} label={`${bot.name} 累積收益曲線`} tone={bot.risk === "高" ? "danger" : "mint"} />
          <p className="simulation-disclosure" role="note">{bot.disclaimer}</p>
        </div>
        <div className="direction-panel glass-panel">
          <p className="eyebrow">TRADE DIRECTION</p><h2>交易方向分布</h2>
          <dl className="direction-bars">
            <div><dt>多頭訊號</dt><dd><span style={{ width: bot.market === "spot" ? "100%" : "62%" }} />{bot.market === "spot" ? "100%" : "62%"}</dd></div>
            <div><dt>空頭訊號</dt><dd><span style={{ width: bot.market === "spot" ? "0%" : "38%" }} />{bot.market === "spot" ? "0%" : "38%"}</dd></div>
          </dl>
          <p>{bot.market === "spot" ? "此現貨策略只模擬買入與退出，不建立空頭部位。" : "此合約策略依固定規則模擬多空雙向訊號。"}</p>
          <p className="simulation-disclosure" role="note">{bot.disclaimer}</p>
        </div>
      </section>

      <section className="detail-section site-container" aria-labelledby="monthly-title">
        <div className="section-heading"><p className="eyebrow">MONTHLY PERFORMANCE</p><h2 id="monthly-title">月度表現</h2></div>
        <div className="table-shell glass-panel">
          <table aria-label={`${bot.name} 月度表現`}>
            <thead><tr><th scope="col">月份</th><th scope="col">月末淨值</th><th scope="col">月度變化</th><th scope="col">方向</th></tr></thead>
            <tbody>{monthly.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th><td>{point.value.toFixed(1)}</td>
                <td className={point.change >= 0 ? "value-positive" : "value-negative"}>{point.change >= 0 ? "+" : ""}{point.change.toFixed(1)}%</td>
                <td>{point.change > 0 ? "上升" : point.change < 0 ? "下降" : "持平"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="simulation-disclosure" role="note">{bot.disclaimer}</p>
      </section>

      <section className="detail-section site-container strategy-guidance">
        <article className="guidance-card glass-panel"><span>01</span><h2>策略原理</h2><p>{bot.explanation}</p></article>
        <article className="guidance-card glass-panel"><span>02</span><h2>適用市場</h2><p>{bot.suitableFor}</p></article>
        <article className="guidance-card guidance-card--risk glass-panel"><span>03</span><h2>風險說明</h2><p>{bot.riskNote}</p></article>
      </section>

      <section className="detail-section detail-cta site-container glass-panel">
        <div><p className="eyebrow">CUSTOMIZE OR DOWNLOAD</p><h2>把官方策略變成你的版本。</h2><p>先複製到組裝車間調整參數，或下載固定 WEEX 設定的官方策略包。</p></div>
        <div className="button-row"><Link className="button button--primary" href={`/workshop?bot=${bot.id}`}>複製到組裝車間</Link><BotDownloadButton bot={bot} className="button button--secondary" label="下載官方策略包" /></div>
      </section>
    </article>
  );
}
