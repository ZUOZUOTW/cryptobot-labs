import type { BotDefinition, Market, RiskLevel, StrategyBlock } from "../lib/types";
import { cloneStrategyBlock } from "./strategies";

const DISCLAIMER = "模擬回測資料，不代表未來績效" as const;
const months = ["7月", "8月", "9月", "10月", "11月", "12月", "1月", "2月", "3月", "4月", "5月", "6月"];
const makeCurve = (values: number[]) => values.map((value, index) => ({ label: months[index], value }));
type BlockSeed = { id: string; parameters?: Record<string, number> };
const BOT_BLOCKS: Record<string, string[]> = {
  "orbit-dca": ["dca", "fixed-position", "maximum-daily-loss"],
  "grid-navigator": ["grid", "fixed-position", "stop-loss", "take-profit"],
  "golden-cross": ["sma-cross", "fixed-position", "stop-loss", "take-profit"],
  "rsi-rebound": ["rsi", "fixed-position", "stop-loss", "take-profit"],
  "bollinger-pulse": ["bollinger-breakout", "volume-confirmation", "stop-loss"],
  "momentum-forge": ["macd", "atr-sizing", "stop-loss"],
  "breakout-hunter": ["bollinger-breakout", "volume-confirmation", "trailing-stop"],
  "atr-sentinel": ["sma-cross", "atr-sizing", "trailing-stop"],
  "dual-side-ranger": ["grid", "atr-sizing", "stop-loss"],
  "leverage-guardian": ["macd", "atr-sizing", "maximum-daily-loss", "take-profit"],
};

const configuredBlock = ({ id, parameters = {} }: BlockSeed): StrategyBlock => {
  const strategy = cloneStrategyBlock(id);
  return {
    ...strategy,
    parameters: strategy.parameters.map((parameter) => ({
      ...parameter,
      value: parameters[parameter.key] ?? parameter.value,
    })),
  };
};

const makeBlocks = (seed: Seed): StrategyBlock[] => (
  seed.blocks?.map(configuredBlock) ?? (BOT_BLOCKS[seed.id] ?? []).map(cloneStrategyBlock)
);

type Seed = {
  id: string; name: string; market: Market; description: string; tags: string[];
  risk: RiskLevel; totalReturn: number; drawdown: number; winRate: number;
  sharpe: number; trades: number; stability: number; curve: number[];
  explanation: string; suitableFor: string; riskNote: string;
  annualizedReturn?: number; profitFactor?: number; runningDays?: number;
  timeframe?: string; logicMode?: "all" | "any"; leverage?: number; blocks?: BlockSeed[];
};

const makeBot = (seed: Seed): BotDefinition => ({
  id: seed.id,
  name: seed.name,
  exchange: "WEEX",
  market: seed.market,
  symbol: "BTCUSDT",
  timeframe: seed.timeframe ?? (seed.market === "spot" ? "4h" : "1h"),
  logicMode: seed.logicMode ?? "all",
  leverage: seed.market === "spot" ? 1 : (seed.leverage ?? 3),
  blocks: makeBlocks(seed),
  description: seed.description,
  tags: seed.tags,
  risk: seed.risk,
  metrics: {
    totalReturn: seed.totalReturn,
    annualizedReturn: seed.annualizedReturn ?? Number((seed.totalReturn * 0.72).toFixed(1)),
    maxDrawdown: seed.drawdown,
    winRate: seed.winRate,
    profitFactor: seed.profitFactor ?? Number((1.25 + seed.winRate / 100).toFixed(2)),
    sharpe: seed.sharpe,
    trades: seed.trades,
    runningDays: seed.runningDays ?? 365,
    stability: seed.stability,
  },
  equityCurve: makeCurve(seed.curve),
  explanation: seed.explanation,
  suitableFor: seed.suitableFor,
  riskNote: seed.riskNote,
  disclaimer: DISCLAIMER,
});

export const BOT_CATALOG: BotDefinition[] = [
  makeBot({ id:"orbit-dca", name:"軌道定投", market:"spot", description:"短週期定投搭配 RSI 回撤濾網", tags:["定投","RSI"], risk:"低", totalReturn:2.42, annualizedReturn:33.83, drawdown:-5.67, winRate:80, profitFactor:1.65, sharpe:1.52, trades:10, runningDays:30, stability:82.65, logicMode:"any", curve:[100,100.4,99.2,100.8,101.5,100.3,101.2,100.7,101.8,101.4,102.1,102.42], blocks:[{id:"dca",parameters:{intervalDays:2,drawdownBoost:100}},{id:"rsi",parameters:{period:8,oversold:30}},{id:"fixed-position",parameters:{positionSize:10}},{id:"stop-loss",parameters:{stopLoss:3}},{id:"take-profit",parameters:{takeProfit:5}}], explanation:"每兩日定投，或八期 RSI 離開超賣區時建立現貨部位。", suitableFor:"希望維持交易活躍度的現貨累積策略", riskNote:"定投無法避免長期單邊下跌造成的浮虧。" }),
  makeBot({ id:"grid-navigator", name:"網格領航員", market:"spot", description:"窄幅網格結合 RSI 與定投補充訊號", tags:["網格","RSI","定投"], risk:"中", totalReturn:1.55, annualizedReturn:20.63, drawdown:-5.9, winRate:80.95, profitFactor:1.29, sharpe:1, trades:42, runningDays:30, stability:82.04, logicMode:"any", curve:[100,100.3,99.5,100.6,100.9,99.8,100.7,100.4,101.1,100.8,101.3,101.55], blocks:[{id:"grid",parameters:{gridCount:8,range:2}},{id:"rsi",parameters:{period:8,oversold:30}},{id:"dca",parameters:{intervalDays:2,drawdownBoost:100}},{id:"fixed-position",parameters:{positionSize:10}},{id:"stop-loss",parameters:{stopLoss:3}},{id:"take-profit",parameters:{takeProfit:5}}], explanation:"八層窄網格為主，並由 RSI 反轉與定投訊號提高成交機會。", suitableFor:"高流動性且來回震盪的現貨行情", riskNote:"價格脫離網格區間時可能累積單向部位。" }),
  makeBot({ id:"golden-cross", name:"黃金交叉", market:"spot", description:"均線趨勢搭配 RSI 與定投輔助觸發", tags:["均線","RSI","趨勢"], risk:"中", totalReturn:1.92, annualizedReturn:25.97, drawdown:-5.99, winRate:53.85, profitFactor:1.44, sharpe:1.21, trades:13, runningDays:30, stability:82.62, logicMode:"any", curve:[100,100.2,99.4,100.5,101.1,100,100.8,100.4,101.3,100.9,101.6,101.92], blocks:[{id:"sma-cross",parameters:{shortPeriod:8,longPeriod:21}},{id:"rsi",parameters:{period:8,oversold:30}},{id:"dca",parameters:{intervalDays:2,drawdownBoost:100}},{id:"fixed-position",parameters:{positionSize:10}},{id:"stop-loss",parameters:{stopLoss:3}},{id:"take-profit",parameters:{takeProfit:5}}], explanation:"8／21 均線、RSI 反轉或定投訊號任一成立即可建立現貨部位。", suitableFor:"趨勢與震盪交替的現貨市場", riskNote:"採任一訊號觸發會增加盤整期雜訊交易。" }),
  makeBot({ id:"rsi-rebound", name:"RSI 反彈獵手", market:"spot", description:"快速 RSI 反轉搭配定期進場", tags:["RSI","反轉","定投"], risk:"中", totalReturn:2.42, annualizedReturn:33.83, drawdown:-5.67, winRate:80, profitFactor:1.65, sharpe:1.52, trades:10, runningDays:30, stability:82.65, logicMode:"any", curve:[100,100.1,99.1,100.5,101.2,100.1,101.4,100.8,101.7,101.3,102,102.42], blocks:[{id:"rsi",parameters:{period:8,oversold:30}},{id:"dca",parameters:{intervalDays:2,drawdownBoost:100}},{id:"fixed-position",parameters:{positionSize:10}},{id:"stop-loss",parameters:{stopLoss:3}},{id:"take-profit",parameters:{takeProfit:5}}], explanation:"八期 RSI 離開超賣區，或每兩日定期訊號出現時分批進場。", suitableFor:"震盪或溫和多頭的現貨行情", riskNote:"強勢下跌時 RSI 可能長時間停留在超賣區。" }),
  makeBot({ id:"bollinger-pulse", name:"布林脈衝", market:"spot", description:"快速布林突破搭配定投維持活躍度", tags:["布林通道","突破","定投"], risk:"中", totalReturn:2.53, annualizedReturn:35.59, drawdown:-3.35, winRate:20, profitFactor:1.98, sharpe:2.09, trades:10, runningDays:30, stability:80.65, logicMode:"any", curve:[100,100.5,99.8,101,101.6,100.9,101.8,101.2,102,101.7,102.3,102.53], blocks:[{id:"bollinger-breakout",parameters:{period:10,deviation:2}},{id:"dca",parameters:{intervalDays:3,drawdownBoost:100}},{id:"fixed-position",parameters:{positionSize:20}},{id:"stop-loss",parameters:{stopLoss:3}},{id:"take-profit",parameters:{takeProfit:5}}], explanation:"十期布林通道突破或三日定投訊號任一出現時建立現貨部位。", suitableFor:"波動壓縮後擴張的現貨市場", riskNote:"勝率較低，績效仰賴少數較大的突破獲利。" }),
  makeBot({ id:"momentum-forge", name:"動能鍛造者", market:"futures", description:"MACD 與短均線任一觸發的 15 倍動能策略", tags:["MACD","均線","15x"], risk:"高", totalReturn:33.15, annualizedReturn:3156.32, drawdown:-39.08, winRate:57.14, profitFactor:1.35, sharpe:2.83, trades:14, runningDays:30, stability:59.65, leverage:15, logicMode:"any", curve:[100,108,104,118,113,126,109,121,116,130,127,133.15], blocks:[{id:"macd",parameters:{fastPeriod:5,slowPeriod:13,signalPeriod:4}},{id:"sma-cross",parameters:{shortPeriod:3,longPeriod:10}},{id:"fixed-position",parameters:{positionSize:30}},{id:"stop-loss",parameters:{stopLoss:2}},{id:"take-profit",parameters:{takeProfit:3}}], explanation:"快速 MACD 或 3／10 均線出現方向訊號時，以 15 倍槓桿建立多空部位。", suitableFor:"方向快速切換且動能明確的日內行情", riskNote:"任一訊號即可觸發，假訊號密集時回撤可能快速擴大。" }),
  makeBot({ id:"breakout-hunter", name:"突破獵手", market:"futures", description:"布林突破與 MACD 雙觸發的 6 倍策略", tags:["布林通道","MACD","6x"], risk:"高", totalReturn:57.29, annualizedReturn:24629.3, drawdown:-26.72, winRate:72.73, profitFactor:2.39, sharpe:5.06, trades:11, runningDays:30, stability:68.57, leverage:6, logicMode:"any", curve:[100,112,106,125,119,137,128,145,139,151,146,157.29], blocks:[{id:"bollinger-breakout",parameters:{period:8,deviation:1.5}},{id:"macd",parameters:{fastPeriod:5,slowPeriod:13,signalPeriod:4}},{id:"fixed-position",parameters:{positionSize:50}},{id:"stop-loss",parameters:{stopLoss:2}},{id:"take-profit",parameters:{takeProfit:3}}], explanation:"快速布林突破或 MACD 動能任一成立時，以較大倉位追蹤多空方向。", suitableFor:"波動擴張與事件驅動的短線行情", riskNote:"50% 倉位即使使用 6 倍槓桿，急行情仍可能造成顯著回撤。" }),
  makeBot({ id:"atr-sentinel", name:"ATR 哨兵", market:"futures", description:"均線與網格觸發、ATR 控倉的 15 倍策略", tags:["ATR","均線","15x"], risk:"高", totalReturn:5.37, annualizedReturn:88.97, drawdown:-22.85, winRate:36.11, profitFactor:1.1, sharpe:1.16, trades:36, runningDays:30, stability:68.53, leverage:15, logicMode:"any", curve:[100,102,98,104,101,106,99,103,101,106,104,105.37], blocks:[{id:"sma-cross",parameters:{shortPeriod:5,longPeriod:15}},{id:"grid",parameters:{gridCount:5,range:6}},{id:"atr-sizing",parameters:{atrPeriod:14,riskPerTrade:0.5}},{id:"stop-loss",parameters:{stopLoss:1.5}},{id:"take-profit",parameters:{takeProfit:2}}], explanation:"5／15 均線或寬網格訊號觸發後，以 ATR 風險預算動態決定倉位。", suitableFor:"波動快速改變且仍有區間結構的行情", riskNote:"勝率較低且使用 15 倍槓桿，需嚴守 1.5% 停損。" }),
  makeBot({ id:"dual-side-ranger", name:"雙向遊騎兵", market:"futures", description:"兩層密集網格搭配 15 倍槓桿追蹤多空", tags:["網格","雙向","15x"], risk:"高", totalReturn:46.46, annualizedReturn:10280.27, drawdown:-26.33, winRate:61.54, profitFactor:1.78, sharpe:3.94, trades:13, runningDays:30, stability:59.99, leverage:15, logicMode:"all", curve:[100,103,111,107,120,116,129,122,136,131,143,146.46], blocks:[{id:"grid",parameters:{gridCount:2,range:2}},{id:"fixed-position",parameters:{positionSize:30}},{id:"trailing-stop",parameters:{trailingDistance:3}},{id:"maximum-daily-loss",parameters:{maximumDailyLoss:8}}], explanation:"在 2% 區間配置兩層網格，以 30% 倉位和移動停損管理雙向波段。", suitableFor:"震盪後容易延伸短波段的高流動性行情", riskNote:"30% 倉位搭配 15 倍槓桿非常積極，需遵守單日停手機制。" }),
  makeBot({ id:"leverage-guardian", name:"槓桿守護者", market:"futures", description:"RSI 與 MACD 雙核心的 15 倍風控策略", tags:["RSI","MACD","風控","15x"], risk:"高", totalReturn:5.35, annualizedReturn:88.54, drawdown:-37.48, winRate:56.25, profitFactor:1.09, sharpe:1.14, trades:16, runningDays:30, stability:68.14, leverage:15, logicMode:"any", curve:[100,103,97,108,116,94,101,91,99,96,104,105.35], blocks:[{id:"rsi",parameters:{period:8,oversold:30}},{id:"macd",parameters:{fastPeriod:8,slowPeriod:21,signalPeriod:5}},{id:"fixed-position",parameters:{positionSize:20}},{id:"stop-loss",parameters:{stopLoss:2}},{id:"take-profit",parameters:{takeProfit:3}}], explanation:"八期 RSI 或快速 MACD 任一出現方向訊號時，以 20% 倉位建立多空部位。", suitableFor:"反轉與動能訊號交替主導的日內行情", riskNote:"15 倍槓桿仍可能放大雜訊損失，近期最大回撤偏高。" }),
  makeBot({ id:"quantum-grid-assault", name:"量子網格急襲", market:"futures", description:"以極窄八層網格捕捉高頻雙向波動", tags:["網格","高頻","15x"], risk:"高", totalReturn:47.3, annualizedReturn:11031.38, drawdown:-34.79, winRate:57.64, profitFactor:1.5, sharpe:3.37, trades:144, runningDays:30, stability:58.38, leverage:15, curve:[100,106,97,114,126,110,132,118,139,128,151,147.3], blocks:[{id:"grid",parameters:{gridCount:8,range:2}},{id:"fixed-position",parameters:{positionSize:10}},{id:"stop-loss",parameters:{stopLoss:3}},{id:"take-profit",parameters:{takeProfit:5}}], explanation:"價格每跨越窄網格即分層反向交易，搭配 3% 停損與 5% 停利。", suitableFor:"高流動性、來回震盪頻繁的短線行情", riskNote:"15 倍槓桿與高交易頻率會放大費用、滑價及急行情損失。" }),
  makeBot({ id:"compressed-grid-striker", name:"壓縮網格突擊", market:"futures", description:"兩層壓縮網格配合移動停損追擊波段", tags:["網格","移動停損","15x"], risk:"高", totalReturn:46.46, annualizedReturn:10280.27, drawdown:-26.33, winRate:61.54, profitFactor:1.78, sharpe:3.94, trades:13, runningDays:30, stability:59.99, leverage:15, curve:[100,103,111,107,120,116,129,122,136,131,143,146.46], blocks:[{id:"grid",parameters:{gridCount:2,range:2}},{id:"fixed-position",parameters:{positionSize:30}},{id:"trailing-stop",parameters:{trailingDistance:3}},{id:"maximum-daily-loss",parameters:{maximumDailyLoss:8}}], explanation:"以兩層密集網格建立較大部位，再用 3% 移動停損保留延伸行情。", suitableFor:"震盪後容易出現短波段延伸的市場", riskNote:"30% 倉位搭配 15 倍槓桿非常積極，需嚴守單日停手機制。" }),
  makeBot({ id:"dual-average-turbo", name:"雙均動能渦輪", market:"futures", description:"MACD 與短均線任一觸發即進場的高速動能策略", tags:["MACD","均線","15x"], risk:"高", totalReturn:33.15, annualizedReturn:3156.32, drawdown:-39.08, winRate:57.14, profitFactor:1.35, sharpe:2.83, trades:14, runningDays:30, stability:59.65, leverage:15, logicMode:"any", curve:[100,108,104,118,113,126,109,121,116,130,127,133.15], blocks:[{id:"macd",parameters:{fastPeriod:5,slowPeriod:13,signalPeriod:4}},{id:"sma-cross",parameters:{shortPeriod:3,longPeriod:10}},{id:"fixed-position",parameters:{positionSize:30}},{id:"stop-loss",parameters:{stopLoss:2}},{id:"take-profit",parameters:{takeProfit:3}}], explanation:"快速 MACD 或 3／10 均線出現方向訊號時立即建立多空部位。", suitableFor:"方向快速切換且動能明確的日內行情", riskNote:"任一訊號即可觸發，假訊號密集時回撤可能快速擴大。" }),
  makeBot({ id:"rsi-velocity-counter", name:"極速 RSI 反擊", market:"futures", description:"以六期 RSI 捕捉極端區反轉並快速出場", tags:["RSI","反轉","15x"], risk:"高", totalReturn:29.94, annualizedReturn:2320.28, drawdown:-38.72, winRate:57.14, profitFactor:1.42, sharpe:2.69, trades:14, runningDays:30, stability:60.41, leverage:15, curve:[100,107.24,101.79,109.91,127.53,89.84,90.93,95.93,91.13,88.7,100.07,129.94], blocks:[{id:"rsi",parameters:{period:6,oversold:25}},{id:"fixed-position",parameters:{positionSize:30}},{id:"stop-loss",parameters:{stopLoss:2}},{id:"take-profit",parameters:{takeProfit:3}}], explanation:"六期 RSI 離開 25／75 極端區時反向切入，使用 2% 停損與 3% 停利。", suitableFor:"急跌急彈、均值回歸明顯的短線市場", riskNote:"高曝險反轉交易在單邊趨勢中可能連續停損。" }),
  makeBot({ id:"wide-grid-cruiser", name:"寬域網格巡弋", market:"futures", description:"八層寬幅網格兼顧活躍度與回撤控制", tags:["網格","區間","10x"], risk:"高", totalReturn:15.21, annualizedReturn:460.12, drawdown:-12.33, winRate:65.38, profitFactor:1.59, sharpe:3.28, trades:26, runningDays:30, stability:75.98, leverage:10, curve:[100,102,105,103,108,106,111,109,113,112,116,115.21], blocks:[{id:"grid",parameters:{gridCount:8,range:6}},{id:"fixed-position",parameters:{positionSize:10}},{id:"trailing-stop",parameters:{trailingDistance:3}},{id:"maximum-daily-loss",parameters:{maximumDailyLoss:8}}], explanation:"在 6% 寬幅區間配置八層網格，並以移動停損處理區間突破。", suitableFor:"中高波動但仍維持區間結構的行情", riskNote:"突破後若快速反抽，網格與移動停損可能同時產生損耗。" }),
  makeBot({ id:"rsi-trailing-cheetah", name:"RSI 追蹤獵豹", market:"futures", description:"快速 RSI 反轉後以移動停損追蹤延伸", tags:["RSI","移動停損","8x"], risk:"高", totalReturn:11.8, annualizedReturn:288.43, drawdown:-16.62, winRate:45.45, profitFactor:1.52, sharpe:2.1, trades:11, runningDays:30, stability:75.09, leverage:8, curve:[100,103.24,111.13,106.33,108.19,114.75,107.77,108.61,116.98,105.1,113.95,111.8], blocks:[{id:"rsi",parameters:{period:6,oversold:30}},{id:"fixed-position",parameters:{positionSize:25}},{id:"trailing-stop",parameters:{trailingDistance:3}},{id:"maximum-daily-loss",parameters:{maximumDailyLoss:8}}], explanation:"六期 RSI 離開超買超賣區後進場，讓 3% 移動停損決定離場。", suitableFor:"反轉後常延伸成小波段的活躍市場", riskNote:"勝率低於五成，績效依賴少數較大的趨勢獲利。" }),
  makeBot({ id:"rsi-flash-break", name:"RSI 快閃斷點", market:"futures", description:"八期 RSI 配合緊停損停利的高曝險反轉", tags:["RSI","短線","10x"], risk:"高", totalReturn:7.75, annualizedReturn:147.87, drawdown:-37.46, winRate:56.25, profitFactor:1.12, sharpe:1.36, trades:16, runningDays:30, stability:68.18, leverage:10, curve:[100,104.44,99.13,104.5,120.25,94.83,95.61,96.94,81.42,81.66,90.46,107.75], blocks:[{id:"rsi",parameters:{period:8,oversold:30}},{id:"fixed-position",parameters:{positionSize:30}},{id:"stop-loss",parameters:{stopLoss:2}},{id:"take-profit",parameters:{takeProfit:3}}], explanation:"八期 RSI 反轉即用 30% 倉位進場，採 2% 停損與 3% 停利。", suitableFor:"訊號密集且反轉幅度足以覆蓋成本的市場", riskNote:"近期最大回撤偏高，必須先以模擬確認可承受性。" }),
  makeBot({ id:"rsi-deep-zone-reversal", name:"RSI 深區逆襲", market:"futures", description:"較慢 RSI 深區反轉兼顧訊號數與方向過濾", tags:["RSI","深區反轉","10x"], risk:"高", totalReturn:7.54, annualizedReturn:142.05, drawdown:-37.5, winRate:50, profitFactor:1.11, sharpe:1.36, trades:18, runningDays:30, stability:68.62, leverage:10, curve:[100,103.4,99,104.38,119.79,86.72,89.16,101.03,87.36,82.53,90.6,107.54], blocks:[{id:"rsi",parameters:{period:10,oversold:35}},{id:"fixed-position",parameters:{positionSize:30}},{id:"stop-loss",parameters:{stopLoss:2}},{id:"take-profit",parameters:{takeProfit:3}}], explanation:"十期 RSI 重新穿越 35／65 時進場，以較寬的反轉區提高交易機會。", suitableFor:"震盪區間較寬、反轉節奏穩定的市場", riskNote:"高倉位與較寬訊號區可能在趨勢行情中累積多次損失。" }),
  makeBot({ id:"short-ma-windrunner", name:"短均線追風者", market:"futures", description:"五與十五期均線交叉搭配移動風控", tags:["均線","趨勢","15x"], risk:"高", totalReturn:6.69, annualizedReturn:119.92, drawdown:-22.66, winRate:50, profitFactor:1.23, sharpe:1.34, trades:10, runningDays:30, stability:72.88, leverage:15, curve:[100,101.86,110.75,106.98,107.36,101.98,99.65,98.73,107.19,97.39,106.46,106.69], blocks:[{id:"sma-cross",parameters:{shortPeriod:5,longPeriod:15}},{id:"fixed-position",parameters:{positionSize:15}},{id:"trailing-stop",parameters:{trailingDistance:3}},{id:"maximum-daily-loss",parameters:{maximumDailyLoss:8}}], explanation:"5／15 均線交叉建立方向部位，使用移動停損保留趨勢空間。", suitableFor:"短週期方向明確、交叉訊號不過度反覆的行情", riskNote:"交易數位於門檻下緣，盤整期可能出現連續假交叉。" }),
  makeBot({ id:"rsi-macd-twin-core", name:"RSI-MACD 雙核", market:"futures", description:"RSI 或 MACD 任一反轉即可啟動的雙核策略", tags:["RSI","MACD","15x"], risk:"高", totalReturn:5.35, annualizedReturn:88.54, drawdown:-37.48, winRate:56.25, profitFactor:1.09, sharpe:1.14, trades:16, runningDays:30, stability:68.14, leverage:15, logicMode:"any", curve:[100,103,97,108,116,94,101,91,99,96,104,105.35], blocks:[{id:"rsi",parameters:{period:8,oversold:30}},{id:"macd",parameters:{fastPeriod:8,slowPeriod:21,signalPeriod:5}},{id:"fixed-position",parameters:{positionSize:20}},{id:"stop-loss",parameters:{stopLoss:2}},{id:"take-profit",parameters:{takeProfit:3}}], explanation:"八期 RSI 或快速 MACD 任一出現方向訊號時建立多空部位。", suitableFor:"反轉與動能訊號交替主導的日內行情", riskNote:"雙訊號採任一觸發會提高交易頻率，也會增加雜訊曝險。" }),
];
