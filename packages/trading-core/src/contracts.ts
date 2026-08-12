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
  /** Explicit opt-in for layered strategies. Omitted preserves legacy behavior. */
  positionEffect?: "add" | "reduce";
  /** Fraction of the current position to close when positionEffect is reduce. */
  reductionRate?: number;
}

export interface StrategyPositionSnapshot {
  side: "long" | "short";
  entryTime?: number;
  entryPrice: string;
  peakPrice: string;
  troughPrice: string;
  quantity: string;
  usedMargin: string;
  layerCount: number;
}

export interface StrategyPortfolioSnapshot {
  equity: string;
  dayStartEquity: string;
  utcDay: string;
  dailyLossBreached?: boolean;
  availableEquity?: string;
  consecutiveLosses?: number;
  lastLossAt?: number;
  position?: Readonly<StrategyPositionSnapshot>;
}

export interface StrategyInput {
  candles: readonly Candle[];
  market: Market;
  symbol: string;
  now: number;
  timeframe?: string;
  leverage?: string;
  portfolio?: Readonly<StrategyPortfolioSnapshot>;
}

export interface StrategyEvaluator {
  evaluate(input: Readonly<StrategyInput>): Promise<StrategySignal>;
  /**
   * Historical engines normally preserve a run when one signal evaluation is
   * malformed. Sandboxed source code is untrusted executable input, so its
   * runtime/resource failures must invalidate the entire evidence run instead.
   */
  readonly evaluationErrorPolicy?: "reject-signal" | "abort-backtest";
  readonly maximumLookback?: number;
  readonly riskPolicy?: Readonly<{ maximumDailyLossRate?: number }>;
}
