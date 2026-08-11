import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BotDetailPerformance } from "../../../components/BotDetailPerformance";
import { StrategyLaunchButton } from "../../../components/StrategyLaunchButton";
import { StrategyShareActions } from "../../../components/StrategyShareActions";
import { BOT_CATALOG } from "../../../data/bots";
import type { BotDefinition, StrategyGroup } from "../../../lib/types";
import { resolveRequestLocale } from "../../../lib/i18n/locales";
import { translateMessage } from "../../../lib/i18n/messages";

interface BotDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Pick<BotDetailPageProps, "params">): Promise<Metadata> {
  const [{ id }, requestHeaders] = await Promise.all([params, headers()]);
  const bot = BOT_CATALOG.find((candidate) => candidate.id === id);
  if (!bot) return {};
  const locale = resolveRequestLocale(requestHeaders.get("cookie"), requestHeaders.get("accept-language"));
  const title = translateMessage(locale, `${bot.name}｜公開自動交易策略`);
  const description = translateMessage(locale, `${bot.description}。${bot.market === "spot" ? "現貨" : "合約"} ${bot.timeframe}，${bot.risk}風險；查看模擬績效、最大回撤與策略規則。`);
  const imageAlt = translateMessage(locale, `${bot.name} 公開策略預覽`);
  const image = `/bots/${bot.id}/opengraph-image`;
  return { title, description, alternates: { canonical: `/bots/${bot.id}` }, openGraph: { title, description, type: "article", url: `/bots/${bot.id}`, images: [{ url: image, width: 1200, height: 630, alt: imageAlt }] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
}

export function generateStaticParams() {
  return BOT_CATALOG.map((bot) => ({ id: bot.id }));
}

const marketLabel = (bot: BotDefinition) => bot.market === "spot" ? "現貨" : "USDT-M 合約";
const groupLabel: Record<StrategyGroup, string> = { entry: "進場", confirm: "確認", exit: "離場", position: "倉位", risk: "風控" };
const parameterSummary = (bot: BotDefinition["blocks"][number]) => bot.parameters
  .map((parameter) => `${parameter.label} ${parameter.value}${parameter.suffix ?? ""}`)
  .join(" · ");

export default async function BotDetailPage({ params }: BotDetailPageProps) {
  const { id } = await params;
  const bot = BOT_CATALOG.find((candidate) => candidate.id === id);

  if (!bot) notFound();
  const workshopHref = `/workshop?bot=${encodeURIComponent(bot.id)}&version=1`;
  const mascot = bot.risk === "高" ? "/mascots/ai-guardian.webp" : bot.market === "spot" ? "/mascots/ai-observer.webp" : "/mascots/ai-builder.webp";
  const shareDetails = {
    marketKind: bot.market,
    riskLevel: bot.risk,
    timeframe: bot.timeframe,
  };

  return (
    <article className="bot-detail-page">
      <header className="bot-detail-hero site-container">
        <Link className="back-link" href="/bots"><span aria-hidden="true">←</span> 機器人市場</Link>
        <div className="bot-detail-hero__content">
          <div className="bot-detail-hero__copy">
            <div className="tag-row">
              <span className="market-badge">{marketLabel(bot)} · {bot.timeframe}</span>
              <span className="risk-badge" data-risk={bot.risk}>{bot.risk}風險</span>
            </div>
            <p className="eyebrow">PUBLIC STRATEGY / {bot.id.toUpperCase()} / V1</p>
            <h1>{bot.name}</h1>
            <p className="bot-detail-hero__lead">{bot.description}</p>
            <div className="tag-row">{bot.tags.map((tag) => <span className="strategy-tag" key={tag}>{tag}</span>)}</div>
            <div className="bot-detail-hero__actions">
              <StrategyLaunchButton bot={bot} />
              <Link className="button button--primary" href={workshopHref}>直接套用</Link>
              <StrategyShareActions botId={bot.id} botName={bot.name} {...shareDetails} />
            </div>
          </div>
          <aside className="bot-detail-snapshot glass-panel" aria-label="策略摘要">
            <Image alt="" aria-hidden="true" height="180" src={mascot} width="200" />
            <p className="eyebrow">STRATEGY SNAPSHOT</p>
            <dl>
              <div><dt>市場</dt><dd>{marketLabel(bot)}</dd></div>
              <div><dt>週期</dt><dd>{bot.timeframe.toUpperCase()}</dd></div>
              <div><dt>槓桿</dt><dd>{bot.leverage}×</dd></div>
              <div><dt>條件</dt><dd>{bot.logicMode === "all" ? "全部成立" : "任一成立"}</dd></div>
              <div><dt>模組</dt><dd>{bot.blocks.length} 個</dd></div>
              <div><dt>風險</dt><dd>{bot.risk}</dd></div>
            </dl>
          </aside>
        </div>
        <div className="strategy-publisher"><span>發布者</span><strong>CryptoBot Labs 研究團隊</strong><span>公開版本 v1 · 允許複製 · Email 不公開</span></div>
        <p className="simulation-disclosure" role="note">{bot.disclaimer}</p>
      </header>

      <BotDetailPerformance bot={bot} />

      <section className="detail-section site-container bot-detail-structure" aria-labelledby="strategy-structure-title">
        <div className="section-heading"><p className="eyebrow">STRATEGY FLOW</p><h2 id="strategy-structure-title">策略結構一目了然</h2><p>依實際執行順序列出所有模組與目前參數，套用後仍可逐項調整。</p></div>
        <ol className="bot-detail-flow">
          {bot.blocks.map((block, index) => (
            <li className="bot-detail-flow__item glass-panel" key={`${block.id}-${index}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><small>{groupLabel[block.group]}</small><h3>{block.name}</h3><p>{block.description}</p></div>
              <strong>{parameterSummary(block) || "無額外參數"}</strong>
            </li>
          ))}
        </ol>
        <div className="bot-detail-capability glass-panel">
          <div><p className="eyebrow">TRADE CAPABILITY</p><h2>{bot.market === "spot" ? "現貨多頭流程" : "合約雙向流程"}</h2></div>
          <p>{bot.market === "spot" ? "只模擬買入與退出，不建立空頭部位。" : "依相同的公開規則評估多空方向，不以推估比例呈現不存在的訊號分布。"}</p>
        </div>
      </section>

      <section className="detail-section site-container strategy-guidance">
        <article className="guidance-card glass-panel"><span>01</span><h2>策略原理</h2><p>{bot.explanation}</p></article>
        <article className="guidance-card glass-panel"><span>02</span><h2>適用市場</h2><p>{bot.suitableFor}</p></article>
        <article className="guidance-card guidance-card--risk glass-panel"><span>03</span><h2>風險說明</h2><p>{bot.riskNote}</p></article>
      </section>

      <section className="detail-section detail-cta site-container glass-panel">
        <div><p className="eyebrow">COPY THIS VERSION</p><h2>以這個固定版本開始組裝。</h2><p>套用後可調整參數、快速回測並開始模擬運行；原分享版本不會因後續修改而改變。</p></div>
        <div className="button-row"><StrategyLaunchButton bot={bot} /><Link className="button button--primary" href={workshopHref}>直接套用</Link><StrategyShareActions botId={bot.id} botName={bot.name} {...shareDetails} /></div>
      </section>
    </article>
  );
}
