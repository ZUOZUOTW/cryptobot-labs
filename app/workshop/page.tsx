"use client";

import { useEffect, useMemo, useState } from "react";
import { BacktestPanel } from "../../components/workshop/BacktestPanel";
import { JavaScriptEditor, WEEX_JAVASCRIPT_TEMPLATE } from "../../components/workshop/JavaScriptEditor";
import { ParameterPanel } from "../../components/workshop/ParameterPanel";
import { PackagePanel } from "../../components/workshop/PackagePanel";
import { StrategyPalette } from "../../components/workshop/StrategyPalette";
import { StrategySummary } from "../../components/workshop/StrategySummary";
import { BOT_CATALOG } from "../../data/bots";
import { STRATEGY_PRESETS } from "../../data/strategies";
import { backtestConfigFingerprint } from "../../lib/backtest";
import { loadDraft, saveDraft } from "../../lib/storage";
import type { BacktestReport, BotConfig, BotDefinition, StrategyBlock } from "../../lib/types";
import { validateConfig } from "../../lib/strategy-validation";

const cloneBlock = (block: StrategyBlock): StrategyBlock => ({
  ...block,
  parameters: block.parameters.map((parameter) => ({ ...parameter })),
});

const cloneConfig = (config: BotConfig): BotConfig => ({
  ...config,
  blocks: config.blocks.map(cloneBlock),
});

const configFromBot = (bot: BotDefinition): BotConfig => ({
  id: bot.id,
  name: bot.name,
  exchange: bot.exchange,
  market: bot.market,
  symbol: bot.symbol,
  timeframe: bot.timeframe,
  logicMode: bot.logicMode,
  leverage: bot.leverage,
  blocks: bot.blocks.map(cloneBlock),
  ...(bot.source === undefined ? {} : { source: bot.source }),
});

const DEFAULT_CONFIG = cloneConfig(STRATEGY_PRESETS[0]);
const blankConfig = (): BotConfig => ({
  ...cloneConfig(DEFAULT_CONFIG),
  id: "untitled-strategy",
  name: "未命名策略",
  blocks: [],
});
type WorkshopMode = "visual" | "javascript";

interface AssociatedReport {
  fingerprint: string;
  report: BacktestReport;
}

export default function WorkshopPage() {
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [draftError, setDraftError] = useState("");
  const [mode, setMode] = useState<WorkshopMode>("visual");
  const [associatedReport, setAssociatedReport] = useState<AssociatedReport | null>(null);
  const [mobileMessage, setMobileMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const search = new URLSearchParams(window.location.search);
      const draft = loadDraft();
      const requestedBot = BOT_CATALOG.find((bot) => bot.id === search.get("bot"));
      const deliberateNew = search.get("new") === "1";
      const next = deliberateNew ? blankConfig() : requestedBot ? configFromBot(requestedBot) : draft ? cloneConfig(draft) : cloneConfig(DEFAULT_CONFIG);
      const requestedJavaScript = search.get("mode") === "javascript";
      if (requestedJavaScript && next.source === undefined) next.source = WEEX_JAVASCRIPT_TEMPLATE;
      setMode(requestedJavaScript || next.source !== undefined ? "javascript" : "visual");
      setConfig(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const validation = useMemo(() => validateConfig(config), [config]);
  const configFingerprint = useMemo(() => backtestConfigFingerprint(config), [config]);
  const currentReport = associatedReport?.fingerprint === configFingerprint ? associatedReport.report : null;

  const updateConfig = (createNext: (current: BotConfig) => BotConfig) => {
    const next = createNext(config);
    const saved = saveDraft(next);
    setDraftError(saved.ok ? "" : saved.reason);
    setConfig(next);
  };

  const selectPreset = (preset: BotConfig) => updateConfig(() => cloneConfig(preset));
  const addBlock = (block: StrategyBlock) => updateConfig((current) => (
    current.blocks.some((selected) => selected.id === block.id)
      ? current
      : { ...current, blocks: [...current.blocks, cloneBlock(block)] }
  ));
  const removeBlock = (index: number) => updateConfig((current) => ({
    ...current,
    blocks: current.blocks.filter((_, blockIndex) => blockIndex !== index),
  }));
  const moveBlock = (index: number, direction: -1 | 1) => updateConfig((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.blocks.length) return current;
    const blocks = [...current.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    return { ...current, blocks };
  });
  const updateParameter = (blockIndex: number, parameterKey: string, value: number) => updateConfig((current) => ({
    ...current,
    blocks: current.blocks.map((block, index) => index === blockIndex ? {
      ...block,
      parameters: block.parameters.map((parameter) => (
        parameter.key === parameterKey ? { ...parameter, value } : parameter
      )),
    } : block),
  }));
  const updateField = <Key extends keyof Pick<BotConfig, "market" | "symbol" | "timeframe" | "logicMode" | "leverage">>(
    key: Key,
    value: BotConfig[Key],
  ) => updateConfig((current) => {
    if (key === "market" && value === "spot") return { ...current, market: "spot", leverage: 1 };
    return { ...current, [key]: value };
  });

  const selectMode = (nextMode: WorkshopMode) => {
    setMode(nextMode);
    if (nextMode === "visual") {
      updateConfig((current) => {
        const visualConfig = { ...current };
        delete visualConfig.source;
        return visualConfig;
      });
      return;
    }
    if (nextMode === "javascript" && config.source === undefined) {
      updateConfig((current) => ({ ...current, source: WEEX_JAVASCRIPT_TEMPLATE }));
    }
  };

  const updateSource = (source: string) => updateConfig((current) => ({ ...current, source }));
  const acceptReport = (report: BacktestReport) => {
    setAssociatedReport({ fingerprint: configFingerprint, report });
    setMobileMessage("回測完成，可下載策略套件");
  };
  const acceptImport = (importedConfig: BotConfig, report: BacktestReport) => {
    const next = cloneConfig(importedConfig);
    const saved = saveDraft(next);
    setDraftError(saved.ok ? "" : "無法儲存匯入策略草稿，請立即下載策略套件備份。記憶體中的匯入內容仍可立即匯出。");
    setConfig(next);
    setMode(next.source === undefined ? "visual" : "javascript");
    setAssociatedReport({ fingerprint: backtestConfigFingerprint(next), report });
    return { ok: true } as const;
  };

  const resetToBlank = () => {
    const next = blankConfig();
    const saved = saveDraft(next);
    setDraftError(saved.ok ? "" : saved.reason);
    setConfig(next);
    setMode("visual");
    setAssociatedReport(null);
    setMobileMessage("已建立空白策略，請加入進場與出場或風控規則。");
  };

  return (
    <div className="workshop-page site-container">
      <header className="page-intro workshop-page__intro">
        <p className="eyebrow">ORBITAL LAB / QUICK ASSEMBLY</p>
        <h1>多策略組裝車間</h1>
        <p>從訊號、確認、出場、倉位與風控模組快速組合一套 WEEX 策略，再用可重現的模擬資料驗證想法。</p>
        <p className="simulation-disclosure" role="note">模擬回測資料，不代表未來績效</p>
      </header>

      {draftError && <p className="draft-status" role="status">{draftError}</p>}

      <div className="workshop-mode" aria-label="編輯模式" role="group">
        <button aria-pressed={mode === "visual"} onClick={() => selectMode("visual")} type="button">視覺化模式</button>
        <button aria-pressed={mode === "javascript"} onClick={() => selectMode("javascript")} type="button">JavaScript 模式</button>
        <button onClick={resetToBlank} type="button">建立空白策略</button>
      </div>

      <div className="workshop-grid">
        {mode === "visual" ? (
          <StrategyPalette
            onAdd={addBlock}
            onMove={moveBlock}
            onPreset={selectPreset}
            onRemove={removeBlock}
            selected={config.blocks}
          />
        ) : (
          <JavaScriptEditor source={config.source ?? WEEX_JAVASCRIPT_TEMPLATE} onChange={updateSource} />
        )}
        <ParameterPanel config={config} onConfigField={updateField} onParameter={updateParameter} />
        <div className="workshop-grid__results">
          <StrategySummary config={config} validation={validation} />
          <BacktestPanel
            config={config}
            onReport={acceptReport}
            onRun={() => setMobileMessage("正在驗證並執行模擬回測…")}
            restoredReport={currentReport}
            validation={validation}
          />
        </div>
        <PackagePanel config={config} onImport={acceptImport} report={currentReport} />
      </div>

      <section className="workshop-mobile-actions" aria-label="手機版組裝操作">
        <p aria-live="polite">{mobileMessage || (validation.valid ? currentReport ? "回測完成，可下載策略套件" : "設定可回測" : `尚有 ${validation.errors.length} 項設定問題`)}</p>
        <div>
          <button aria-label="行動列：檢查設定" onClick={() => setMobileMessage(validation.valid ? "設定檢查通過，可以執行模擬回測。" : validation.errors.join("；"))} type="button">檢查</button>
          <button aria-label="行動列：執行回測" disabled={!validation.valid} onClick={() => document.querySelector<HTMLButtonElement>(".backtest-run")?.click()} type="button">回測</button>
          <button aria-label="行動列：下載套件" disabled={!currentReport} onClick={() => document.querySelector<HTMLButtonElement>('[data-package-export-trigger="true"]')?.click()} type="button">下載</button>
        </div>
      </section>
    </div>
  );
}
