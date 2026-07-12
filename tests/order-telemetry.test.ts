import { createTrackedOrder, transitionOrder } from "../packages/trading-core/src";
import { describe, expect, it } from "vitest";

import { createOrderStateTelemetry } from "../apps/agent/src/main/order-telemetry";
import { parseDeviceEvent } from "../lib/server/device-events";

describe("order telemetry", () => {
  it("creates exact credential-free evidence accepted by the control plane", () => {
    let order = createTrackedOrder({ deploymentId: "dep-1", clientOrderId: "cbl-live-order-1",
      executionTarget: { market: "spot", mode: "live" }, approvedIntent: { symbol: "BTCUSDT", side: "buy",
        quantity: "0.01", price: "60000", expectedSlippageBps: "5", reduceOnly: false }, at: 100 });
    order = transitionOrder(order, { type: "submit-start", at: 101 });
    order = transitionOrder(order, { type: "submit-acknowledged", exchangeOrderId: "weex-42", at: 102 });
    const event = createOrderStateTelemetry({ order, expectedDeploymentVersion: 3, deploymentState: "running" });

    expect(parseDeviceEvent(event)).toMatchObject({ type: "order-state", deploymentId: "dep-1",
      expectedDeploymentVersion: 3, occurredAt: 102,
      payload: { mode: "live", deploymentState: "running", order: { clientOrderId: "cbl-live-order-1",
        exchangeOrderId: "weex-42", state: "acknowledged", notional: "600" }, fills: [] } });
    expect(JSON.stringify(event)).not.toMatch(/api.?key|secret|passphrase|authorization/i);
  });
});
