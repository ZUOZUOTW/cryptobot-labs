"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { runBacktest } from "../lib/backtest";
import { buildBotPackageFiles, exportBotPackage, type BotPackageFile } from "../lib/bot-package";
import { downloadBlob } from "../lib/browser-download";
import type { BacktestReport, BotConfig, BotDefinition, WeexHistoricalPerformance } from "../lib/types";
import { DownloadConfirmationDialog } from "./DownloadConfirmationDialog";
import { PackageFallbackFiles } from "./PackageFallbackFiles";
import { PerformanceChart } from "./PerformanceChart";

interface BotCardProps {
  bot: BotDefinition;
  favorite?: boolean;
  onFavorite?: (botId: string) => void;
  historicalPerformance?: WeexHistoricalPerformance;
  performanceStatus?: "ready" | "loading" | "error";
}

interface BotDownloadButtonProps {
  bot: BotDefinition;
  historicalPerformance?: WeexHistoricalPerformance;
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

export function BotDownloadButton({ bot, historicalPerformance, label = "快速下載", className = "button button--secondary button--small" }: BotDownloadButtonProps) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [fallbackFiles, setFallbackFiles] = useState<BotPackageFile[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreAfterDownloadRef = useRef(false);

  useEffect(() => {
    if (confirmationOpen || status === "working" || !restoreAfterDownloadRef.current) return;
    restoreAfterDownloadRef.current = false;
    triggerRef.current?.focus();
  }, [confirmationOpen, status]);

  const download = async () => {
    restoreAfterDownloadRef.current = true;
    setConfirmationOpen(false);
    setStatus("working");
    setMessage("");
    setFallbackFiles([]);
    const config = botConfig(bot);
    const report: BacktestReport = historicalPerformance ? {
      seed: historicalPerformance.evidence.datasetDigest.slice(0, 8),
      generatedAt: historicalPerformance.generatedAt,
      metrics: historicalPerformance.metrics,
      equityCurve: historicalPerformance.equityCurve,
      disclaimer: historicalPerformance.disclaimer,
      evidence: historicalPerformance.evidence,
    } : runBacktest(config);
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
    <div className="download-control">
      <button className={className} disabled={status === "working"} onClick={() => { restoreAfterDownloadRef.current = false; setConfirmationOpen(true); }} ref={triggerRef} type="button">
        {status === "working" ? "產生套件中…" : `${label} ${bot.name}`}
      </button>
      {message && <span className="download-control__message" data-tone={status === "error" ? "danger" : "success"} role={status === "error" ? "alert" : "status"}>{message}</span>}
      {fallbackFiles.length > 0 && <PackageFallbackFiles files={fallbackFiles} />}
      {confirmationOpen && (
        <DownloadConfirmationDialog
          description="此套件只包含模擬策略與回測資料，無法獨立交易，也不會代表未來績效。"
          id={`quick-download-${bot.id}`}
          onCancel={() => setConfirmationOpen(false)}
          onConfirm={download}
          restoreFocusOnConfirm={false}
          title={`確認下載 ${bot.name}`}
          triggerRef={triggerRef}
        />
      )}
    </div>
  );
}

export function BotCard({ bot, favorite = false, onFavorite, historicalPerformance, performanceStatus = "ready" }: BotCardProps) {
  const mascot = bot.risk === "高" ? "/mascots/ai-guardian.png" : bot.market === "spot" ? "/mascots/ai-observer.png" : "/mascots/ai-builder.png";
  const performanceBot = historicalPerformance ? {
    ...bot,
    metrics: historicalPerformance.metrics,
    equityCurve: historicalPerformance.equityCurve,
    disclaimer: historicalPerformance.disclaimer,
  } : bot;
  return (
    <article className="bot-card glass-panel" aria-labelledby={`bot-${bot.id}-title`} data-market={bot.market}>
      <div className="bot-card__header">
        <img alt="" aria-hidden="true" className="bot-card__mascot" height="96" src={mascot} width="112" />
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
          <span className="novice-badge">{bot.risk === "低" ? "新手友善" : bot.risk === "中" ? "需先模擬" : "進階策略"}</span>
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
            <div><dt>累積收益</dt><dd>{performanceBot.metrics.totalReturn >= 0 ? "+" : ""}{performanceBot.metrics.totalReturn.toFixed(1)}%</dd></div>
            <div><dt>最大回撤</dt><dd>{performanceBot.metrics.maxDrawdown.toFixed(1)}%</dd></div>
            <div><dt>勝率</dt><dd>{performanceBot.metrics.winRate.toFixed(1)}%</dd></div>
            <div><dt>交易次數</dt><dd>{performanceBot.metrics.trades.toLocaleString("zh-TW")}</dd></div>
          </dl>
        </>
      ) : (
        <div aria-hidden="true" className="bot-card__performance-state"><span /></div>
      )}
      <div className="bot-card__actions">
        <Link className="button button--primary button--small" href={`/bots/${bot.id}`}>查看策略 {bot.name}</Link>
        <Link className="button button--ghost button--small" href={`/workshop?bot=${bot.id}`}>直接套用 {bot.name}</Link>
        <details className="legacy-package"><summary>策略檔案</summary><BotDownloadButton bot={bot} historicalPerformance={historicalPerformance} /></details>
      </div>
      <p className="simulation-disclosure bot-card__disclosure" role="note">{performanceBot.disclaimer}</p>
    </article>
  );
}
