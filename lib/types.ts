export type Market = "spot" | "futures";
export type RiskLevel = "低" | "中" | "高";
export type StrategyGroup = "entry" | "confirm" | "exit" | "position" | "risk";
export type LogicMode = "all" | "any";

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
  leverage: number;
  blocks: StrategyBlock[];
  source?: string;
}
export interface BacktestReport {
  seed: string;
  generatedAt: string;
  metrics: BotMetrics;
  equityCurve: EquityPoint[];
  disclaimer: "模擬回測資料，不代表未來績效";
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
  disclaimer: "模擬回測資料，不代表未來績效";
}
