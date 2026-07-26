export type Market = "spot" | "futures";
export type RiskLevel = "低" | "中" | "高";
export type StrategyGroup = "entry" | "confirm" | "exit" | "position" | "risk";
export type LogicMode = "all" | "any";
export type TradeDirection = "long" | "short" | "both";

export interface EquityPoint { label: string; value: number }
export interface BotMetrics {
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  sharpe: number;
  trades: number;
  runningDays: number;
  stability: number;
}
export interface StrategyParameter {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}
export interface StrategyBlock {
  id: string;
  name: string;
  group: StrategyGroup;
  description: string;
  parameters: StrategyParameter[];
}
export interface BotConfig {
  id: string;
  name: string;
  exchange: "WEEX";
  market: Market;
  symbol: string;
  timeframe: string;
  logicMode: LogicMode;
  /**
   * Explicit entry-side policy. Older saved strategies omit this field and
   * resolve to long-only for spot or both directions for futures.
   */
  tradeDirection?: TradeDirection;
  leverage: number;
  blocks: StrategyBlock[];
  source?: string;
}
export interface DirectionalBacktestMetrics {
  longTrades: number;
  shortTrades: number;
  longNetPnl: number;
  shortNetPnl: number;
}
export interface BacktestReport {
  seed: string;
  generatedAt: string;
  metrics: BotMetrics;
  equityCurve: EquityPoint[];
  disclaimer: PerformanceDisclaimer;
  evidence?: WeexHistoricalEvidence;
  directionalMetrics?: DirectionalBacktestMetrics;
}
export type PerformanceDisclaimer =
  | "模擬回測資料，不代表未來績效"
  | "WEEX 歷史行情回測，不代表未來績效";
export interface WeexHistoricalEvidence {
  level: "historical";
  provider: "WEEX";
  market: Market;
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  collectedAt: number;
  candleCount: number;
  complete: boolean;
  feeRate: string;
  slippageRate: string;
  fundingIncluded: boolean;
  datasetDigest: string;
  engineVersion: string;
}
export interface WeexHistoricalPerformance {
  metrics: BotMetrics;
  equityCurve: EquityPoint[];
  generatedAt: string;
  disclaimer: "WEEX 歷史行情回測，不代表未來績效";
  evidence: WeexHistoricalEvidence;
}
export interface BotDefinition extends BotConfig {
  description: string;
  tags: string[];
  risk: RiskLevel;
  metrics: BotMetrics;
  equityCurve: EquityPoint[];
  explanation: string;
  suitableFor: string;
  riskNote: string;
  disclaimer: PerformanceDisclaimer;
}
