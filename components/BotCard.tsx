"use client";

import Link from "next/link";
import type { BotDefinition, WeexHistoricalPerformance } from "../lib/types";
import { PerformanceChart } from "./PerformanceChart";
import { useI18n } from "./I18nProvider";

interface BotCardProps {
  bot: BotDefinition;
  favorite?: boolean;
  onFavorite?: (botId: string) => void;
  historicalPerformance?: WeexHistoricalPerformance;
  performanceStatus?: "ready" | "loading" | "error";
}

const marketLabel = (market: BotDefinition["market"]) => market === "spot" ? "現貨" : "合約";

export function BotCard({ bot, favorite = false, onFavorite, historicalPerformance, performanceStatus = "ready" }: BotCardProps) {
  const { locale } = useI18n();
  const mascot = bot.risk === "高" ? "/mascots/ai-guardian.webp" : bot.market === "spot" ? "/mascots/ai-observer.webp" : "/mascots/ai-builder.webp";
  const performanceBot = historicalPerformance ? {
    ...bot,
    metrics: historicalPerformance.metrics,
    equityCurve: historicalPerformance.equityCurve,
    disclaimer: historicalPerformance.disclaimer,
  } : bot;
  return (
    <article className="bot-card glass-panel" aria-labelledby={`bot-${bot.id}-title`} data-market={bot.market}>
      <div className="bot-card__header">
        <img alt="" aria-hidden="true" className="bot-card__mascot" decoding="async" height="96" loading="lazy" src={mascot} width="112" />
        <div>
          <p className="eyebrow">{bot.symbol} / {bot.timeframe.toUpperCase()}</p>
          <h3 id={`bot-${bot.id}-title`}>{bot.name}</h3>
        </div>
        <div className="bot-card__badges">
          {onFavorite && (
            <button
              aria-label={`${favorite ? "取消收藏" : "收藏"} ${bot.name}`}
              aria-pressed={favorite}
              className="favorite-button"
              onClick={() => onFavorite(bot.id)}
              type="button"
            >
              <span aria-hidden="true">{favorite ? "★" : "☆"}</span>
            </button>
          )}
          <div className="bot-card__badge-stack">
            <span className="risk-badge" data-risk={bot.risk}>{bot.risk}風險</span>
            <span className="novice-badge">{bot.risk === "低" ? "新手友善" : bot.risk === "中" ? "需先模擬" : "進階策略"}</span>
          </div>
        </div>
      </div>
      <p className="bot-card__description">{bot.description}</p>
      <div className="tag-row">
        <span className="market-badge" data-market={bot.market}>{marketLabel(bot.market)} · {bot.timeframe}</span>
        {bot.tags.map((tag) => <span className="strategy-tag" key={tag}>{tag}</span>)}
      </div>

      {performanceStatus === "ready" ? (
        <>
          <PerformanceChart points={performanceBot.equityCurve} label={`${bot.name} 收益曲線`} tone={bot.risk === "高" ? "danger" : "cyan"} variant="smooth" />
          <dl className="bot-card__metrics">
            <div><dt>交易績效</dt><dd>{performanceBot.metrics.totalReturn >= 0 ? "+" : ""}{performanceBot.metrics.totalReturn.toFixed(1)}%</dd></div>
            <div><dt>最大回撤</dt><dd>{performanceBot.metrics.maxDrawdown.toFixed(1)}%</dd></div>
            <div><dt>勝率</dt><dd>{performanceBot.metrics.winRate.toFixed(1)}%</dd></div>
            <div><dt>交易次數</dt><dd>{performanceBot.metrics.trades.toLocaleString(locale)}</dd></div>
          </dl>
        </>
      ) : (
        <div aria-hidden="true" className="bot-card__performance-state"><span /></div>
      )}
      <div className="bot-card__actions">
        <Link aria-label={`查看策略：${bot.name}`} className="button button--primary button--small" href={`/bots/${bot.id}`}>查看策略</Link>
        <Link aria-label={`直接套用：${bot.name}`} className="button button--ghost button--small" href={`/workshop?bot=${bot.id}`}>直接套用</Link>
      </div>
      <p className="simulation-disclosure bot-card__disclosure" role="note">公開歷史行情回測，不代表未來績效</p>
    </article>
  );
}
