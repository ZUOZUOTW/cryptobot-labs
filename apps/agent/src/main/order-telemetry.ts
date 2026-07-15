import Decimal from "decimal.js";
import { createHash } from "node:crypto";

import type { ExchangeFillSnapshot, TrackedOrder } from "@cryptobot-labs/trading-core";

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
  readonly fills?: readonly ExchangeFillSnapshot[];
}): TelemetryEventEnvelope {
  const order = input.order;
  const marketOrder = order.executionTarget.mode === "futures-demo";
  const fills = input.fills ?? [];
  const occurredAt = fills.length ? Math.max(...fills.map(({ filledAt }) => filledAt)) : order.updatedAt;
  const identity = digest(`${order.deploymentId}:${order.clientOrderId}`);
  const eventId = `${fills.length ? "fill" : "order"}-${digest(`${identity}:${order.version}:${order.status}:${occurredAt}:${fills.map(({ exchangeFillId }) => exchangeFillId).join(",")}`)}`;
  return Object.freeze({
    version: 1,
    id: eventId,
    type: fills.length ? "fill" : "order-state",
    deploymentId: order.deploymentId,
    expectedDeploymentVersion: input.expectedDeploymentVersion,
    correlationId: order.clientOrderId,
    occurredAt,
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
        orderType: marketOrder ? "market" : "limit",
        state: order.status,
        price: marketOrder ? null : order.approvedIntent.price,
        quantity: order.approvedIntent.quantity,
        filledQuantity: order.cumulativeFilledQuantity,
        averageFillPrice: order.averageFillPrice ?? null,
        notional: new Exact(order.approvedIntent.price).mul(order.approvedIntent.quantity).toFixed(),
        correlationId: order.clientOrderId,
        createdAt: order.createdAt,
        updatedAt: occurredAt,
      },
      fills: fills.map((fill) => ({ id: `fil-${digest(`${order.deploymentId}:${fill.exchangeFillId}`)}`,
        exchangeFillId: fill.exchangeFillId, price: fill.price, quantity: fill.quantity, fee: fill.fee,
        feeCurrency: fill.feeCurrency, realizedPnl: fill.realizedPnl ?? null, filledAt: fill.filledAt })),
    },
  });
}
