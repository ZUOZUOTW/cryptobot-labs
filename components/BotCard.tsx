"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { buildBotPackageFiles, exportBotPackage, type BotPackageFile } from "../lib/bot-package";
import { downloadBlob } from "../lib/browser-download";
import { performanceAsReport } from "../lib/historical-evidence";
import type { BotConfig, BotDefinition, WeexHistoricalPerformance } from "../lib/types";
import { isVerifiedWeexPerformanceForStrategy } from "../lib/weex-historical-client";
import { DownloadConfirmationDialog } from "./DownloadConfirmationDialog";
import { PackageFallbackFiles } from "./PackageFallbackFiles";
import { PerformanceChart } from "./PerformanceChart";
import { useI18n } from "./I18nProvider";
import { StrategyLaunchButton } from "./StrategyLaunchButton";

interface BotCardProps {
  bot: BotDefinition;
  favorite?: boolean;
  onFavorite?: (botId: string) => void;
  historicalPerformance?: WeexHistoricalPerformance;
  performanceStatus?: "ready" | "loading" | "error";
}

const marketLabel = (market: BotDefinition["market"]) => market === "spot" ? "現貨" : "合約";

const downloadableConfig = (bot: BotDefinition): BotConfig => ({
  id: bot.id, name: bot.name, exchange: bot.exchange, market: bot.market, symbol: bot.symbol,
  timeframe: bot.timeframe, logicMode: bot.logicMode, tradeDirection: bot.tradeDirection,
  leverage: bot.leverage, blocks: bot.blocks, ...(bot.source === undefined ? {} : { source: bot.source }),
});

export function BotDownloadButton({ bot, historicalPerformance, className = "button button--secondary button--small" }: {
  bot: BotDefinition;
  historicalPerformance?: WeexHistoricalPerformance;
  className?: string;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [fallbackFiles, setFallbackFiles] = useState<BotPackageFile[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreAfterDownloadRef = useRef(false);
  const inFlightRef = useRef(false);
  const localizedName = t(bot.name);

  useEffect(() => {
    if (confirmationOpen || state === "working" || !restoreAfterDownloadRef.current) return;
    restoreAfterDownloadRef.current = false;
    triggerRef.current?.focus();
  }, [confirmationOpen, state]);

  const download = async () => {
    if (!historicalPerformance || inFlightRef.current) return;
    inFlightRef.current = true;
    restoreAfterDownloadRef.current = true;
    setConfirmationOpen(false);
    setState("working");
    setMessage("");
    setFallbackFiles([]);
    const config = downloadableConfig(bot);
    const report = performanceAsReport(historicalPerformance);
    try {
      downloadBlob(await exportBotPackage(config, report), `${bot.id}-weex-strategy.zip`);
      setState("idle");
      setMessage("策略套件已開始下載。");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "下載失敗，請重試。");
      try { setFallbackFiles(await buildBotPackageFiles(config, report)); }
      catch { setFallbackFiles([]); }
    } finally {
      inFlightRef.current = false;
    }
  };

  if (!isVerifiedWeexPerformanceForStrategy(historicalPerformance, bot)) return null;
  return <div className="download-control">
    <button
      aria-label={t(`下載策略：${bot.name}`)}
      className={className}
      disabled={state === "working"}
      onClick={() => { restoreAfterDownloadRef.current = false; setConfirmationOpen(true); }}
      ref={triggerRef}
      type="button"
    >{state === "working" ? "產生套件中…" : "下載策略包"}</button>
    {message && <span className="download-control__message" data-tone={state === "error" ? "danger" : "success"}
      role={state === "error" ? "alert" : "status"}>{message}</span>}
    {fallbackFiles.length > 0 && <PackageFallbackFiles files={fallbackFiles} />}
    {confirmationOpen && <DownloadConfirmationDialog
      description="策略包包含固定設定、JavaScript 原始碼與目前已驗證的 WEEX 歷史行情回測證據。"
      id={`quick-download-${bot.id}`}
      onCancel={() => setConfirmationOpen(false)}
      onConfirm={() => void download()}
      restoreFocusOnConfirm={false}
      title={`確認下載 ${localizedName}`}
      triggerRef={triggerRef}
    />}
  </div>;
}

export function BotCard({ bot, favorite = false, onFavorite, historicalPerformance, performanceStatus = "ready" }: BotCardProps) {
  const { locale, t } = useI18n();
  const localizedBotName = t(bot.name);
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
        <Image alt="" aria-hidden="true" className="bot-card__mascot" height={96} loading="lazy" src={mascot} width={112} />
        <div>
          <p className="eyebrow">{bot.symbol} / {bot.timeframe.toUpperCase()}</p>
          <h3 id={`bot-${bot.id}-title`}>{localizedBotName}</h3>
        </div>
        <div className="bot-card__badges">
          {onFavorite && (
            <button
              aria-label={`${t(favorite ? "取消收藏" : "收藏")} ${localizedBotName}`}
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
          <PerformanceChart points={performanceBot.equityCurve} label={t(`${bot.name} 收益曲線`)} tone={bot.risk === "高" ? "danger" : "cyan"} variant="smooth" />
          <dl className="bot-card__metrics">
            <div><dt>交易績效</dt><dd>{performanceBot.metrics.totalReturn >= 0 ? "+" : ""}{performanceBot.metrics.totalReturn.toFixed(1)}%</dd></div>
            <div><dt>最大回撤</dt><dd>{performanceBot.metrics.maxDrawdown.toFixed(1)}%</dd></div>
            <div><dt>勝率</dt><dd>{performanceBot.metrics.winRate.toFixed(1)}%</dd></div>
            <div><dt>交易次數</dt><dd>{performanceBot.metrics.trades.toLocaleString(locale)}</dd></div>
          </dl>
        </>
      ) : performanceStatus === "loading" ? (
        <div aria-hidden="true" className="bot-card__performance-state"><span /></div>
      ) : (
        <div className="bot-card__performance-state" role="alert">
          <strong>近期績效暫時無法取得</strong>
          <small>策略規則與套用功能仍可使用；重新取得經驗證行情前，不顯示替代數據。</small>
        </div>
      )}
      <div className="bot-card__actions">
        <Link aria-label={t(`查看策略：${bot.name}`)} className="button button--primary button--small" href={`/bots/${bot.id}`}>查看策略</Link>
        <Link aria-label={t(`直接套用：${bot.name}`)} className="button button--ghost button--small" href={`/workshop?bot=${bot.id}`}>直接套用</Link>
        {bot.market === "futures" && <StrategyLaunchButton bot={bot} className="button button--secondary button--small" />}
        <BotDownloadButton bot={bot} historicalPerformance={historicalPerformance} />
      </div>
      <p className="simulation-disclosure bot-card__disclosure" role="note">公開歷史行情回測，不代表未來績效</p>
    </article>
  );
}
