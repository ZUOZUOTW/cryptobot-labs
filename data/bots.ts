import type { BotDefinition, Market, RiskLevel, StrategyBlock } from "../lib/types";

const DISCLAIMER = "模擬回測資料，不代表未來績效" as const;
const months = ["7月", "8月", "9月", "10月", "11月", "12月", "1月", "2月", "3月", "4月", "5月", "6月"];
const makeCurve = (values: number[]) => values.map((value, index) => ({ label: months[index], value }));
const makeBlocks = (seed: Seed): StrategyBlock[] => [
  { id: `${seed.id}-entry`, name: seed.tags[0], group: "entry", description: seed.explanation, parameters: [] },
  { id: `${seed.id}-stop-loss`, name: "固定停損", group: "risk", description: "價格觸及停損幅度時離場。", parameters: [{ key:"stopLoss", label:"停損", value: seed.market === "spot" ? 5 : 3, min:1, max:20, step:0.5, suffix:"%" }] },
];

type Seed = {
  id: string; name: string; market: Market; description: string; tags: string[];
  risk: RiskLevel; totalReturn: number; drawdown: number; winRate: number;
  sharpe: number; trades: number; stability: number; curve: number[];
  explanation: string; suitableFor: string; riskNote: string;
};

const makeBot = (seed: Seed): BotDefinition => ({
  id: seed.id,
  name: seed.name,
  exchange: "WEEX",
  market: seed.market,
  symbol: "BTCUSDT",
  timeframe: seed.market === "spot" ? "4h" : "1h",
  logicMode: "all",
  leverage: seed.market === "spot" ? 1 : 3,
  blocks: makeBlocks(seed),
  description: seed.description,
  tags: seed.tags,
  risk: seed.risk,
  metrics: {
    totalReturn: seed.totalReturn,
    annualizedReturn: Number((seed.totalReturn * 0.72).toFixed(1)),
    maxDrawdown: seed.drawdown,
    winRate: seed.winRate,
    profitFactor: Number((1.25 + seed.winRate / 100).toFixed(2)),
    sharpe: seed.sharpe,
    trades: seed.trades,
    runningDays: 365,
    stability: seed.stability,
  },
  equityCurve: makeCurve(seed.curve),
  explanation: seed.explanation,
  suitableFor: seed.suitableFor,
  riskNote: seed.riskNote,
  disclaimer: DISCLAIMER,
});

export const BOT_CATALOG: BotDefinition[] = [
  makeBot({ id:"orbit-dca", name:"Orbit DCA", market:"spot", description:"回撤時分批加碼的穩健定投策略", tags:["定投","回撤加碼"], risk:"低", totalReturn:48.6, drawdown:-12.4, winRate:64.2, sharpe:1.42, trades:82, stability:91, curve:[100,103,106,104,111,115,119,123,128,134,141,148.6], explanation:"依固定週期投入，價格回撤時提高投入比例。", suitableFor:"長期累積與低頻操作", riskNote:"單邊下跌時仍可能持續承受浮虧。" }),
  makeBot({ id:"grid-navigator", name:"Grid Navigator", market:"spot", description:"在震盪區間自動低買高賣", tags:["網格","震盪"], risk:"中", totalReturn:72.3, drawdown:-18.8, winRate:71.4, sharpe:1.67, trades:246, stability:86, curve:[100,108,105,116,122,118,131,139,145,151,163,172.3], explanation:"以價格區間建立多層買賣網格。", suitableFor:"橫盤與高流動性市場", riskNote:"突破網格區間時可能累積單向部位。" }),
  makeBot({ id:"golden-cross", name:"Golden Cross", market:"spot", description:"以長短均線掌握中期趨勢", tags:["均線","趨勢"], risk:"中", totalReturn:83.7, drawdown:-21.5, winRate:55.8, sharpe:1.51, trades:64, stability:82, curve:[100,98,107,114,109,126,139,132,149,158,174,183.7], explanation:"短均線上穿長均線時進場，反向交叉時離場。", suitableFor:"具有明確方向的波段行情", riskNote:"盤整期容易出現連續假訊號。" }),
  makeBot({ id:"rsi-rebound", name:"RSI Rebound", market:"spot", description:"捕捉超賣後的價格回彈", tags:["RSI","反轉"], risk:"中", totalReturn:61.9, drawdown:-16.1, winRate:67.9, sharpe:1.59, trades:118, stability:84, curve:[100,104,112,109,119,126,124,136,142,151,147,161.9], explanation:"RSI 進入超賣區並重新回升時分批進場。", suitableFor:"震盪或溫和多頭市場", riskNote:"強勢下跌時超賣狀態可能長時間持續。" }),
  makeBot({ id:"bollinger-pulse", name:"Bollinger Pulse", market:"spot", description:"追蹤波動壓縮後的方向突破", tags:["布林通道","突破"], risk:"中", totalReturn:91.2, drawdown:-23.2, winRate:52.1, sharpe:1.63, trades:76, stability:79, curve:[100,96,109,121,117,135,148,141,159,172,168,191.2], explanation:"通道收窄後，價格帶量突破上軌時進場。", suitableFor:"波動由低轉高的市場", riskNote:"假突破可能造成快速停損。" }),
  makeBot({ id:"momentum-forge", name:"Momentum Forge", market:"futures", description:"MACD 動能確認後順勢進場", tags:["MACD","動能"], risk:"高", totalReturn:126.4, drawdown:-31.8, winRate:58.6, sharpe:1.82, trades:154, stability:75, curve:[100,112,106,129,145,137,166,181,173,198,211,226.4], explanation:"以 MACD 柱體擴張與趨勢方向共同確認。", suitableFor:"有延續性的快速趨勢", riskNote:"槓桿會同時放大收益與損失。" }),
  makeBot({ id:"breakout-hunter", name:"Breakout Hunter", market:"futures", description:"區間突破後追蹤多空趨勢", tags:["突破","多空"], risk:"高", totalReturn:142.8, drawdown:-36.4, winRate:49.7, sharpe:1.74, trades:132, stability:69, curve:[100,91,118,137,129,159,151,186,176,205,224,242.8], explanation:"突破近期高低點後依方向建立部位。", suitableFor:"波動擴張與事件行情", riskNote:"跳空與假突破會增加滑價風險。" }),
  makeBot({ id:"atr-sentinel", name:"ATR Sentinel", market:"futures", description:"用波動率調整倉位與移動停損", tags:["ATR","移動停損"], risk:"中", totalReturn:108.5, drawdown:-24.7, winRate:54.9, sharpe:1.91, trades:103, stability:83, curve:[100,107,115,111,126,139,145,152,166,179,193,208.5], explanation:"依 ATR 設定倉位大小與移動停損距離。", suitableFor:"波動快速改變的趨勢市場", riskNote:"波動突然放大時仍可能超出預期停損。" }),
  makeBot({ id:"dual-side-ranger", name:"Dual-Side Ranger", market:"futures", description:"在定義區間內管理多空雙向部位", tags:["雙向","區間"], risk:"高", totalReturn:118.9, drawdown:-34.2, winRate:66.1, sharpe:1.55, trades:286, stability:71, curve:[100,114,109,126,121,143,158,151,177,189,203,218.9], explanation:"以區間中線與邊界管理多空進出。", suitableFor:"高流動性震盪市場", riskNote:"趨勢突破時雙向部位可能快速失衡。" }),
  makeBot({ id:"leverage-guardian", name:"Leverage Guardian", market:"futures", description:"低槓桿與嚴格回撤控制組合", tags:["低槓桿","風控"], risk:"中", totalReturn:86.6, drawdown:-17.9, winRate:61.3, sharpe:2.04, trades:94, stability:90, curve:[100,105,111,108,119,127,134,142,149,161,174,186.6], explanation:"限制槓桿、單筆風險與每日最大損失。", suitableFor:"重視風險調整報酬的使用者", riskNote:"風控會在快速反彈前提早退出部位。" }),
];
