"use client";

import Link from "next/link";
import { useState } from "react";
import { exportBotPackage } from "../lib/bot-package";
import type { BacktestReport, BotConfig, BotDefinition } from "../lib/types";
import { PerformanceChart } from "./PerformanceChart";

interface BotCardProps {
  bot: BotDefinition;
}

interface BotDownloadButtonProps {
  bot: BotDefinition;
  label?: string;
  className?: string;
}

const marketLabel = (market: BotDefinition["market"]) => market === "spot" ? "現貨" : "合約";

const botConfig = (bot: BotDefinition): BotConfig => ({
  id: bot.id,
  name: bot.name,
  exchange: bot.exchange,
  market: bot.market,
  symbol: bot.symbol,
  timeframe: bot.timeframe,
  logicMode: bot.logicMode,
  leverage: bot.leverage,
  blocks: bot.blocks,
  ...(bot.source === undefined ? {} : { source: bot.source }),
});

const botReport = (bot: BotDefinition): BacktestReport => ({
  seed: `official:${bot.id}`,
  generatedAt: "2026-07-10T00:00:00.000Z",
  metrics: bot.metrics,
  equityCurve: bot.equityCurve,
  disclaimer: bot.disclaimer,
});

export function BotDownloadButton({ bot, label = "快速下載", className = "button button--secondary button--small" }: BotDownloadButtonProps) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");

  const download = async () => {
    setStatus("working");
    let objectUrl: string | undefined;
    try {
      const blob = await exportBotPackage(botConfig(bot), botReport(bot));
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${bot.id}-weex-strategy.zip`;
      document.body.append(anchor);
      try {
        anchor.click();
        setStatus("idle");
      } finally {
        anchor.remove();
      }
    } catch {
      setStatus("error");
    } finally {
      const urlToRevoke = objectUrl;
      if (urlToRevoke !== undefined) {
        window.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 0);
      }
    }
  };

  return (
    <span className="download-control">
      <button className={className} disabled={status === "working"} onClick={download} type="button">
        {status === "working" ? "產生套件中…" : `${label} ${bot.name}`}
      </button>
      {status === "error" && <span className="download-control__error" role="status">下載失敗，請重試。</span>}
    </span>
  );
}

export function BotCard({ bot }: BotCardProps) {
  return (
    <article className="bot-card glass-panel" aria-labelledby={`bot-${bot.id}-title`}>
      <div className="bot-card__header">
        <div>
          <p className="eyebrow">{bot.exchange} / {bot.symbol}</p>
          <h3 id={`bot-${bot.id}-title`}>{bot.name}</h3>
        </div>
        <span className="risk-badge" data-risk={bot.risk}>{bot.risk}風險</span>
      </div>
      <p className="bot-card__description">{bot.description}</p>
      <div className="tag-row">
        <span className="market-badge">{marketLabel(bot.market)} · {bot.timeframe}</span>
        {bot.tags.map((tag) => <span className="strategy-tag" key={tag}>{tag}</span>)}
      </div>

      <PerformanceChart points={bot.equityCurve} label={`${bot.name} 迷你收益曲線`} tone={bot.risk === "高" ? "danger" : "cyan"} />

      <dl className="bot-card__metrics">
        <div><dt>累積收益</dt><dd>+{bot.metrics.totalReturn.toFixed(1)}%</dd></div>
        <div><dt>最大回撤</dt><dd>{bot.metrics.maxDrawdown.toFixed(1)}%</dd></div>
        <div><dt>勝率</dt><dd>{bot.metrics.winRate.toFixed(1)}%</dd></div>
      </dl>
      <p className="simulation-disclosure" role="note">{bot.disclaimer}</p>
      <div className="bot-card__actions">
        <Link className="button button--primary button--small" href={`/bots/${bot.id}`}>查看詳情 {bot.name}</Link>
        <Link className="button button--ghost button--small" href={`/workshop?bot=${bot.id}`}>複製到組裝車間 {bot.name}</Link>
        <BotDownloadButton bot={bot} />
      </div>
    </article>
  );
}
