"use client";

import { useEffect, useMemo, useState } from "react";
import { BacktestPanel } from "../../components/workshop/BacktestPanel";
import { ParameterPanel } from "../../components/workshop/ParameterPanel";
import { StrategyPalette } from "../../components/workshop/StrategyPalette";
import { StrategySummary } from "../../components/workshop/StrategySummary";
import { STRATEGY_PRESETS } from "../../data/strategies";
import { loadDraft, saveDraft } from "../../lib/storage";
import type { BotConfig, StrategyBlock } from "../../lib/types";
import { validateConfig } from "../../lib/strategy-validation";

const cloneBlock = (block: StrategyBlock): StrategyBlock => ({
  ...block,
  parameters: block.parameters.map((parameter) => ({ ...parameter })),
});

const cloneConfig = (config: BotConfig): BotConfig => ({
  ...config,
  blocks: config.blocks.map(cloneBlock),
});

const DEFAULT_CONFIG = cloneConfig(STRATEGY_PRESETS[0]);

export default function WorkshopPage() {
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [draftError, setDraftError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadDraft();
      if (draft) setConfig(cloneConfig(draft));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const validation = useMemo(() => validateConfig(config), [config]);

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

  return (
    <div className="workshop-page site-container">
      <header className="page-intro workshop-page__intro">
        <p className="eyebrow">ORBITAL LAB / QUICK ASSEMBLY</p>
        <h1>多策略組裝車間</h1>
        <p>從訊號、確認、出場、倉位與風控模組快速組合一套 WEEX 策略，再用可重現的模擬資料驗證想法。</p>
        <p className="simulation-disclosure" role="note">模擬回測資料，不代表未來績效</p>
      </header>

      {draftError && <p className="draft-status" role="status">{draftError}</p>}

      <div className="workshop-grid">
        <StrategyPalette
          onAdd={addBlock}
          onMove={moveBlock}
          onPreset={selectPreset}
          onRemove={removeBlock}
          selected={config.blocks}
        />
        <ParameterPanel config={config} onConfigField={updateField} onParameter={updateParameter} />
        <div className="workshop-grid__results">
          <StrategySummary config={config} validation={validation} />
          <BacktestPanel config={config} validation={validation} />
        </div>
      </div>
    </div>
  );
}
