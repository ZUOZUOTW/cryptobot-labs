"use client";

import { useMemo, useState } from "react";
import { STRATEGY_BLOCKS, STRATEGY_PRESETS } from "../../data/strategies";
import type { BotConfig, StrategyBlock, StrategyGroup } from "../../lib/types";

const GROUPS: { id: StrategyGroup; label: string; accent: "violet" | "cyan" }[] = [
  { id: "entry", label: "進場訊號", accent: "violet" },
  { id: "confirm", label: "確認條件", accent: "cyan" },
  { id: "exit", label: "出場規則", accent: "violet" },
  { id: "position", label: "倉位管理", accent: "cyan" },
  { id: "risk", label: "風險控制", accent: "violet" },
];

export function strategyDisplayName(block: StrategyBlock): string {
  return block.id === "rsi" ? "RSI Rebound" : block.name;
}

interface StrategyPaletteProps {
  selected: StrategyBlock[];
  onPreset: (preset: BotConfig) => void;
  onAdd: (block: StrategyBlock) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}

export function StrategyPalette({ selected, onPreset, onAdd, onRemove, onMove }: StrategyPaletteProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedIds = useMemo(() => new Set(selected.map((block) => block.id)), [selected]);
  const selectedPosition = selected.find((block) => block.group === "position");

  const matches = (block: StrategyBlock) => (
    normalizedQuery.length === 0
    || `${strategyDisplayName(block)} ${block.name} ${block.description}`.toLocaleLowerCase().includes(normalizedQuery)
  );

  return (
    <section className="workshop-panel strategy-palette glass-panel" aria-labelledby="palette-title">
      <div className="workshop-panel__heading">
        <div>
          <p className="eyebrow">01 / STRATEGY BLOCKS</p>
          <h2 id="palette-title">策略模組庫</h2>
        </div>
        <span className="workshop-count">{selected.length} 已選</span>
      </div>

      <div className="preset-strip" aria-label="策略預設">
        {STRATEGY_PRESETS.map((preset) => (
          <button className="preset-chip" key={preset.id} onClick={() => onPreset(preset)} type="button">
            {preset.name}
          </button>
        ))}
      </div>

      <label className="workshop-search">
        <span className="sr-only">搜尋策略模組</span>
        <input
          aria-label="搜尋策略模組"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋 RSI、動能、風控…"
          type="search"
          value={query}
        />
      </label>

      <div className="strategy-groups">
        {GROUPS.map((group) => {
          const blocks = STRATEGY_BLOCKS.filter((block) => block.group === group.id && matches(block));
          if (blocks.length === 0) return null;

          return (
            <section className="strategy-group" data-accent={group.accent} key={group.id}>
              <h3>{group.label}</h3>
              <ul>
                {blocks.map((block) => {
                  const isSelected = selectedIds.has(block.id);
                  const conflict = block.group === "position" && selectedPosition !== undefined && !isSelected;
                  const conflictMessage = conflict
                    ? `與已選擇的${selectedPosition.name}衝突，請先移除原倉位模組。`
                    : undefined;

                  return (
                    <li className="strategy-option" data-status={conflict ? "conflict" : "compatible"} key={block.id}>
                      <div>
                        <strong>{strategyDisplayName(block)}</strong>
                        <p>{block.description}</p>
                        {conflictMessage && <p className="strategy-conflict">{conflictMessage}</p>}
                      </div>
                      <button
                        aria-disabled={conflict || isSelected}
                        aria-label={`加入 ${strategyDisplayName(block)}`}
                        className="strategy-option__add"
                        onClick={() => {
                          if (!conflict && !isSelected) onAdd(block);
                        }}
                        type="button"
                      >
                        {isSelected ? "已加入" : "+"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="selected-strategies" aria-label="已選策略">
        <h3>訊號流程</h3>
        <ol>
          {selected.map((block, index) => (
            <li data-block-id={block.id} key={block.id}>
              <span className="selected-strategies__index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{strategyDisplayName(block)}</strong>
                <small>{GROUPS.find((group) => group.id === block.group)?.label}</small>
              </div>
              <div className="selected-strategies__actions">
                <button
                  aria-label={`向上移動 ${strategyDisplayName(block)}`}
                  disabled={index === 0}
                  onClick={() => onMove(index, -1)}
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label={`向下移動 ${strategyDisplayName(block)}`}
                  disabled={index === selected.length - 1}
                  onClick={() => onMove(index, 1)}
                  type="button"
                >
                  ↓
                </button>
                <button aria-label={`移除 ${strategyDisplayName(block)}`} onClick={() => onRemove(index)} type="button">
                  ×
                </button>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
