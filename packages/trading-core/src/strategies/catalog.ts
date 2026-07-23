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
  block("ema-cross", "EMA 指數均線交叉", "entry", "以反應較快的指數均線捕捉趨勢轉折。", [
    parameter("shortPeriod", "短期 EMA", 12, 2, 100, 1),
    parameter("longPeriod", "長期 EMA", 26, 5, 300, 1),
  ]),
  block("stochastic", "KD 隨機指標", "entry", "KD 在超賣區黃金交叉時尋找反彈機會。", [
    parameter("kPeriod", "K 值週期", 14, 3, 100, 1),
    parameter("dPeriod", "D 值平滑", 3, 2, 20, 1),
    parameter("oversold", "超賣門檻", 20, 5, 40, 1),
  ]),
  block("donchian-breakout", "唐奇安通道突破", "entry", "價格突破近期最高或最低區間時順勢進場。", [
    parameter("period", "通道週期", 20, 5, 100, 1),
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
  block("cci-rebound", "CCI 順勢反彈", "entry", "CCI 從超賣區回升時尋找進場機會。", [parameter("period", "CCI 週期", 20, 5, 100, 1), parameter("oversold", "超賣門檻", -100, -250, -50, 10)]),
  block("williams-r-rebound", "Williams %R 反彈", "entry", "Williams %R 離開超賣區時進場。", [parameter("period", "指標週期", 14, 3, 100, 1), parameter("oversold", "超賣門檻", -80, -95, -50, 1)]),
  block("roc-momentum", "ROC 價格動能", "entry", "價格變動率突破動能門檻時進場。", [parameter("period", "ROC 週期", 12, 2, 100, 1), parameter("threshold", "動能門檻", 1, -10, 20, 0.5, "%")]),
  block("ichimoku-breakout", "一目均衡表突破", "entry", "價格突破雲層且轉換線高於基準線時進場。", [parameter("conversionPeriod", "轉換線週期", 9, 2, 50, 1), parameter("basePeriod", "基準線週期", 26, 5, 100, 1), parameter("spanPeriod", "雲層週期", 52, 10, 200, 1)]),
  block("supertrend-reversal", "Supertrend 趨勢翻轉", "entry", "價格突破 ATR 趨勢帶時順勢進場。", [parameter("atrPeriod", "ATR 週期", 10, 3, 100, 1), parameter("multiplier", "波動倍數", 3, 1, 10, 0.5)]),
  block("parabolic-sar", "拋物線 SAR 翻轉", "entry", "價格穿越拋物線 SAR 時判斷趨勢翻轉。", [parameter("acceleration", "加速因子", 0.02, 0.01, 0.1, 0.01), parameter("maximumAcceleration", "最大加速", 0.2, 0.1, 0.5, 0.05)]),
  block("vwap-reclaim", "VWAP 均價收復", "entry", "價格重新站上成交量加權平均價時進場。", [parameter("period", "VWAP 週期", 20, 3, 200, 1)]),
  block("mfi-rebound", "MFI 資金流反彈", "entry", "資金流量指標從超賣區回升時進場。", [parameter("period", "MFI 週期", 14, 3, 100, 1), parameter("oversold", "超賣門檻", 20, 5, 40, 1)]),
  block("obv-breakout", "OBV 能量潮突破", "entry", "OBV 突破近期高低區間時跟隨量價趨勢。", [parameter("period", "突破週期", 20, 5, 100, 1)]),
  block("price-action-breakout", "價格行為突破", "entry", "價格突破近期高低點並保留緩衝時進場。", [parameter("lookback", "回看週期", 20, 5, 100, 1), parameter("buffer", "突破緩衝", 0.2, 0, 5, 0.1, "%")]),
  block("direct-confirmation", "直接確認", "confirm", "進場時機成立後直接通過確認，不加入額外條件。", []),
  block("volume-confirmation", "成交量確認", "confirm", "成交量高於近期均量時確認訊號。", [
    parameter("period", "均量週期", 20, 2, 100, 1),
    parameter("multiplier", "量能倍數", 1.5, 1, 5, 0.1),
  ]),
  block("adx-confirmation", "ADX 趨勢強度", "confirm", "只在趨勢強度達到門檻時確認進場訊號。", [
    parameter("period", "ADX 週期", 14, 3, 50, 1),
    parameter("minimumStrength", "趨勢強度門檻", 25, 10, 50, 1),
  ]),
  block("atr-volatility-confirmation", "ATR 波動確認", "confirm", "只在市場波動度達到門檻時確認訊號。", [
    parameter("period", "ATR 週期", 14, 3, 100, 1),
    parameter("minimumVolatility", "最低波動率", 1, 0.1, 10, 0.1, "%"),
  ]),
  block("bollinger-bandwidth-confirmation", "布林帶寬確認", "confirm", "只在布林帶寬擴張至門檻時確認訊號。", [
    parameter("period", "通道週期", 20, 5, 100, 1),
    parameter("deviation", "標準差倍數", 2, 1, 4, 0.1),
    parameter("minimumBandwidth", "最低帶寬", 3, 0.5, 20, 0.5, "%"),
  ]),
  block("take-profit", "固定停利", "exit", "獲利達目標幅度時平倉。", [
    parameter("takeProfit", "停利", 8, 0.5, 1000, 0.5, "%"),
  ]),
  block("atr-take-profit", "ATR 動態停利", "exit", "依市場波動幅度動態設定獲利目標。", [
    parameter("atrPeriod", "ATR 週期", 14, 3, 100, 1),
    parameter("atrMultiple", "ATR 倍數", 3, 0.5, 10, 0.5),
  ]),
  block("rsi-profit-exit", "RSI 動能離場", "exit", "RSI 進入過熱區時鎖定獲利離場。", [
    parameter("period", "RSI 週期", 14, 2, 100, 1),
    parameter("overbought", "過熱門檻", 70, 50, 95, 1),
    parameter("minimumProfit", "最低獲利", 1, 0, 20, 0.5, "%"),
  ]),
  block("timed-profit-exit", "持倉時間停利", "exit", "持倉達指定時間且已有獲利時離場。", [
    parameter("holdingHours", "持倉時間", 24, 1, 720, 1, "小時"),
    parameter("minimumProfit", "最低獲利", 1, 0, 20, 0.5, "%"),
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
  block("consecutive-loss-pause", "連敗暫停交易", "risk", "連續虧損達指定次數後暫停建立新部位。", [
    parameter("lossCount", "連敗次數", 3, 2, 20, 1, "次"),
    parameter("pauseHours", "停止時間", 24, 1, 720, 1, "小時"),
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
