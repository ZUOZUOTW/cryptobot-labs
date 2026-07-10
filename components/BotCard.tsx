"use client";

import Link from "next/link";
import { useState } from "react";
import { runBacktest } from "../lib/backtest";
import { buildBotPackageFiles, exportBotPackage, type BotPackageFile } from "../lib/bot-package";
import { downloadBlob } from "../lib/browser-download";
import type { BotConfig, BotDefinition } from "../lib/types";
import { PackageFallbackFiles } from "./PackageFallbackFiles";
import { PerformanceChart } from "./PerformanceChart";

interface BotCardProps {
  bot: BotDefinition;
  favorite?: boolean;
  onFavorite?: (botId: string) => void;
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

export function BotDownloadButton({ bot, label = "快速下載", className = "button button--secondary button--small" }: BotDownloadButtonProps) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [fallbackFiles, setFallbackFiles] = useState<BotPackageFile[]>([]);

  const download = async () => {
    setConfirmationOpen(false);
    setStatus("working");
    setMessage("");
    setFallbackFiles([]);
    const config = botConfig(bot);
    const report = runBacktest(config);
    try {
      const blob = await exportBotPackage(config, report);
      downloadBlob(blob, `${bot.id}-weex-strategy.zip`);
      setStatus("idle");
      setMessage("策略套件已開始下載。");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "下載失敗，請重試。");
      try {
        setFallbackFiles(await buildBotPackageFiles(config, report));
      } catch {
        setFallbackFiles([]);
      }
    }
  };

  return (
    <span className="download-control">
      <button className={className} disabled={status === "working"} onClick={() => setConfirmationOpen(true)} type="button">
        {status === "working" ? "產生套件中…" : `${label} ${bot.name}`}
      </button>
      {message && <span className="download-control__error" role="status">{message}</span>}
      {fallbackFiles.length > 0 && <PackageFallbackFiles files={fallbackFiles} />}
      {confirmationOpen && (
        <div aria-labelledby={`quick-download-${bot.id}`} aria-modal="true" className="package-confirmation" role="dialog">
          <div className="package-confirmation__card glass-panel">
            <p className="eyebrow">SIMULATION PACKAGE</p>
            <h3 id={`quick-download-${bot.id}`}>確認下載 {bot.name}</h3>
            <p>此套件只包含模擬策略與回測資料，無法獨立交易，也不會代表未來績效。</p>
            <div className="button-row">
              <button className="button button--ghost" onClick={() => setConfirmationOpen(false)} type="button">取消</button>
              <button className="button button--primary" onClick={download} type="button">確認下載</button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

export function BotCard({ bot, favorite = false, onFavorite }: BotCardProps) {
  return (
    <article className="bot-card glass-panel" aria-labelledby={`bot-${bot.id}-title`}>
      <div className="bot-card__header">
        <div>
          <p className="eyebrow">{bot.exchange} / {bot.symbol}</p>
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
          <span className="risk-badge" data-risk={bot.risk}>{bot.risk}風險</span>
        </div>
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
