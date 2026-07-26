import type { StrategyEvaluator } from "../contracts";

export type VisualStrategyGroup = "entry" | "confirm" | "exit" | "position" | "risk";
export type VisualLogicMode = "all" | "any";
export type VisualTradeDirection = "long" | "short" | "both";

export interface VisualStrategyParameter {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

export interface VisualStrategyBlock {
  id: string;
  name: string;
  group: VisualStrategyGroup;
  description: string;
  parameters: VisualStrategyParameter[];
}

export interface VisualBotConfig {
  id: string;
  name: string;
  exchange: "WEEX";
  market: "spot" | "futures";
  symbol: string;
  timeframe: string;
  logicMode: VisualLogicMode;
  /** Optional only for compatibility with strategy versions saved before direction controls existed. */
  tradeDirection?: VisualTradeDirection;
  leverage: number;
  blocks: VisualStrategyBlock[];
  source?: string;
}

export interface VisualStrategyEvaluator extends StrategyEvaluator {
  readonly config: Readonly<VisualBotConfig>;
  readonly maximumLookback: 1024;
  readonly riskPolicy: Readonly<{ maximumDailyLossRate?: number }>;
}
