"use client";

import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { BacktestPanel } from "../../components/workshop/BacktestPanel";
import { createWeexJavaScriptTemplate, JavaScriptEditor } from "../../components/workshop/JavaScriptEditor";
import { ParameterPanel } from "../../components/workshop/ParameterPanel";
import { PackagePanel } from "../../components/workshop/PackagePanel";
import { StrategyPalette } from "../../components/workshop/StrategyPalette";
import { StrategySummary, type SignalFlowCheckState } from "../../components/workshop/StrategySummary";
import { BOT_CATALOG } from "../../data/bots";
import { STRATEGY_PRESETS } from "../../data/strategies";
import { backtestConfigFingerprint } from "../../lib/backtest";
import { loadDraft, saveDraft } from "../../lib/storage";
import type { BacktestReport, BotConfig, BotDefinition, StrategyBlock } from "../../lib/types";
import { validateConfig } from "../../lib/strategy-validation";
import { captureAttribution } from "../../lib/attribution";
import { resolvedTradeDirection } from "../../lib/trade-direction";

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
  tradeDirection: resolvedTradeDirection(bot),
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
const draftSaveWarning = (reason: string): string => (
  `${reason}；目前內容仍保留在本頁，可調整後再次儲存。`
);

const configFromPublication = (value: unknown): BotConfig | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.slug !== "string" || typeof record.name !== "string"
    || (record.market !== "spot" && record.market !== "futures")
    || typeof record.symbol !== "string" || typeof record.timeframe !== "string"
    || (record.logicMode !== "all" && record.logicMode !== "any")
    || (record.tradeDirection !== "long" && record.tradeDirection !== "short" && record.tradeDirection !== "both")
    || typeof record.leverage !== "number" || !Array.isArray(record.blocks)) return null;
  const candidate = {
    id: `published-${record.slug}`,
    name: record.name,
    exchange: "WEEX",
    market: record.market,
    symbol: record.symbol,
    timeframe: record.timeframe,
    logicMode: record.logicMode,
    tradeDirection: record.tradeDirection,
    leverage: record.leverage,
    blocks: record.blocks,
  } as BotConfig;
  return validateConfig(candidate).valid ? cloneConfig(candidate) : null;
};
type WorkshopMode = "visual" | "javascript";
type MobileWorkshopStep = "build" | "parameters" | "test" | "publish";
const MOBILE_SWIPE_THRESHOLD = 56;

const MOBILE_WORKSHOP_STEPS = [
  { id: "build", number: "01", label: "組裝" },
  { id: "parameters", number: "02", label: "參數" },
  { id: "test", number: "03", label: "驗證" },
  { id: "publish", number: "04", label: "保存／發布" },
] as const satisfies ReadonlyArray<{ id: MobileWorkshopStep; number: string; label: string }>;

interface AssociatedReport {
  fingerprint: string;
  report: BacktestReport;
}

interface AssociatedFlowCheck {
  fingerprint: string;
  state: Exclude<SignalFlowCheckState, "untested">;
}

export default function WorkshopPage() {
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [draftError, setDraftError] = useState("");
  const [mode, setMode] = useState<WorkshopMode>("visual");
  const [associatedReport, setAssociatedReport] = useState<AssociatedReport | null>(null);
  const [associatedFlowCheck, setAssociatedFlowCheck] = useState<AssociatedFlowCheck | null>(null);
  const [mobileMessage, setMobileMessage] = useState("");
  const [mobileStep, setMobileStep] = useState<MobileWorkshopStep>("build");
  const mobileSwipeStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        const search = new URLSearchParams(window.location.search);
        captureAttribution(search.get("via"));
        const deliberateNew = search.get("new") === "1";
        const publicationSlug = deliberateNew ? null : search.get("publication");
        if (publicationSlug) {
          try {
            const response = await fetch(`/api/strategy-publications/${encodeURIComponent(publicationSlug)}`, {
              cache: "no-store",
              headers: { Accept: "application/json" },
            });
            const body = await response.json().catch(() => null) as { publication?: unknown } | null;
            const published = response.ok ? configFromPublication(body?.publication) : null;
            if (!published) throw new Error("invalid_publication");
            const hasPrivateSource = Boolean(
              body?.publication
              && typeof body.publication === "object"
              && !Array.isArray(body.publication)
              && (body.publication as { hasPrivateSource?: unknown }).hasPrivateSource === true,
            );
            if (!active) return;
            const saved = saveDraft(published);
            setDraftError(saved.ok ? "" : draftSaveWarning(saved.reason));
            setMode("visual");
            setConfig(published);
            setAssociatedReport(null);
            setAssociatedFlowCheck(null);
            setMobileMessage(hasPrivateSource
              ? `已載入「${published.name}」的公開積木副本；發布者的自訂程式碼未公開，請檢查規則並重新回測。`
              : `已載入「${published.name}」的公開可編輯副本；請重新回測後再保存或發布。`);
            return;
          } catch {
            if (active) setDraftError("無法載入這個公開策略；已保留目前可用的本機草稿。");
          }
        }
        if (!active) return;
        const draft = loadDraft();
        const requestedBot = BOT_CATALOG.find((bot) => bot.id === search.get("bot"));
        const next = deliberateNew
          ? blankConfig()
          : requestedBot
            ? configFromBot(requestedBot)
            : draft
              ? cloneConfig(draft)
              : cloneConfig(DEFAULT_CONFIG);
        const requestedJavaScript = search.get("mode") === "javascript";
        if (requestedJavaScript && next.source === undefined) next.source = createWeexJavaScriptTemplate(next);
        setMode(requestedJavaScript || next.source !== undefined ? "javascript" : "visual");
        setConfig(next);
      })();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const validation = useMemo(() => validateConfig(config), [config]);
  const configFingerprint = useMemo(() => backtestConfigFingerprint(config), [config]);
  const currentReport = associatedReport?.fingerprint === configFingerprint ? associatedReport.report : null;
  const currentFlowCheck: SignalFlowCheckState = associatedFlowCheck?.fingerprint === configFingerprint
    ? associatedFlowCheck.state
    : "untested";
  const mobileStepIndex = MOBILE_WORKSHOP_STEPS.findIndex((step) => step.id === mobileStep);

  const updateConfig = (createNext: (current: BotConfig) => BotConfig) => {
    const next = createNext(config);
    const saved = saveDraft(next);
    setDraftError(saved.ok ? "" : draftSaveWarning(saved.reason));
    setConfig(next);
  };

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
  const updateField = <Key extends keyof Pick<BotConfig, "name" | "market" | "symbol" | "timeframe" | "logicMode" | "tradeDirection" | "leverage">>(
    key: Key,
    value: BotConfig[Key],
  ) => updateConfig((current) => {
    if (key === "market" && value === "spot") {
      return { ...current, market: "spot", tradeDirection: "long", leverage: 1 };
    }
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
      updateConfig((current) => ({ ...current, source: createWeexJavaScriptTemplate(current) }));
    }
  };

  const updateSource = (source: string) => updateConfig((current) => ({ ...current, source }));
  const acceptReport = (report: BacktestReport) => {
    setAssociatedReport({ fingerprint: configFingerprint, report });
    setMobileMessage("回測完成，可保存或發布策略");
  };
  const acceptImport = (importedConfig: BotConfig, report: BacktestReport) => {
    const next = cloneConfig(importedConfig);
    const saved = saveDraft(next);
    setDraftError(saved.ok ? "" : draftSaveWarning("無法儲存匯入策略草稿"));
    setConfig(next);
    setMode(next.source === undefined ? "visual" : "javascript");
    setAssociatedReport({ fingerprint: backtestConfigFingerprint(next), report });
    return { ok: true } as const;
  };

  const resetToBlank = () => {
    const next = blankConfig();
    const saved = saveDraft(next);
    setDraftError(saved.ok ? "" : draftSaveWarning(saved.reason));
    setConfig(next);
    setMode("visual");
    setAssociatedReport(null);
    setMobileStep("build");
    setMobileMessage("已清空選取，請重新加入進場與出場或風控規則。");
  };

  const moveToMobileStep = (nextIndex: number) => {
    const next = MOBILE_WORKSHOP_STEPS[nextIndex];
    if (!next) return;
    setMobileStep(next.id);
    setMobileMessage(`目前步驟：${next.label}`);
  };

  const beginMobileSwipe = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || window.innerWidth > 704) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, a, input, select, textarea, [contenteditable='true'], [role='slider']")) {
      mobileSwipeStart.current = null;
      return;
    }
    const touch = event.touches[0];
    mobileSwipeStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const finishMobileSwipe = (event: TouchEvent<HTMLDivElement>) => {
    const start = mobileSwipeStart.current;
    mobileSwipeStart.current = null;
    if (!start || event.changedTouches.length !== 1 || window.innerWidth > 704) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < MOBILE_SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    const nextIndex = deltaX < 0 ? mobileStepIndex + 1 : mobileStepIndex - 1;
    if (nextIndex < 0 || nextIndex >= MOBILE_WORKSHOP_STEPS.length) {
      setMobileMessage(deltaX < 0 ? "已是最後一步" : "已是第一步");
      return;
    }
    moveToMobileStep(nextIndex);
  };

  return (
    <div className="workshop-page site-container">
      <header className="page-intro workshop-page__intro">
        <p className="eyebrow">ORBITAL LAB / QUICK ASSEMBLY</p>
        <h1>多策略組裝車間</h1>
        <p>從訊號、確認、出場、倉位與風控模組快速組合策略，再以公開歷史行情驗證策略想法。</p>
        <p className="simulation-disclosure" role="note">歷史行情回測，不代表未來績效</p>
      </header>

      {draftError && (
        <div className="draft-status" role="status">
          <p>{draftError}</p>
          <span>目前編輯內容仍保留在頁面中，可調整後再次儲存。</span>
        </div>
      )}

      <div className="workshop-toolbar">
        <div className="workshop-mode" aria-label="編輯模式" role="group">
          <button aria-pressed={mode === "visual"} onClick={() => selectMode("visual")} type="button">視覺化模式</button>
          <button aria-pressed={mode === "javascript"} onClick={() => selectMode("javascript")} type="button">JavaScript 模式</button>
          <button className="workshop-clear" onClick={resetToBlank} type="button">清空選取</button>
        </div>
        <p className="workshop-capability-note" role="note">
          視覺化模式涵蓋常用進場、確認、離場、倉位與風控需求；需要自訂訊號邏輯時可切換 JavaScript 隔離沙箱。
        </p>
      </div>

      <nav className="workshop-stepper" aria-label="手機版組裝步驟">
        <p className="workshop-swipe-hint" id="workshop-swipe-instructions">左右滑動內容可快速切換步驟</p>
        <ol>
          {MOBILE_WORKSHOP_STEPS.map((step, index) => (
            <li key={step.id}>
              <button
                aria-controls={`workshop-step-${step.id}`}
                aria-current={mobileStep === step.id ? "step" : undefined}
                onClick={() => moveToMobileStep(index)}
                type="button"
              >
                <span>{step.number}</span>
                {step.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div
        aria-describedby="workshop-swipe-instructions"
        className="workshop-grid"
        onTouchCancel={() => { mobileSwipeStart.current = null; }}
        onTouchEnd={finishMobileSwipe}
        onTouchStart={beginMobileSwipe}
      >
        <div className="workshop-step-panel" data-mobile-active={mobileStep === "build"} id="workshop-step-build">
          {mode === "visual" ? (
            <StrategyPalette
              onAdd={addBlock}
              onMove={moveBlock}
              onRemove={removeBlock}
              selected={config.blocks}
            />
          ) : (
            <JavaScriptEditor source={config.source ?? createWeexJavaScriptTemplate(config)} onChange={updateSource} />
          )}
        </div>
        <div className="workshop-step-panel" data-mobile-active={mobileStep === "parameters"} id="workshop-step-parameters">
          <ParameterPanel config={config} onConfigField={updateField} onParameter={updateParameter} />
        </div>
        <div className="workshop-grid__results workshop-step-panel" data-mobile-active={mobileStep === "test"} id="workshop-step-test">
          <StrategySummary
            config={config}
            onFlowCheck={(state) => {
              if (state !== "untested") setAssociatedFlowCheck({ fingerprint: configFingerprint, state });
            }}
            validation={validation}
          />
          <div className="backtest-track">
            <p className="backtest-track__label">快速驗證 · 公開歷史 K 線 · 無需登入</p>
            <BacktestPanel
              config={config}
              onReport={acceptReport}
              onRun={() => setMobileMessage("正在取得公開歷史行情並執行回測…")}
              restoredReport={currentReport}
              validation={validation}
            />
          </div>
        </div>
        <div className="workshop-step-panel" data-mobile-active={mobileStep === "publish"} id="workshop-step-publish">
          <PackagePanel
            config={config}
            flowCheckState={currentFlowCheck}
            onImport={acceptImport}
            report={currentReport}
          />
        </div>
      </div>

      <section className="workshop-mobile-actions" aria-label="手機版組裝操作">
        <p aria-live="polite">{mobileMessage || (validation.valid ? currentReport ? "回測完成，可保存或發布策略" : "設定可回測" : `尚有 ${validation.errors.length} 項設定問題`)}</p>
        <div>
          <button aria-label="行動列：上一步" disabled={mobileStepIndex === 0} onClick={() => moveToMobileStep(mobileStepIndex - 1)} type="button">上一步</button>
          {mobileStep === "test" && (
            <button aria-label="行動列：檢查設定" onClick={() => setMobileMessage(validation.valid ? "設定檢查通過，可以執行歷史行情回測。" : validation.errors.join("；"))} type="button">檢查</button>
          )}
          {mobileStep === "test" && (
            <button aria-label="行動列：執行回測" disabled={!validation.valid} onClick={() => document.querySelector<HTMLButtonElement>(".backtest-run")?.click()} type="button">回測</button>
          )}
          {mobileStepIndex < MOBILE_WORKSHOP_STEPS.length - 1 && (
            <button className="workshop-mobile-actions__next" aria-label="行動列：下一步" onClick={() => moveToMobileStep(mobileStepIndex + 1)} type="button">下一步</button>
          )}
        </div>
      </section>
    </div>
  );
}
