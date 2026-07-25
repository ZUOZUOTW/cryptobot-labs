import { createHash } from "node:crypto";

import type { RuntimeAuditEvent } from "../runtime/execution-runtime";
import type { TelemetryEventEnvelope } from "./telemetry-buffer";

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 40);

export function createRuntimeTelemetry(event: RuntimeAuditEvent): readonly TelemetryEventEnvelope[] {
  if (event.type !== "signal-proposed" || !event.signal || !event.outcome || !event.symbol) return [];
  const expectedDeploymentVersion = Number(event.configurationVersion.replace(/^v/, ""));
  if (!Number.isSafeInteger(expectedDeploymentVersion) || expectedDeploymentVersion < 1) return [];
  const base = `${event.deploymentId}:${event.configurationVersion}:${event.at}:${event.signal.id}`;
  const envelope = (type: "signal" | "risk-block", payload: TelemetryEventEnvelope["payload"]): TelemetryEventEnvelope => {
    const id = `${type}-${digest(`${base}:${type}`)}`;
    return Object.freeze({ version: 1, id, type, deploymentId: event.deploymentId, expectedDeploymentVersion,
      correlationId: id, occurredAt: event.at, payload });
  };
  const outcome = event.outcome;
  if (outcome.status === "submitted" || outcome.status === "idempotent" || outcome.status === "risk-rejected") {
    const order = outcome.order;
    const signal = envelope("signal", { symbol: event.symbol, action: event.signal.action === "close" ? "exit" : "enter",
      side: order.approvedIntent.side, quantity: order.approvedIntent.quantity, price: order.approvedIntent.price,
      reason: event.signal.reason.slice(0, 256) });
    if (outcome.status !== "risk-rejected") return [signal];
    return [signal, envelope("risk-block", { code: order.reason ?? "risk-rejected", symbol: event.symbol,
      message: "Trusted risk coordinator rejected the signal" })];
  }
  return [envelope("risk-block", { code: outcome.reason, symbol: event.symbol,
    message: "Trusted execution coordinator blocked the signal" })];
}
