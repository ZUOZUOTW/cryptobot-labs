import { createTrackedOrder, transitionOrder } from "../packages/trading-core/src";
import { describe, expect, it } from "vitest";

import { createRuntimeTelemetry } from "../apps/agent/src/main/runtime-telemetry";
import { parseDeviceEvent } from "../lib/server/device-events";

describe("runtime telemetry",()=>{
  it("publishes approved signal evidence and an independent trusted risk block",()=>{
    let order=createTrackedOrder({deploymentId:"dep-1",clientOrderId:"client-1",executionTarget:{market:"spot",mode:"paper"},
      approvedIntent:{symbol:"BTCUSDT",side:"buy",quantity:"0.01",price:"50000",expectedSlippageBps:"5",reduceOnly:false},at:100});
    order=transitionOrder(order,{type:"risk-rejected",reason:"maximum-order-notional-exceeded",at:100});
    const events=createRuntimeTelemetry({type:"signal-proposed",deploymentId:"dep-1",configurationVersion:"v3",
      scriptHash:"a".repeat(64),at:100,reason:"grid-entry:risk-rejected",symbol:"BTCUSDT",
      signal:{id:"signal-1",action:"buy",reason:"grid-entry",allocationRate:0.1,createdAt:100},
      outcome:{status:"risk-rejected",order}});
    expect(events.map((event)=>parseDeviceEvent(event))).toMatchObject([
      {type:"signal",payload:{symbol:"BTCUSDT",action:"enter",side:"buy",quantity:"0.01",price:"50000",reason:"grid-entry"}},
      {type:"risk-block",payload:{code:"maximum-order-notional-exceeded",symbol:"BTCUSDT"}},
    ]);
    expect(JSON.stringify(events)).not.toMatch(/source|api.?key|secret|passphrase/i);
  });
});
