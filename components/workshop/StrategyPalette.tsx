"use client";

import { useMemo, useState } from "react";
import { STRATEGY_BLOCKS } from "../../data/strategies";
import type { StrategyBlock, StrategyGroup } from "../../lib/types";

const GROUPS: { id: StrategyGroup; label: string; description: string; accent: "violet" | "cyan" }[] = [
  { id: "entry", label: "進場時機", description: "先選擇什麼市場狀況出現時開始交易。", accent: "violet" },
  { id: "confirm", label: "訊號確認", description: "加入第二項依據，減少單一指標造成的假訊號。", accent: "cyan" },
  { id: "exit", label: "獲利離場", description: "設定達成目標或行情反轉時如何離場。", accent: "violet" },
  { id: "position", label: "投入比例", description: "決定每次交易投入多少資金。", accent: "cyan" },
  { id: "risk", label: "虧損保護", description: "設定停損與每日損失上限。", accent: "violet" },
];

const STRATEGY_INTRO: Record<string, string> = {
  rsi: "RSI 將漲跌動能標準化為 0–100，優點是門檻清楚，容易辨識超買與超賣。",
  macd: "MACD 同時呈現趨勢方向與動能變化，優點是能把均線交叉轉化為較直觀的訊號。",
  "sma-cross": "SMA 平滑短期價格雜訊，優點是規則簡單、趨勢方向容易理解。",
  "ema-cross": "EMA 對近期價格給予較高權重，優點是比一般均線更快反映市場變化。",
  stochastic: "KD 衡量收盤價在近期高低區間的位置，優點是對短期動能轉折較敏感。",
  "bollinger-breakout": "布林通道會隨波動度自動放大或收縮，優點是能同時觀察價格位置與波動變化。",
  "donchian-breakout": "唐奇安通道以近期最高價與最低價建立區間，優點是突破條件客觀明確。",
  grid: "網格把價格區間切成多個交易層級，優點是能系統化處理反覆震盪。",
  dca: "定期定額按時間分散進場，優點是降低單次買點對整體成本的影響。",
  "cci-rebound": "CCI 衡量價格偏離統計均值的程度，優點是能辨識趨勢中的過度延伸與回歸機會。",
  "williams-r-rebound": "Williams %R 顯示收盤價在近期區間的位置，優點是反應快速且超買超賣界線明確。",
  "roc-momentum": "ROC 直接衡量指定期間的價格變動率，優點是能清楚比較動能加速與減速。",
  "ichimoku-breakout": "一目均衡表整合趨勢、支撐壓力與動能，優點是能用雲層快速判斷市場結構。",
  "supertrend-reversal": "Supertrend 以 ATR 建立動態趨勢帶，優點是會隨波動調整翻轉門檻。",
  "parabolic-sar": "拋物線 SAR 以加速點追蹤趨勢，優點是能直觀標示可能的趨勢翻轉位置。",
  "vwap-reclaim": "VWAP 代表成交量加權的市場平均成本，優點是能觀察價格是否重新取得主導成本區。",
  "mfi-rebound": "MFI 同時結合價格與成交量衡量資金流，優點是比單純價格動能多一層量能資訊。",
  "obv-breakout": "OBV 用成交量累積方向觀察量價關係，優點是能提早辨識資金流是否支持價格突破。",
  "price-action-breakout": "價格行為突破直接使用近期高低點，優點是規則透明且不依賴衍生指標。",
  "direct-confirmation": "不附加第二層過濾條件，優點是設定最簡單，所有有效進場訊號都會直接通過。",
  "volume-confirmation": "成交量反映市場參與程度，優點是能協助排除量能不足的弱訊號。",
  "adx-confirmation": "ADX 專注衡量趨勢強度而非方向，優點是能協助辨識趨勢與盤整環境。",
  "atr-volatility-confirmation": "ATR 將價格波動轉換為可比較的幅度，優點是能避開過度沉寂、訊號品質較差的時段。",
  "bollinger-bandwidth-confirmation": "布林帶寬量化上下軌的距離，優點是能辨識波動開始擴張的市場環境。",
  "take-profit": "固定停利預先定義獲利出口，優點是減少臨場猶豫並鎖定成果。",
  "atr-take-profit": "ATR 動態停利會依市場波動調整目標距離，優點是不同幣種與行情可使用一致的波動尺度。",
  "rsi-profit-exit": "RSI 動能離場在價格過熱且已有獲利時出場，優點是能利用動能極端值保護成果。",
  "timed-profit-exit": "持倉時間停利結合時間與最低獲利門檻，優點是避免獲利部位長時間停滯。",
  "stop-loss": "固定停損為單筆交易設定明確損失界線，優點是風險容易估算。",
  "trailing-stop": "移動停損會跟隨有利價格調整，優點是兼顧保護獲利與延續趨勢。",
  "fixed-position": "固定倉位讓每筆交易使用一致資金比例，優點是曝險清楚且容易管理。",
  "atr-sizing": "ATR 倉位會依市場波動自動調整投入比例，優點是讓不同波動環境的風險更一致。",
  "maximum-daily-loss": "每日虧損上限會在損失達門檻後停止新增交易，優點是避免連續虧損擴大。",
  "consecutive-loss-pause": "連敗暫停會記錄連續虧損筆數並啟動冷卻時間，優點是避免策略在不適合的行情中持續進場。",
};

const recommendedGroupFor = (blocks: readonly StrategyBlock[]): StrategyGroup | undefined => (
  GROUPS.find((group) => !blocks.some((block) => block.group === group.id))?.id
);

export function strategyDisplayName(block: StrategyBlock): string {
  return block.id === "rsi" ? "RSI Rebound" : block.name;
}

interface StrategyPaletteProps {
  selected: StrategyBlock[];
  onAdd: (block: StrategyBlock) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}

export function StrategyPalette({ selected, onAdd, onRemove, onMove }: StrategyPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState<StrategyGroup>("entry");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedIds = useMemo(() => new Set(selected.map((block) => block.id)), [selected]);
  const selectedPosition = selected.find((block) => block.group === "position");
  const recommendedGroup = recommendedGroupFor(selected);
  const recommendation = GROUPS.find((group) => group.id === recommendedGroup);
  const recommendedStep = recommendation ? GROUPS.findIndex((group) => group.id === recommendedGroup) + 1 : GROUPS.length;

  const matches = (block: StrategyBlock) => (
    normalizedQuery.length === 0
    || `${strategyDisplayName(block)} ${block.name} ${block.description} ${STRATEGY_INTRO[block.id] ?? ""}`.toLocaleLowerCase().includes(normalizedQuery)
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

      <section className="strategy-guide" aria-live="polite">
        <div>
          <span>{recommendation ? "建議下一步" : "基本設定完成"} · {String(recommendedStep).padStart(2, "0")} / 05</span>
          <strong>{recommendation?.label ?? "可進一步調整參數"}</strong>
          <p>{recommendation?.description ?? "五個策略步驟都已設定，可前往快速參數微調數值。"}</p>
        </div>
        {recommendedGroup && (
          <button onClick={() => { setActiveGroup(recommendedGroup); setQuery(""); }} type="button">
            查看建議選項
          </button>
        )}
      </section>

      <div className="strategy-category-tabs" aria-label="策略模組分類" role="tablist">
        {GROUPS.map((group) => (
          <button
            aria-controls={`strategy-group-${group.id}`}
            aria-selected={activeGroup === group.id}
            data-accent={group.accent}
            key={group.id}
            onClick={() => { setActiveGroup(group.id); setQuery(""); }}
            role="tab"
            type="button"
          >
            <span>{group.label}</span>
            <strong>{selected.some((block) => block.group === group.id) ? `已選 ${selected.filter((block) => block.group === group.id).length}` : "待選"}</strong>
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
            <section aria-labelledby={`strategy-group-title-${group.id}`} className="strategy-group" data-accent={group.accent} data-active={normalizedQuery.length > 0 || group.id === activeGroup ? "true" : "false"} id={`strategy-group-${group.id}`} key={group.id} role="tabpanel">
              <h3 id={`strategy-group-title-${group.id}`}>{normalizedQuery.length > 0 ? group.label : `${group.label}模組`}</h3>
              <ul>
                {blocks.map((block) => {
                  const isSelected = selectedIds.has(block.id);
                  const introduction = STRATEGY_INTRO[block.id];
                  const conflict = block.group === "position" && selectedPosition !== undefined && !isSelected;
                  const conflictMessage = conflict
                    ? `與已選擇的${selectedPosition.name}衝突，請先移除原倉位模組。`
                    : undefined;
                  const conflictId = conflict ? `strategy-conflict-${block.id}` : undefined;

                  return (
                    <li
                      className="strategy-option"
                      data-selected={isSelected ? "true" : "false"}
                      data-status={conflict ? "conflict" : "compatible"}
                      key={block.id}
                    >
                      <div>
                        <strong>{strategyDisplayName(block)}</strong>
                        <p>{block.description}</p>
                        {introduction && <p className="strategy-option__intro">{introduction}</p>}
                        {conflictMessage && <p className="strategy-conflict" id={conflictId}>{conflictMessage}</p>}
                      </div>
                      <button
                        aria-describedby={conflictId}
                        aria-disabled={conflict}
                        aria-label={isSelected
                          ? `取消選取 ${strategyDisplayName(block)}`
                          : `加入 ${strategyDisplayName(block)}`}
                        aria-pressed={isSelected}
                        className="strategy-option__add"
                        disabled={conflict}
                        onClick={() => {
                          if (conflict) return;
                          if (isSelected) {
                            const index = selected.findIndex((selectedBlock) => selectedBlock.id === block.id);
                            if (index >= 0) onRemove(index);
                          } else {
                            onAdd(block);
                            const nextGroup = recommendedGroupFor([...selected, block]);
                            if (nextGroup) setActiveGroup(nextGroup);
                            setQuery("");
                          }
                        }}
                        type="button"
                      >
                        <span aria-hidden="true">{isSelected ? "✓" : "+"}</span>
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
          {selected.length === 0 && <li className="selected-strategies__empty">尚未選擇策略模組</li>}
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
