import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PerformanceChart } from "@/components/PerformanceChart";
import { StrategyShareActions } from "@/components/StrategyShareActions";
import { loadPublicStrategyPublication } from "@/lib/server/public-strategy-loader";

export const revalidate = 3600;

interface StrategyPageProps {
  params: Promise<{ slug: string }>;
}

const percent = (value: string): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed >= 0 ? "+" : ""}${(parsed * 100).toFixed(2)}%` : "—";
};

export async function generateMetadata({ params }: StrategyPageProps): Promise<Metadata> {
  const { slug } = await params;
  const publication = await loadPublicStrategyPublication(slug);
  if (!publication) return {};
  const title = `${publication.name}｜${publication.publisherName} 的公開策略`;
  const description = `${publication.description}。${publication.symbol} ${publication.timeframe}，查看經 WEEX 公開歷史行情驗證的績效與完整策略結構。`;
  const image = `/strategies/${publication.slug}/opengraph-image`;
  return {
    title,
    description,
    alternates: { canonical: `/strategies/${publication.slug}` },
    openGraph: {
      title,
      description,
      type: "article",
      url: `/strategies/${publication.slug}`,
      publishedTime: new Date(publication.publishedAt).toISOString(),
      images: [{ url: image, width: 1200, height: 630, alt: `${publication.name} 公開策略績效預覽` }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function StrategyPublicationPage({ params }: StrategyPageProps) {
  const { slug } = await params;
  const publication = await loadPublicStrategyPublication(slug);
  if (!publication) notFound();
  const chart = publication.equityCurve.map((point) => ({
    label: new Date(point.timestamp).toISOString().slice(0, 10),
    value: Number(point.equity),
  })).filter((point) => Number.isFinite(point.value));
  const market = publication.market === "spot" ? "現貨" : "USDT-M 合約";
  const range = publication.actualStartAt !== null && publication.actualEndAt !== null
    ? `${new Date(publication.actualStartAt).toLocaleDateString("zh-TW")}–${new Date(publication.actualEndAt).toLocaleDateString("zh-TW")}`
    : "完整公開行情區間";

  return (
    <article className="bot-detail-page public-strategy-page">
      <header className="bot-detail-hero site-container">
        <Link className="back-link" href="/bots"><span aria-hidden="true">←</span> 公開策略列表</Link>
        <div className="bot-detail-hero__content">
          <div className="bot-detail-hero__copy">
            <div className="tag-row">
              <span className="market-badge">{market} · {publication.timeframe}</span>
              <span className="evidence-badge">已驗證歷史回測</span>
            </div>
            <p className="eyebrow">COMMUNITY STRATEGY / IMMUTABLE VERSION</p>
            <h1>{publication.name}</h1>
            <p className="bot-detail-hero__lead">{publication.description}</p>
            <div className="bot-detail-hero__actions">
              <Link
                className="button button--primary"
                href={`/workshop?publication=${encodeURIComponent(publication.slug)}`}
              >
                {publication.hasPrivateSource ? "套用公開積木版本" : "套用並自行調整"}
              </Link>
              <a
                className="button button--secondary weex-referral-cta"
                href={publication.weexReferralUrl}
                rel="nofollow sponsored noopener noreferrer"
                target="_blank"
              >
                透過發布者邀請註冊 WEEX
              </a>
              <StrategyShareActions
                botId={publication.slug}
                botName={publication.name}
                sharePath={`/strategies/${publication.slug}`}
              />
            </div>
          </div>
          <aside className="bot-detail-snapshot glass-panel public-strategy-snapshot" aria-label="公開策略摘要">
            <Image alt="" aria-hidden="true" height={180} src="/mascots/ai-builder.webp" width={200} />
            <p className="eyebrow">VERIFIED SNAPSHOT</p>
            <dl>
              <div><dt>市場</dt><dd>{market}</dd></div>
              <div><dt>交易對</dt><dd>{publication.symbol}</dd></div>
              <div><dt>週期</dt><dd>{publication.timeframe.toUpperCase()}</dd></div>
              <div><dt>槓桿</dt><dd>{publication.leverage}×</dd></div>
              <div><dt>模組</dt><dd>{publication.blocks.length} 個</dd></div>
              <div><dt>驗證區間</dt><dd>{range}</dd></div>
            </dl>
          </aside>
        </div>
        <div className="strategy-publisher">
          <span>發布者</span>
          <strong>{publication.publisherName}</strong>
          <span>{publication.hasPrivateSource
            ? "公開固定版本 · 自訂程式碼不公開，套用時使用公開積木設定 · Email 不公開"
            : "公開固定版本 · 可建立自己的可編輯副本 · Email 不公開"}</span>
        </div>
        <p className="simulation-disclosure" role="note">WEEX 公開歷史行情回測，不代表未來績效；邀請連結由發布者提供。</p>
      </header>

      <section className="detail-section site-container public-strategy-performance" aria-labelledby="public-performance-title">
        <div className="section-heading">
          <p className="eyebrow">VERIFIED PERFORMANCE</p>
          <h2 id="public-performance-title">固定版本的歷史績效證據</h2>
          <p>以下數值來自發布時綁定的完整 WEEX 公開歷史行情回測，不以估算或範例數據替代。</p>
        </div>
        <div className="public-strategy-performance__grid">
          <PerformanceChart label={`${publication.name} 歷史權益曲線`} points={chart} tone="cyan" variant="smooth" />
          <dl className="historical-metrics glass-panel">
            <div><dt>總報酬</dt><dd>{percent(publication.metrics.totalReturn)}</dd></div>
            <div><dt>最大回撤</dt><dd>{percent(publication.metrics.maxDrawdown)}</dd></div>
            <div><dt>勝率</dt><dd>{percent(publication.metrics.winRate)}</dd></div>
            <div><dt>Sharpe</dt><dd>{publication.metrics.sharpe}</dd></div>
            <div><dt>Profit Factor</dt><dd>{publication.metrics.profitFactor ?? "—"}</dd></div>
            <div><dt>交易次數</dt><dd>{publication.metrics.trades}</dd></div>
          </dl>
        </div>
      </section>

      <section className="detail-section site-container bot-detail-structure" aria-labelledby="public-structure-title">
        <div className="section-heading">
          <p className="eyebrow">STRATEGY FLOW</p>
          <h2 id="public-structure-title">策略結構與參數</h2>
          <p>{publication.hasPrivateSource
            ? "公開頁顯示可審查的積木規則；其他用戶可建立積木副本，但發布者的自訂 JavaScript 原始碼不會被複製或公開。"
            : "公開頁顯示可審查的策略規則；其他用戶可將設定帶入組裝車間，建立自己的可編輯版本。"}</p>
        </div>
        <ol className="bot-detail-flow">
          {publication.blocks.map((block, index) => (
            <li className="bot-detail-flow__item glass-panel" key={`${block.id}-${index}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><small>{block.group.toUpperCase()}</small><h3>{block.name}</h3><p>{block.description}</p></div>
              <strong>{block.parameters.map((parameter) => `${parameter.label} ${parameter.value}${parameter.suffix ?? ""}`).join(" · ") || "無額外參數"}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="detail-section detail-cta site-container glass-panel public-strategy-referral">
        <div>
          <p className="eyebrow">START WITH WEEX</p>
          <h2>準備在 WEEX 開始驗證這個策略？</h2>
          <p>透過 {publication.publisherName} 的專屬邀請連結前往 WEEX 註冊；註冊完成後再回到 CryptoBot Labs 連線並自行設定風險限制。</p>
        </div>
        <div className="button-row">
          <Link
            className="button button--primary"
            href={`/workshop?publication=${encodeURIComponent(publication.slug)}`}
          >
            {publication.hasPrivateSource ? "使用公開積木建立副本" : "使用這個策略"}
          </Link>
          <a
            className="button button--secondary"
            href={publication.weexReferralUrl}
            rel="nofollow sponsored noopener noreferrer"
            target="_blank"
          >
            使用發布者邀請連結註冊
          </a>
          <StrategyShareActions
            botId={publication.slug}
            botName={publication.name}
            sharePath={`/strategies/${publication.slug}`}
          />
        </div>
      </section>
    </article>
  );
}
