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
}

export interface StrategyInput {
  candles: readonly Candle[];
  market: Market;
  symbol: string;
  now: number;
}

export interface StrategyEvaluator {
  evaluate(input: Readonly<StrategyInput>): Promise<StrategySignal>;
}
