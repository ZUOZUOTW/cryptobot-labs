import type { LogicMode, Market, StrategyBlock, TradeDirection } from "./types";

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
  weexReferralUrl: string;
  market: Market;
  symbol: string;
  timeframe: string;
  leverage: number;
  logicMode: LogicMode;
  tradeDirection: TradeDirection;
  hasPrivateSource: boolean;
  blocks: StrategyBlock[];
  metrics: PublicStrategyMetrics;
  equityCurve: PublicStrategyEquityPoint[];
  actualStartAt: number | null;
  actualEndAt: number | null;
  publishedAt: number;
  updatedAt: number;
}
