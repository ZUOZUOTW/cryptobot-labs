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
  "resume-live",
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
  leverage: string;
  fundingMode: "none" | "historical";
  gapPolicy: "fail" | "disclose";
}

export interface CommandCreateDto {
  deploymentId: string;
  type: CommandType;
  version: number;
  correlationId: string;
  expectedDeploymentVersion: number;
  payload: JsonObject;
}

export interface HeartbeatPositionDto {
  symbol: string;
  side: "long" | "short";
  quantity: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  leverage: string;
}

export interface HeartbeatDto {
  deploymentId: string;
  sequence: number;
  occurredAt: number;
  mode: RunMode;
  state: "running" | "paused" | "stopped" | "error";
  health: "healthy" | "degraded" | "paused";
  positions: HeartbeatPositionDto[];
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }
