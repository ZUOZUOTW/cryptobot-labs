"use client";

import { useEffect, useMemo, useState } from "react";
import { STRATEGY_BLOCKS } from "../../data/strategies";
import {
  FALLBACK_WEEX_MARKET_CATALOG,
  isWeexMarketCatalog,
  type WeexMarketCatalog,
} from "../../lib/weex-market-catalog";
import type { BotConfig } from "../../lib/types";
import { TradingPairCombobox } from "./TradingPairCombobox";

const commonParameterValue = (blockId: string, parameterKey: string): number | undefined => (
  STRATEGY_BLOCKS.find((block) => block.id === blockId)
    ?.parameters.find((parameter) => parameter.key === parameterKey)?.value
);

const MARKET_OPTIONS = [
  { value: "spot", label: "現貨", detail: "資產持有 · 1×" },
  { value: "futures", label: "合約", detail: "多空交易 · 可調槓桿" },
] as const;

const TIMEFRAME_OPTIONS = [
  { value: "1m", label: "1 分", detail: "高頻" },
  { value: "5m", label: "5 分", detail: "超短線" },
  { value: "15m", label: "15 分", detail: "短線" },
  { value: "30m", label: "30 分", detail: "短波段" },
  { value: "1h", label: "1 小時", detail: "日內" },
  { value: "4h", label: "4 小時", detail: "波段" },
  { value: "1d", label: "1 天", detail: "趨勢" },
] as const;

const MARKET_CATALOG_CACHE_TTL_MS = 5 * 60 * 1_000;
let marketCatalogCache: { value: WeexMarketCatalog; expiresAt: number } | null = null;
let marketCatalogRequest: Promise<WeexMarketCatalog> | null = null;

function loadMarketCatalog(): Promise<WeexMarketCatalog> {
  if (marketCatalogCache && marketCatalogCache.expiresAt > Date.now()) {
    return Promise.resolve(marketCatalogCache.value);
  }
  marketCatalogRequest ??= fetch("/api/weex/markets", { headers: { Accept: "application/json" } })
    .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("market metadata unavailable")))
    .then((value: unknown) => {
      if (!isWeexMarketCatalog(value)) throw new TypeError("invalid WEEX market catalog");
      marketCatalogCache = { value, expiresAt: Date.now() + MARKET_CATALOG_CACHE_TTL_MS };
      return value;
    })
    .finally(() => {
      marketCatalogRequest = null;
    });
  return marketCatalogRequest;
}

function ResetIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M5.2 6.1A6 6 0 1 1 4 10" />
      <path d="M2.8 3.8v4.1h4.1" />
    </svg>
  );
}

interface ParameterPanelProps {
  config: BotConfig;
  onConfigField: <Key extends keyof Pick<BotConfig, "name" | "market" | "symbol" | "timeframe" | "logicMode" | "leverage">>(
    key: Key,
    value: BotConfig[Key],
  ) => void;
  onParameter: (blockIndex: number, parameterKey: string, value: number) => void;
}

export function ParameterPanel({ config, onConfigField, onParameter }: ParameterPanelProps) {
  const [catalog, setCatalog] = useState<WeexMarketCatalog>(
    () => marketCatalogCache?.value ?? FALLBACK_WEEX_MARKET_CATALOG,
  );
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "live" | "fallback">(
    process.env.NODE_ENV === "test" ? "fallback" : marketCatalogCache ? "live" : "loading",
  );
  const pairs = catalog[config.market];
  const selectedPair = useMemo(
    () => pairs.find((pair) => pair.symbol === config.symbol),
    [config.symbol, pairs],
  );
  const maximumLeverage = config.market === "spot" ? 1 : selectedPair?.maxLeverage ?? 1;

  useEffect(() => {
    if (process.env.NODE_ENV === "test") return;
    let active = true;
    void loadMarketCatalog()
      .then((value) => {
        if (!active) return;
        setCatalog(value);
        setCatalogStatus("live");
      })
      .catch(() => {
        if (active) setCatalogStatus("fallback");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedPair) return;
    const fallback = pairs.find((pair) => pair.symbol === "BTCUSDT") ?? pairs[0];
    if (fallback) onConfigField("symbol", fallback.symbol);
  }, [onConfigField, pairs, selectedPair]);

  useEffect(() => {
    if (config.market === "futures" && config.leverage > maximumLeverage) {
      onConfigField("leverage", maximumLeverage);
    }
  }, [config.leverage, config.market, maximumLeverage, onConfigField]);

  const catalogMessage = catalogStatus === "live"
    ? `已同步 API 可交易產品 · ${pairs.length} 個交易對`
    : catalogStatus === "loading"
      ? `正在同步 API 可交易產品 · 先顯示 ${pairs.length} 個交易對`
      : `即時資料暫時無法連線 · 顯示 ${pairs.length} 個 API 可交易對`;
  const leverageSource = catalogStatus === "live"
    ? "即時產品資料"
    : catalogStatus === "loading"
      ? "正在同步產品資料"
      : "產品備援資料";

  return (
    <section className="workshop-panel parameter-panel glass-panel" aria-labelledby="parameter-title">
      <div className="workshop-panel__heading">
        <div>
          <p className="eyebrow">02 / PARAMETERS</p>
          <h2 id="parameter-title">快速參數</h2>
        </div>
        <span className="exchange-badge"><span className="exchange-badge__signal" aria-hidden="true" />LIVE DATA</span>
      </div>

      <fieldset className="market-controls">
        <legend>交易環境</legend>
        <label className="market-control--name">
          <span>策略名稱</span>
          <input
            aria-label="策略名稱"
            maxLength={100}
            onChange={(event) => onConfigField("name", event.target.value)}
            placeholder="為這個策略版本命名"
            type="text"
            value={config.name}
          />
        </label>
        <div className="market-control market-control--visual">
          <span className="market-control__label">市場</span>
          <div aria-label="市場" className="visual-choice-group visual-choice-group--market" role="group">
            {MARKET_OPTIONS.map((option) => (
              <button
                aria-pressed={config.market === option.value}
                data-choice={option.value}
                key={option.value}
                onClick={() => onConfigField("market", option.value)}
                type="button"
              >
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="market-control market-control--pair">
          <span className="market-control__label">交易對</span>
          <TradingPairCombobox
            key={config.market}
            onChange={(symbol) => onConfigField("symbol", symbol)}
            pairs={pairs}
            value={config.symbol}
          />
          <small className="market-catalog-status" data-status={catalogStatus}>{catalogMessage}</small>
        </div>
        <div className="market-control market-control--visual">
          <span className="market-control__label">時間週期</span>
          <div aria-label="時間週期" className="visual-choice-group visual-choice-group--timeframe" role="group">
            {TIMEFRAME_OPTIONS.map((option) => (
              <button
                aria-pressed={config.timeframe === option.value}
                key={option.value}
                onClick={() => onConfigField("timeframe", option.value)}
                type="button"
              >
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
        </div>
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
        <div
          aria-label="交易對槓桿上限"
          aria-live="polite"
          className="leverage-limit-card"
          data-market={config.market}
          role="region"
        >
          <div className="leverage-limit-card__value">
            <span>此商品最大支援槓桿</span>
            <strong>{maximumLeverage}<small>×</small></strong>
          </div>
          <div className="leverage-limit-card__copy">
            <strong>{config.symbol} · {config.market === "spot" ? "現貨" : "合約"}</strong>
            <p>{config.market === "spot"
              ? "現貨交易不使用合約槓桿，系統固定為 1×。"
              : `此交易對最高支援 ${maximumLeverage}×；目前設定為 ${config.leverage}×。`}</p>
          </div>
          <span className="leverage-limit-card__source" data-status={catalogStatus}>{leverageSource}</span>
        </div>
        <div className="parameter-row__label">
          <label htmlFor="leverage-slider">槓桿</label>
          <div className="parameter-row__tools">
            <span>目前設定 {config.leverage}×</span>
            <button
              aria-label="重置槓桿為 1 倍"
              className="parameter-reset"
              disabled={config.leverage === 1}
              onClick={() => onConfigField("leverage", 1)}
              title="重置為 1 倍"
              type="button"
            >
              <ResetIcon />
              <span className="parameter-reset__label">重設</span>
            </button>
          </div>
        </div>
        <div className="parameter-row__inputs">
          <input
            aria-label="槓桿滑桿"
            disabled={config.market === "spot"}
            id="leverage-slider"
            max={maximumLeverage}
            min={1}
            onChange={(event) => onConfigField("leverage", Number(event.target.value))}
            step={1}
            type="range"
            value={config.leverage}
          />
          <input
            aria-label="槓桿數值"
            disabled={config.market === "spot"}
            max={maximumLeverage}
            min={1}
            onChange={(event) => onConfigField("leverage", Number(event.target.value))}
            step={1}
            type="number"
            value={config.leverage}
          />
        </div>
        {config.market === "futures" && <small>若切換至較低上限的交易對，系統會自動將設定下修至合法範圍。</small>}
      </div>

      <div className="block-parameters">
        {config.blocks.map((block, blockIndex) => block.parameters.length > 0 && (
          <fieldset key={block.id}>
            <legend>{block.id === "rsi" ? "RSI Rebound" : block.name}</legend>
            {block.parameters.map((parameter) => {
              const defaultValue = commonParameterValue(block.id, parameter.key) ?? parameter.value;
              return (
                <div className="parameter-row" key={parameter.key}>
                  <div className="parameter-row__label">
                    <label htmlFor={`${block.id}-${parameter.key}-slider`}>{parameter.label}</label>
                    <div className="parameter-row__tools">
                      <span className="parameter-row__common">預設 {defaultValue}{parameter.suffix}</span>
                      <button
                        aria-label={`重置${block.name}的${parameter.label}為預設值`}
                        className="parameter-reset"
                        disabled={parameter.value === defaultValue}
                        onClick={() => onParameter(blockIndex, parameter.key, defaultValue)}
                        title={`重置為 ${defaultValue}${parameter.suffix ?? ""}`}
                        type="button"
                      >
                        <ResetIcon />
                        <span className="parameter-reset__label">重設</span>
                      </button>
                    </div>
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
              );
            })}
          </fieldset>
        ))}
      </div>
    </section>
  );
}
