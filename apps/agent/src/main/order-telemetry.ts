import Decimal from "decimal.js";
import { createHash } from "node:crypto";

import type { TrackedOrder } from "@cryptobot-labs/trading-core";

import type { TelemetryEventEnvelope } from "./telemetry-buffer";

const Exact = Decimal.clone({ precision: 96 });
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 48);

const positionSide = (order: TrackedOrder): "net" | "long" | "short" => {
  if (order.executionTarget.market === "spot") return "net";
  if (order.approvedIntent.reduceOnly) return order.approvedIntent.side === "buy" ? "short" : "long";
  return order.approvedIntent.side === "buy" ? "long" : "short";
};

/** Produces credential-free aggregate order evidence accepted by the control plane. */
export function createOrderStateTelemetry(input: {
  readonly order: TrackedOrder;
  readonly expectedDeploymentVersion: number;
  readonly deploymentState: "running" | "paused" | "stopped" | "error";
}): TelemetryEventEnvelope {
  const order = input.order;
  const identity = digest(`${order.deploymentId}:${order.clientOrderId}`);
  const eventId = `order-${digest(`${identity}:${order.version}:${order.status}:${order.updatedAt}`)}`;
  return Object.freeze({
    version: 1,
    id: eventId,
    type: "order-state",
    deploymentId: order.deploymentId,
    expectedDeploymentVersion: input.expectedDeploymentVersion,
    correlationId: order.clientOrderId,
    occurredAt: order.updatedAt,
    payload: {
      mode: order.executionTarget.mode,
      deploymentState: input.deploymentState,
      order: {
        id: `ord-${identity}`,
        deploymentId: order.deploymentId,
        clientOrderId: order.clientOrderId,
        exchangeOrderId: order.exchangeOrderId ?? null,
        market: order.executionTarget.market,
        symbol: order.approvedIntent.symbol,
        side: order.approvedIntent.side,
        positionSide: positionSide(order),
        orderType: "limit",
        state: order.status,
        price: order.approvedIntent.price,
        quantity: order.approvedIntent.quantity,
        filledQuantity: order.cumulativeFilledQuantity,
        averageFillPrice: order.averageFillPrice ?? null,
        notional: new Exact(order.approvedIntent.price).mul(order.approvedIntent.quantity).toFixed(),
        correlationId: order.clientOrderId,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      fills: [],
    },
  });
}
