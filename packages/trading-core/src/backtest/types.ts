import type { HistoricalDataset } from "../datasets";
import type { Market, SignalAction, StrategyEvaluator } from "../contracts";

export type GapPolicy = "fail" | "disclose";
export type PositionSide = "long" | "short";
export type TradeExitReason = "signal" | "opposite-signal" | "end-of-data";

export interface FundingEvent {
  timestamp: number;
  rate: string;
  /** Exchange-observed mark at the funding timestamp; required to prevent lookahead. */
  markPrice: string;
}

export interface HistoricalBacktestRequest {
  dataset: HistoricalDataset;
  evaluator: StrategyEvaluator;
  initialCapital: string;
  feeRate: string;
  slippageRate: string;
  leverage: string;
  funding: readonly FundingEvent[];
  gapPolicy: GapPolicy;
  engineVersion: string;
  configHash: string;
  strategyHash: string;
}

export interface HistoricalTrade {
  side: PositionSide;
  entryTime: number;
  exitTime: number;
  entryPrice: string;
  exitPrice: string;
  quantity: string;
  entryFee: string;
  exitFee: string;
  fees: string;
  funding: string;
  realizedPnl: string;
  exitReason: TradeExitReason;
}

export interface EquityPoint {
  timestamp: number;
  equity: string;
  funding: string;
}

export interface SignalEvent {
  signalId: string;
  action?: SignalAction;
  evaluatedAt: number;
  executionTime?: number;
  status: "accepted" | "rejected";
  effect: "queued" | "opened" | "closed" | "held" | "ignored-end-of-data" | "none";
  reason: string;
}

export interface HistoricalBacktestMetrics {
  totalReturn: string;
  annualizedReturn: string;
  maxDrawdown: string;
  winRate: string;
  profitFactor: string | null;
  sharpe: string;
  trades: number;
}

export interface HistoricalBacktestProvenance {
  provider: string;
  dataSource: string;
  sourceKind: "public-api";
  requestedRange: { startTime?: number; endTime?: number };
  fetchedRange: { startTime: number; endTime: number };
  gaps: readonly { from: number; to: number }[];
  gapCount: number;
  duplicateCount: number;
  incompleteCount: number;
  complete: boolean;
  feeRate: string;
  slippageRate: string;
  fundingTreatment: {
    convention: "long-pays-positive-short-receives-positive";
    suppliedEvents: number;
    appliedEvents: number;
    netFunding: string;
  };
  market: Market;
  symbol: string;
  interval: string;
  engineVersion: string;
  configHash: string;
  strategyHash: string;
  datasetDigest: string;
}

export interface HistoricalBacktestResult {
  trades: readonly HistoricalTrade[];
  equityCurve: readonly EquityPoint[];
  signalEvents: readonly SignalEvent[];
  metrics: HistoricalBacktestMetrics;
  provenance: HistoricalBacktestProvenance;
}
