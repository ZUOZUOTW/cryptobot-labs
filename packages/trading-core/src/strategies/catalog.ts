import type {
  VisualStrategyBlock,
  VisualStrategyGroup,
  VisualStrategyParameter,
} from "./types";

const parameter = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  suffix?: string,
): VisualStrategyParameter => ({ key, label, value, min, max, step, suffix });

const block = (
  id: string,
  name: string,
  group: VisualStrategyGroup,
  description: string,
  parameters: VisualStrategyParameter[],
): VisualStrategyBlock => ({ id, name, group, description, parameters });

const strategyBlocks: VisualStrategyBlock[] = [
  block("rsi", "RSI 反轉", "entry", "RSI 進入超賣區並反轉時進場。", [
    parameter("period", "RSI 週期", 14, 2, 100, 1),
    parameter("oversold", "超賣門檻", 30, 5, 50, 1),
  ]),
  block("macd", "MACD 動能", "entry", "MACD 快線上穿慢線時順勢進場。", [
    parameter("fastPeriod", "快線週期", 12, 2, 50, 1),
    parameter("slowPeriod", "慢線週期", 26, 5, 100, 1),
    parameter("signalPeriod", "訊號週期", 9, 2, 50, 1),
  ]),
  block("sma-cross", "SMA 均線交叉", "entry", "短期均線上穿長期均線時進場。", [
    parameter("shortPeriod", "短期均線", 20, 2, 100, 1),
    parameter("longPeriod", "長期均線", 60, 10, 300, 1),
  ]),
  block("bollinger-breakout", "布林通道突破", "entry", "價格突破布林通道上軌時進場。", [
    parameter("period", "通道週期", 20, 5, 100, 1),
    parameter("deviation", "標準差倍數", 2, 1, 4, 0.1),
  ]),
  block("grid", "網格交易", "entry", "在設定區間內分層低買高賣。", [
    parameter("gridCount", "網格數量", 10, 2, 50, 1),
    parameter("range", "網格區間", 10, 2, 40, 1, "%"),
  ]),
  block("dca", "定期定額", "entry", "依固定時間間隔分批建立部位。", [
    parameter("intervalDays", "投入間隔", 7, 1, 30, 1, "天"),
    parameter("drawdownBoost", "回撤加碼", 50, 0, 200, 5, "%"),
  ]),
  block("volume-confirmation", "成交量確認", "confirm", "成交量高於近期均量時確認訊號。", [
    parameter("period", "均量週期", 20, 2, 100, 1),
    parameter("multiplier", "量能倍數", 1.5, 1, 5, 0.1),
  ]),
  block("take-profit", "固定停利", "exit", "獲利達目標幅度時平倉。", [
    parameter("takeProfit", "停利", 8, 0.5, 1000, 0.5, "%"),
  ]),
  block("stop-loss", "固定停損", "risk", "虧損達限制幅度時平倉。", [
    parameter("stopLoss", "停損", 3, 0.5, 100, 0.5, "%"),
  ]),
  block("trailing-stop", "移動停損", "risk", "價格回撤達移動距離時保護獲利。", [
    parameter("trailingDistance", "追蹤距離", 4, 0.5, 20, 0.5, "%"),
  ]),
  block("fixed-position", "固定倉位", "position", "每次使用固定資金比例建立部位。", [
    parameter("positionSize", "倉位比例", 10, 1, 100, 1, "%"),
  ]),
  block("atr-sizing", "ATR 波動倉位", "position", "依 ATR 波動率動態調整倉位。", [
    parameter("atrPeriod", "ATR 週期", 14, 2, 100, 1),
    parameter("riskPerTrade", "單筆風險", 1, 0.1, 5, 0.1, "%"),
  ]),
  block("maximum-daily-loss", "每日最大虧損", "risk", "單日虧損達上限時停止交易。", [
    parameter("maximumDailyLoss", "每日虧損上限", 5, 0.5, 20, 0.5, "%"),
  ]),
];

const deepFreezeBlock = (strategy: VisualStrategyBlock): VisualStrategyBlock => {
  strategy.parameters.forEach(Object.freeze);
  Object.freeze(strategy.parameters);
  return Object.freeze(strategy);
};

export const VISUAL_STRATEGY_BLOCKS: readonly VisualStrategyBlock[] = Object.freeze(
  strategyBlocks.map(deepFreezeBlock),
);

export const cloneVisualStrategyBlock = (id: string): VisualStrategyBlock => {
  const strategy = VISUAL_STRATEGY_BLOCKS.find((candidate) => candidate.id === id);
  if (!strategy) throw new TypeError(`Unknown visual strategy block: ${id}`);
  return { ...strategy, parameters: strategy.parameters.map((item) => ({ ...item })) };
};
