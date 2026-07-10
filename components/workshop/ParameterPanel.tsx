"use client";

import type { BotConfig } from "../../lib/types";

interface ParameterPanelProps {
  config: BotConfig;
  onConfigField: <Key extends keyof Pick<BotConfig, "market" | "symbol" | "timeframe" | "logicMode" | "leverage">>(
    key: Key,
    value: BotConfig[Key],
  ) => void;
  onParameter: (blockIndex: number, parameterKey: string, value: number) => void;
}

export function ParameterPanel({ config, onConfigField, onParameter }: ParameterPanelProps) {
  return (
    <section className="workshop-panel parameter-panel glass-panel" aria-labelledby="parameter-title">
      <div className="workshop-panel__heading">
        <div>
          <p className="eyebrow">02 / PARAMETERS</p>
          <h2 id="parameter-title">快速參數</h2>
        </div>
        <span className="exchange-badge"><span className="exchange-badge__signal" aria-hidden="true" />WEEX</span>
      </div>

      <fieldset className="market-controls">
        <legend>交易環境</legend>
        <label>
          <span>市場</span>
          <select
            aria-label="市場"
            onChange={(event) => onConfigField("market", event.target.value as BotConfig["market"])}
            value={config.market}
          >
            <option value="spot">現貨</option>
            <option value="futures">合約</option>
          </select>
        </label>
        <label>
          <span>交易對</span>
          <select aria-label="交易對" onChange={(event) => onConfigField("symbol", event.target.value)} value={config.symbol}>
            <option value="BTCUSDT">BTC / USDT</option>
            <option value="ETHUSDT">ETH / USDT</option>
            <option value="SOLUSDT">SOL / USDT</option>
          </select>
        </label>
        <label>
          <span>時間週期</span>
          <select aria-label="時間週期" onChange={(event) => onConfigField("timeframe", event.target.value)} value={config.timeframe}>
            <option value="15m">15 分鐘</option>
            <option value="1h">1 小時</option>
            <option value="4h">4 小時</option>
            <option value="1d">1 天</option>
          </select>
        </label>
        <label>
          <span>條件邏輯</span>
          <select
            aria-label="條件邏輯"
            onChange={(event) => onConfigField("logicMode", event.target.value as BotConfig["logicMode"])}
            value={config.logicMode}
          >
            <option value="all">符合全部條件</option>
            <option value="any">符合任一條件</option>
          </select>
        </label>
      </fieldset>

      <div className="leverage-control">
        <div className="parameter-row__label">
          <label htmlFor="leverage-slider">槓桿</label>
          <span>{config.leverage}×</span>
        </div>
        <div className="parameter-row__inputs">
          <input
            aria-label="槓桿滑桿"
            disabled={config.market === "spot"}
            id="leverage-slider"
            max={20}
            min={1}
            onChange={(event) => onConfigField("leverage", Number(event.target.value))}
            step={1}
            type="range"
            value={config.leverage}
          />
          <input
            aria-label="槓桿數值"
            disabled={config.market === "spot"}
            max={20}
            min={1}
            onChange={(event) => onConfigField("leverage", Number(event.target.value))}
            step={1}
            type="number"
            value={config.leverage}
          />
        </div>
        {config.market === "spot" && <small>現貨模式固定為 1× 槓桿</small>}
      </div>

      <div className="block-parameters">
        {config.blocks.map((block, blockIndex) => (
          <fieldset key={block.id}>
            <legend>{block.id === "rsi" ? "RSI Rebound" : block.name}</legend>
            {block.parameters.map((parameter) => (
              <div className="parameter-row" key={parameter.key}>
                <div className="parameter-row__label">
                  <label htmlFor={`${block.id}-${parameter.key}-slider`}>{parameter.label}</label>
                  <span>{parameter.value}{parameter.suffix}</span>
                </div>
                <div className="parameter-row__inputs">
                  <input
                    aria-label={`${parameter.label}滑桿`}
                    id={`${block.id}-${parameter.key}-slider`}
                    max={parameter.max}
                    min={parameter.min}
                    onChange={(event) => onParameter(blockIndex, parameter.key, Number(event.target.value))}
                    step={parameter.step}
                    type="range"
                    value={parameter.value}
                  />
                  <input
                    aria-label={`${parameter.label}數值`}
                    max={parameter.max}
                    min={parameter.min}
                    onChange={(event) => onParameter(blockIndex, parameter.key, Number(event.target.value))}
                    step={parameter.step}
                    type="number"
                    value={parameter.value}
                  />
                </div>
              </div>
            ))}
          </fieldset>
        ))}
      </div>
    </section>
  );
}
