import type { BotConfig, StrategyBlock } from "./types";
import { resolvedTradeDirection, tradeDirectionLabel } from "./trade-direction";

const value = (strategy: StrategyBlock, key: string): string => {
  const item = strategy.parameters.find((parameter) => parameter.key === key);
  return item ? `${item.value}${item.suffix ?? ""}` : "未設定";
};

const BLOCK_SUMMARIES: Record<string, (strategy: StrategyBlock) => string> = {
  rsi: (strategy) => `${strategy.name}：RSI ${value(strategy, "period")} 週期低於 ${value(strategy, "oversold")} 後反轉時進場。`,
  macd: (strategy) => `${strategy.name}：MACD ${value(strategy, "fastPeriod")} 週期快線上穿 ${value(strategy, "slowPeriod")} 週期慢線，並以 ${value(strategy, "signalPeriod")} 週期訊號線確認。`,
  "sma-cross": (strategy) => `${strategy.name}：${value(strategy, "shortPeriod")} 週期 SMA 上穿 ${value(strategy, "longPeriod")} 週期 SMA 時進場。`,
  "ema-cross": (strategy) => `${strategy.name}：${value(strategy, "shortPeriod")} 週期 EMA 上穿 ${value(strategy, "longPeriod")} 週期 EMA 時進場。`,
  stochastic: (strategy) => `${strategy.name}：${value(strategy, "kPeriod")} 週期 K 值在 ${value(strategy, "oversold")} 以下與 ${value(strategy, "dPeriod")} 期平滑 D 值黃金交叉時進場。`,
  "donchian-breakout": (strategy) => `${strategy.name}：價格突破前 ${value(strategy, "period")} 期最高或最低區間時順勢進場。`,
  "bollinger-breakout": (strategy) => `${strategy.name}：價格突破 ${value(strategy, "period")} 週期、${value(strategy, "deviation")} 倍標準差的布林上軌時進場。`,
  grid: (strategy) => `${strategy.name}：在 ${value(strategy, "range")} 區間內建立 ${value(strategy, "gridCount")} 層網格。`,
  dca: (strategy) => `${strategy.name}：每 ${value(strategy, "intervalDays")} 投入一次，回撤時最多加碼 ${value(strategy, "drawdownBoost")}。`,
  "cci-rebound": (strategy) => `${strategy.name}：CCI 從 ${value(strategy, "oversold")} 超賣區回升時進場。`,
  "williams-r-rebound": (strategy) => `${strategy.name}：Williams %R 從 ${value(strategy, "oversold")} 超賣區回升時進場。`,
  "roc-momentum": (strategy) => `${strategy.name}：${value(strategy, "period")} 週期 ROC 突破 ${value(strategy, "threshold")} 時進場。`,
  "ichimoku-breakout": (strategy) => `${strategy.name}：價格突破 ${value(strategy, "spanPeriod")} 週期雲層且轉換線高於基準線時進場。`,
  "supertrend-reversal": (strategy) => `${strategy.name}：價格突破 ${value(strategy, "multiplier")} 倍 ATR 趨勢帶時進場。`,
  "parabolic-sar": (strategy) => `${strategy.name}：價格穿越加速因子 ${value(strategy, "acceleration")} 的 SAR 時進場。`,
  "vwap-reclaim": (strategy) => `${strategy.name}：價格重新站上 ${value(strategy, "period")} 週期 VWAP 時進場。`,
  "mfi-rebound": (strategy) => `${strategy.name}：MFI 從 ${value(strategy, "oversold")} 超賣區回升時進場。`,
  "obv-breakout": (strategy) => `${strategy.name}：OBV 突破前 ${value(strategy, "period")} 期區間時進場。`,
  "price-action-breakout": (strategy) => `${strategy.name}：價格突破前 ${value(strategy, "lookback")} 期高低點並保留 ${value(strategy, "buffer")} 緩衝。`,
  "direct-confirmation": () => "直接確認：進場時機成立後不附加額外過濾條件。",
  "volume-confirmation": (strategy) => `${strategy.name}：成交量達 ${value(strategy, "period")} 期均量的 ${value(strategy, "multiplier")} 倍時確認訊號。`,
  "adx-confirmation": (strategy) => `${strategy.name}：${value(strategy, "period")} 週期 ADX 達 ${value(strategy, "minimumStrength")} 以上才確認進場。`,
  "atr-volatility-confirmation": (strategy) => `${strategy.name}：${value(strategy, "period")} 週期 ATR 波動率達 ${value(strategy, "minimumVolatility")} 以上才確認進場。`,
  "bollinger-bandwidth-confirmation": (strategy) => `${strategy.name}：${value(strategy, "period")} 週期布林帶寬達 ${value(strategy, "minimumBandwidth")} 以上才確認進場。`,
  "take-profit": (strategy) => `${strategy.name}：部位獲利達 ${value(strategy, "takeProfit")} 時停利。`,
  "atr-take-profit": (strategy) => `${strategy.name}：獲利達 ${value(strategy, "atrMultiple")} 倍 ${value(strategy, "atrPeriod")} 週期 ATR 時停利。`,
  "rsi-profit-exit": (strategy) => `${strategy.name}：獲利至少 ${value(strategy, "minimumProfit")} 且 RSI 進入 ${value(strategy, "overbought")} 過熱區時離場。`,
  "timed-profit-exit": (strategy) => `${strategy.name}：持倉達 ${value(strategy, "holdingHours")} 且獲利至少 ${value(strategy, "minimumProfit")} 時離場。`,
  "stop-loss": (strategy) => `${strategy.name}：部位虧損達 ${value(strategy, "stopLoss")} 時停損。`,
  "trailing-stop": (strategy) => `${strategy.name}：價格自高點回撤 ${value(strategy, "trailingDistance")} 時移動停損。`,
  "fixed-position": (strategy) => `${strategy.name}：每筆交易使用 ${value(strategy, "positionSize")} 的固定倉位。`,
  "atr-sizing": (strategy) => `${strategy.name}：依 ${value(strategy, "atrPeriod")} 週期 ATR 調整倉位，單筆風險限制為 ${value(strategy, "riskPerTrade")}。`,
  "maximum-daily-loss": (strategy) => `${strategy.name}：單日虧損達 ${value(strategy, "maximumDailyLoss")} 時停止交易。`,
  "consecutive-loss-pause": (strategy) => `${strategy.name}：連續虧損 ${value(strategy, "lossCount")} 後暫停交易 ${value(strategy, "pauseHours")}。`,
};

export const summarizeStrategy = (config: BotConfig): string[] => {
  const logic = config.logicMode === "all" ? "全部條件成立" : "任一條件成立";
  const market = config.market === "spot" ? "現貨" : "合約";
  const rules = [
    `使用 ${config.timeframe} 時間週期，於${logic}時觸發策略。`,
    `交易標的是 WEEX ${market} ${config.symbol}，使用 ${config.leverage} 倍槓桿。`,
  ];
  const direction = resolvedTradeDirection(config);
  rules.push(direction === "long"
    ? `交易方向為${tradeDirectionLabel(config)}：多頭訊號可開倉，空頭訊號只用於平多倉。`
    : direction === "short"
      ? `交易方向為${tradeDirectionLabel(config)}：空頭訊號可開倉，多頭訊號只用於平空倉。`
      : `交易方向為${tradeDirectionLabel(config)}：多頭訊號開多、空頭訊號開空，反向訊號先平既有部位。`);

  for (const strategy of config.blocks) {
    const summarize = BLOCK_SUMMARIES[strategy.id];
    rules.push(summarize ? summarize(strategy) : `${strategy.name}：${strategy.description.replace(/。$/, "")}。`);
  }

  return rules;
};
