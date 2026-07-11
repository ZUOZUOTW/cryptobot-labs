export const EVIDENCE_LEVELS = [
  "preview",
  "historical",
  "paper",
  "futures-demo",
  "live",
] as const;

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const RUN_MODES = ["paper", "futures-demo", "live"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const COMMAND_TYPES = [
  "deploy",
  "pause",
  "resume-paper",
  "request-live-unlock",
  "stop-new-orders",
  "cancel-open-orders",
  "close-positions",
  "revalidate-connection",
  "erase-local-credentials",
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

export interface BacktestJobCreateDto {
  strategyVersionId: string;
  market: "spot" | "futures";
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  initialCapital: string;
  feeRate: string;
  slippageRate: string;
}

export interface CommandCreateDto {
  deploymentId: string;
  type: CommandType;
  payload: JsonObject;
}

export interface HeartbeatPositionDto {
  symbol: string;
  quantity: string;
  markPrice: string;
}

export interface HeartbeatDto {
  deploymentId: string;
  sequence: number;
  occurredAt: number;
  mode: RunMode;
  health: "healthy" | "degraded" | "paused";
  positions: HeartbeatPositionDto[];
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }
