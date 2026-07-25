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

  it("preserves genuine exchange fill identities, fees, PnL, and timestamps", () => {
    let order=createTrackedOrder({deploymentId:"dep-1",clientOrderId:"cbl-live-fill-1",executionTarget:{market:"futures",mode:"live"},
      approvedIntent:{symbol:"BTCUSDT",side:"sell",quantity:"0.1",price:"60000",expectedSlippageBps:"5",reduceOnly:true},at:100});
    order=transitionOrder(order,{type:"submit-start",at:100});
    order=transitionOrder(order,{type:"submit-acknowledged",exchangeOrderId:"99",at:100});
    order=transitionOrder(order,{type:"fill-snapshot",cumulativeFilledQuantity:"0.1",averageFillPrice:"60000",fees:"0.2",at:120});
    const event=createOrderStateTelemetry({order,expectedDeploymentVersion:3,deploymentState:"running",fills:[
      {exchangeFillId:"801",price:"60000",quantity:"0.1",fee:"0.2",feeCurrency:"USDT",realizedPnl:"12.5",filledAt:115},
    ]});
    expect(parseDeviceEvent(event)).toMatchObject({type:"fill",occurredAt:115,payload:{order:{state:"filled",updatedAt:115},
      fills:[{exchangeFillId:"801",price:"60000",quantity:"0.1",fee:"0.2",feeCurrency:"USDT",realizedPnl:"12.5",filledAt:115}]}});
  });

  it("labels reconciled Demo orders as market orders without inventing fill records",()=>{
    let order=createTrackedOrder({deploymentId:"dep-demo",clientOrderId:"cbl-demo-1",
      executionTarget:{market:"futures",mode:"futures-demo"},approvedIntent:{symbol:"BTCSUSDT",side:"buy",
        quantity:"0.01",price:"50000",expectedSlippageBps:"5",reduceOnly:false},at:100});
    order=transitionOrder(order,{type:"submit-start",at:100});
    order=transitionOrder(order,{type:"submit-acknowledged",exchangeOrderId:"demo-42",at:101});
    order=transitionOrder(order,{type:"fill-snapshot",cumulativeFilledQuantity:"0.01",averageFillPrice:"50001",fees:"0",at:120});
    const event=createOrderStateTelemetry({order,expectedDeploymentVersion:3,deploymentState:"running"});
    expect(parseDeviceEvent(event)).toMatchObject({type:"order-state",payload:{mode:"futures-demo",order:{
      orderType:"market",price:null,state:"filled",filledQuantity:"0.01",averageFillPrice:"50001"},fills:[]}});
  });
});
