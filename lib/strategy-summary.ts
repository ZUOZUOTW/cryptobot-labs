import type { BotConfig, StrategyBlock } from "./types";

const value = (strategy: StrategyBlock, key: string): string => {
  const item = strategy.parameters.find((parameter) => parameter.key === key);
  return item ? `${item.value}${item.suffix ?? ""}` : "未設定";
};

const BLOCK_SUMMARIES: Record<string, (strategy: StrategyBlock) => string> = {
  rsi: (strategy) => `${strategy.name}：RSI ${value(strategy, "period")} 週期低於 ${value(strategy, "oversold")} 後反轉時進場。`,
  macd: (strategy) => `${strategy.name}：MACD ${value(strategy, "fastPeriod")} 週期快線上穿 ${value(strategy, "slowPeriod")} 週期慢線，並以 ${value(strategy, "signalPeriod")} 週期訊號線確認。`,
  "sma-cross": (strategy) => `${strategy.name}：${value(strategy, "shortPeriod")} 週期 SMA 上穿 ${value(strategy, "longPeriod")} 週期 SMA 時進場。`,
  "bollinger-breakout": (strategy) => `${strategy.name}：價格突破 ${value(strategy, "period")} 週期、${value(strategy, "deviation")} 倍標準差的布林上軌時進場。`,
  grid: (strategy) => `${strategy.name}：在 ${value(strategy, "range")} 區間內建立 ${value(strategy, "gridCount")} 層網格。`,
  dca: (strategy) => `${strategy.name}：每 ${value(strategy, "intervalDays")} 投入一次，回撤時最多加碼 ${value(strategy, "drawdownBoost")}。`,
  "volume-confirmation": (strategy) => `${strategy.name}：成交量達 ${value(strategy, "period")} 期均量的 ${value(strategy, "multiplier")} 倍時確認訊號。`,
  "take-profit": (strategy) => `${strategy.name}：部位獲利達 ${value(strategy, "takeProfit")} 時停利。`,
  "stop-loss": (strategy) => `${strategy.name}：部位虧損達 ${value(strategy, "stopLoss")} 時停損。`,
  "trailing-stop": (strategy) => `${strategy.name}：價格自高點回撤 ${value(strategy, "trailingDistance")} 時移動停損。`,
  "fixed-position": (strategy) => `${strategy.name}：每筆交易使用 ${value(strategy, "positionSize")} 的固定倉位。`,
  "atr-sizing": (strategy) => `${strategy.name}：依 ${value(strategy, "atrPeriod")} 週期 ATR 調整倉位，單筆風險限制為 ${value(strategy, "riskPerTrade")}。`,
  "maximum-daily-loss": (strategy) => `${strategy.name}：單日虧損達 ${value(strategy, "maximumDailyLoss")} 時停止交易。`,
};

export const summarizeStrategy = (config: BotConfig): string[] => {
  const logic = config.logicMode === "all" ? "全部條件成立" : "任一條件成立";
  const market = config.market === "spot" ? "現貨" : "合約";
  const rules = [
    `使用 ${config.timeframe} 時間週期，於${logic}時觸發策略。`,
    `交易標的是 WEEX ${market} ${config.symbol}，使用 ${config.leverage} 倍槓桿。`,
  ];

  for (const strategy of config.blocks) {
    const summarize = BLOCK_SUMMARIES[strategy.id];
    rules.push(summarize ? summarize(strategy) : `${strategy.name}：${strategy.description.replace(/。$/, "")}。`);
  }

  return rules;
};
