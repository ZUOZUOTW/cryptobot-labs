import type { LogicMode, Market, RiskLevel, StrategyBlock, TradeDirection } from "./types";

export interface PublicStrategyMetrics {
  totalReturn: string;
  annualizedReturn: string;
  maxDrawdown: string;
  winRate: string;
  profitFactor: string | null;
  sharpe: string;
  trades: number;
}
export interface PublicStrategyEquityPoint {
  timestamp: number;
  equity: string;
}

export interface PublicStrategyPublication {
  slug: string;
  name: string;
  description: string;
  publisherName: string;
  weexReferralUrl: string | null;
  market: Market;
  symbol: string;
  timeframe: string;
  leverage: number;
  logicMode: LogicMode;
  tradeDirection: TradeDirection;
  /** Server-derived from immutable leverage and verified drawdown evidence. */
  risk?: RiskLevel;
  hasPrivateSource: boolean;
  blocks: StrategyBlock[];
  metrics: PublicStrategyMetrics;
  equityCurve: PublicStrategyEquityPoint[];
  actualStartAt: number | null;
  actualEndAt: number | null;
  publishedAt: number;
  updatedAt: number;
}

export function publicStrategyRisk(publication: Pick<PublicStrategyPublication, "leverage" | "metrics" | "risk">): RiskLevel {
  if (publication.risk) return publication.risk;
  const drawdown = Math.abs(Number(publication.metrics.maxDrawdown));
  if (publication.leverage >= 10 || drawdown >= 0.25) return "高";
  if (publication.leverage >= 3 || drawdown >= 0.12) return "中";
  return "低";
}
