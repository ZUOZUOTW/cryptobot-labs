export type RunMode = "paper" | "futures-demo" | "live";
export type RunState = "stopped" | "running" | "paused" | "error";
export type RunHealth = "healthy" | "degraded" | "paused" | null;

export interface RiskPolicy {
  id: string;
  allowedSymbols: string[];
  maxOrderNotional: string;
  maxPositionNotional: string;
  maxTotalExposure: string;
  maxSimultaneousPositions: number;
  maxDailyLoss: string;
  maxLeverage: string;
  maxSlippageBps: number;
  minSignalCooldownMs: number;
  maxConsecutiveFailures: number;
  operationMode: "approval-required" | "automatic";
}

export interface RunPosition {
  symbol: string;
  side: "long" | "short";
  quantity: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  leverage: string;
}

export interface RunOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  state: string;
  quantity: string;
  price: string | null;
}

export interface RunSignal {
  action: "enter" | "exit" | "hold";
  reason: string;
  occurredAt: number;
  expectedDeploymentVersion: number;
}

export interface RiskBlock {
  code: string;
  reason: string;
  occurredAt: number;
  expectedDeploymentVersion: number;
}

export interface RunView {
  id: string;
  botName: string;
  market: "spot" | "futures";
  mode: RunMode;
  state: RunState;
  health: RunHealth;
  pnl: string | null;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  positions: RunPosition[];
  openOrders: RunOrder[];
  lastSignal: RunSignal | null;
  riskBlocks: RiskBlock[];
  evidence: {
    heartbeatOccurredAt: number | null;
    heartbeatExpectedDeploymentVersion: number | null;
    pnlSource: "heartbeat-account" | null;
  };
  device: { id: string };
  strategyVersion: { id: string };
  version: number;
  updatedAt: number;
  riskPolicy: RiskPolicy;
}

export const MODE_LABEL: Record<RunMode, string> = {
  paper: "模擬運行（預設）",
  "futures-demo": "WEEX 合約模擬",
  live: "實盤運行",
};
