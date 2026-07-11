import type { Candle, Market } from "./contracts";

export interface HistoricalCandleRequest {
  market: Market;
  symbol: string;
  interval: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface InstrumentRules {
  market: Market;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: string;
  stepSize: string;
  minimumQuantity: string;
  minimumNotional?: string;
  maximumLeverage?: string;
}

export interface CandleGap {
  from: number;
  to: number;
}

export interface DatasetValidation {
  duplicates: readonly number[];
  ordered: boolean;
  gaps: readonly CandleGap[];
  incompleteCount: number;
}

export interface HistoricalDatasetProvenance {
  provider: string;
  sourceKind: "public-api";
  endpoint: string;
  collectedAt: number;
  singleResponse: boolean;
  paginated: boolean;
  truncated: boolean;
  terminationReason?: string;
  requestedStartTime?: number;
  requestedEndTime?: number;
  returnedStartTime?: number;
  returnedEndTime?: number;
}

export interface HistoricalDataset {
  request: Readonly<HistoricalCandleRequest>;
  candles: readonly Candle[];
  intervalMs: number;
  complete: boolean;
  validation: DatasetValidation;
  provenance: HistoricalDatasetProvenance;
}
