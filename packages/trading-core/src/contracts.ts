export type Market = "spot" | "futures";
export type ExecutionMode = "paper" | "futures-demo" | "live";
export type SignalAction = "buy" | "sell" | "close" | "hold";

export interface Candle {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  complete: boolean;
}

export interface StrategySignal {
  id: string;
  action: SignalAction;
  reason: string;
  createdAt: number;
  /** Fraction of usable equity to allocate to a newly opened position. */
  allocationRate?: number;
}

export interface StrategyPositionSnapshot {
  side: "long" | "short";
  entryPrice: string;
  peakPrice: string;
  troughPrice: string;
  quantity: string;
}

export interface StrategyPortfolioSnapshot {
  equity: string;
  dayStartEquity: string;
  utcDay: string;
  position?: Readonly<StrategyPositionSnapshot>;
}

export interface StrategyInput {
  candles: readonly Candle[];
  market: Market;
  symbol: string;
  now: number;
  timeframe?: string;
  portfolio?: Readonly<StrategyPortfolioSnapshot>;
}

export interface StrategyEvaluator {
  evaluate(input: Readonly<StrategyInput>): Promise<StrategySignal>;
}
