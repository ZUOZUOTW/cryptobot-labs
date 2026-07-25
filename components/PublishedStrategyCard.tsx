import Link from "next/link";
import type { PublicStrategyPublication } from "@/lib/strategy-publications";
import { PerformanceChart } from "./PerformanceChart";

const percent = (value: string): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed >= 0 ? "+" : ""}${(parsed * 100).toFixed(2)}%` : "—";
};

export function PublishedStrategyCard({ publication }: { publication: PublicStrategyPublication }) {
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
        <div className="tag-row">
          <span className="market-badge">{publication.market === "spot" ? "現貨" : "合約"} · {publication.timeframe}</span>
          <span className="evidence-badge">固定版本</span>
        </div>
      </header>
      <p className="published-strategy-card__description">{publication.description}</p>
      <PerformanceChart label={`${publication.name} 歷史權益曲線`} points={points} tone="cyan" variant="smooth" />
      <dl className="bot-card__metrics">
        <div><dt>總報酬</dt><dd>{percent(publication.metrics.totalReturn)}</dd></div>
        <div><dt>最大回撤</dt><dd>{percent(publication.metrics.maxDrawdown)}</dd></div>
        <div><dt>勝率</dt><dd>{percent(publication.metrics.winRate)}</dd></div>
        <div><dt>交易次數</dt><dd>{publication.metrics.trades}</dd></div>
      </dl>
      <div className="bot-card__actions">
        <Link className="button button--primary button--small" href={`/strategies/${publication.slug}`}>查看公開策略</Link>
      </div>
      <p className="simulation-disclosure" role="note">WEEX 公開歷史行情回測，不代表未來績效</p>
    </article>
  );
}
