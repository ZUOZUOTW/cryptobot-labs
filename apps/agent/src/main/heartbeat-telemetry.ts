import { createHash } from "node:crypto";

import type { DeploymentBundle } from "./deployment-client";
import type { LiveAccountEvidence } from "./live-account-service";
import type { PaperAccountSnapshot } from "./paper-evaluation-context";
import type { TelemetryEventEnvelope } from "./telemetry-buffer";

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 40);

export function createLiveHeartbeatTelemetry(input: { readonly evidence: LiveAccountEvidence; readonly markPrice: string;
  readonly bundle: DeploymentBundle; readonly sequence: number; readonly health: "healthy" | "paused" }): TelemetryEventEnvelope {
  const { evidence, bundle } = input; const position = evidence.portfolio.position;
  const mode = bundle.deployment.mode;
  if (mode !== "live" && mode !== "futures-demo") throw new TypeError("Private heartbeat requires a private deployment mode");
  const id = `heartbeat-${digest(`${bundle.deployment.id}:${bundle.deployment.version}:${input.sequence}`)}`;
  const positions = position ? [{ symbol: bundle.strategy.symbol, side: position.side, quantity: position.quantity,
    entryPrice: position.entryPrice, markPrice: input.markPrice, unrealizedPnl: evidence.risk.unrealizedDailyPnl,
    leverage: evidence.risk.leverage }] : [];
  const positionIds = position ? [`pos-${digest(`${bundle.deployment.id}:${bundle.strategy.symbol}:${position.side}`)}`] : [];
  return Object.freeze({ version: 1, id, type: "heartbeat", deploymentId: bundle.deployment.id,
    expectedDeploymentVersion: bundle.deployment.version, correlationId: id, occurredAt: evidence.observedAt,
    payload: { heartbeat: { deploymentId: bundle.deployment.id, sequence: input.sequence, occurredAt: evidence.observedAt,
      mode, state: "running", health: input.health, realizedDailyPnl: evidence.risk.realizedDailyPnl,
      unrealizedDailyPnl: evidence.risk.unrealizedDailyPnl, positions }, positionIds } });
}

export function createPaperHeartbeatTelemetry(input: { readonly account: PaperAccountSnapshot; readonly markPrice: string;
  readonly leverage: string; readonly observedAt: number; readonly bundle: DeploymentBundle; readonly sequence: number }): TelemetryEventEnvelope {
  const position = input.account.portfolio.position;
  const id = `heartbeat-${digest(`${input.bundle.deployment.id}:${input.bundle.deployment.version}:${input.sequence}`)}`;
  const positions = position ? [{ symbol: input.bundle.strategy.symbol, side: position.side, quantity: position.quantity,
    entryPrice: position.entryPrice, markPrice: input.markPrice, unrealizedPnl: input.account.risk.unrealizedDailyPnl,
    leverage: input.leverage }] : [];
  const positionIds = position ? [`pos-${digest(`${input.bundle.deployment.id}:${input.bundle.strategy.symbol}:${position.side}`)}`] : [];
  return Object.freeze({ version: 1, id, type: "heartbeat", deploymentId: input.bundle.deployment.id,
    expectedDeploymentVersion: input.bundle.deployment.version, correlationId: id, occurredAt: input.observedAt,
    payload: { heartbeat: { deploymentId: input.bundle.deployment.id, sequence: input.sequence, occurredAt: input.observedAt,
      mode: "paper", state: "running", health: "healthy", realizedDailyPnl: input.account.risk.realizedDailyPnl,
      unrealizedDailyPnl: input.account.risk.unrealizedDailyPnl, positions }, positionIds } });
}
