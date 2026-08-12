import Link from "next/link";
import { publicStrategyRisk, type PublicStrategyPublication } from "@/lib/strategy-publications";
import { formatDrawdownMagnitude, formatRate, formatSignedReturn } from "@/lib/strategy-sharing";
import { PerformanceChart } from "./PerformanceChart";

export function PublishedStrategyCard({ publication, favorite = false, onFavorite }: {
  publication: PublicStrategyPublication;
  favorite?: boolean;
  onFavorite?: (slug: string) => void;
}) {
  const points = publication.equityCurve.map((point) => ({
    label: new Date(point.timestamp).toISOString().slice(0, 10),
    value: Number(point.equity),
  })).filter((point) => Number.isFinite(point.value));
  return (
    <article className="published-strategy-card glass-panel" aria-labelledby={`published-${publication.slug}`}>
      <header>
        <div>
          <p className="eyebrow">COMMUNITY / VERIFIED</p>
          <h3 id={`published-${publication.slug}`}>{publication.name}</h3>
          <p>由 {publication.publisherName} 發布</p>
        </div>
        <div className="tag-row published-strategy-card__badges">
          {onFavorite && <button
            aria-label={`${favorite ? "取消收藏" : "收藏"} ${publication.name}`}
            aria-pressed={favorite}
            className="favorite-button"
            onClick={() => onFavorite(publication.slug)}
            type="button"
          ><span aria-hidden="true">{favorite ? "★" : "☆"}</span></button>}
          <span className="market-badge">{publication.market === "spot" ? "現貨" : "合約"} · {publication.timeframe}</span>
          <span className="risk-badge" data-risk={publicStrategyRisk(publication)}>{publicStrategyRisk(publication)}風險</span>
          <span className="evidence-badge">固定版本</span>
        </div>
      </header>
      <p className="published-strategy-card__description">{publication.description}</p>
      <PerformanceChart label={`${publication.name} 歷史權益曲線`} points={points} tone="cyan" variant="smooth" />
      <dl className="bot-card__metrics">
        <div><dt>總報酬</dt><dd>{formatSignedReturn(publication.metrics.totalReturn, 2)}</dd></div>
        <div><dt>最大回撤</dt><dd>{formatDrawdownMagnitude(publication.metrics.maxDrawdown, 2)}</dd></div>
        <div><dt>勝率</dt><dd>{formatRate(publication.metrics.winRate, 2)}</dd></div>
        <div><dt>交易次數</dt><dd>{publication.metrics.trades}</dd></div>
      </dl>
      <div className="bot-card__actions">
        <Link
          className="button button--primary button--small"
          href={`/workshop?publication=${encodeURIComponent(publication.slug)}`}
        >
          {publication.hasPrivateSource ? "套用公開積木版本" : "套用到組裝車間"}
        </Link>
        <Link className="button button--secondary button--small" href={`/strategies/${publication.slug}`}>查看公開策略</Link>
      </div>
      <p className="simulation-disclosure" role="note">WEEX 公開歷史行情回測，不代表未來績效</p>
    </article>
  );
}
