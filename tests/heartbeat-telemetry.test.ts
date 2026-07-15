import { cloneVisualStrategyBlock } from "../packages/trading-core/src";
import { describe, expect, it } from "vitest";

import { createLiveHeartbeatTelemetry, createPaperHeartbeatTelemetry } from "../apps/agent/src/main/heartbeat-telemetry";
import type { DeploymentBundle } from "../apps/agent/src/main/deployment-client";
import { parseDeviceEvent } from "../lib/server/device-events";

const bundle:DeploymentBundle={schemaVersion:1,deployment:{id:"dep-1",version:3,strategyVersionId:"sv-1",mode:"live",state:"paused",
  configurationHash:"a".repeat(64)},strategy:{market:"futures",symbol:"BTCUSDT",configHash:"b".repeat(64),sourceHash:null,
    source:null,config:{id:"bot",name:"Bot",exchange:"WEEX",market:"futures",symbol:"BTCUSDT",timeframe:"1h",logicMode:"all",
      leverage:5,blocks:[cloneVisualStrategyBlock("rsi")]}},risk:null};

describe("live heartbeat telemetry",()=>{
  it("publishes exact current-version position and PnL evidence",()=>{
    const event=createLiveHeartbeatTelemetry({bundle,markPrice:"50000",sequence:1_700_000_000_000_001,health:"healthy",evidence:{
      connectionVerifiedAt:1_700_000_000_000,observedAt:1_700_000_000_001,
      portfolio:{equity:"1025",dayStartEquity:"1000",availableEquity:"700",utcDay:"2023-11-14",
        position:{side:"long",quantity:"0.01",entryPrice:"49000",peakPrice:"51000",troughPrice:"48000",usedMargin:"100",layerCount:1}},
      risk:{market:"futures",symbol:"BTCUSDT",now:1_700_000_000_001,priceTimestamp:1_700_000_000_000,lastSignalAt:null,
        openPositions:1,positionSide:"long",currentPositionQuantity:"0.01",currentPositionNotional:"500",totalExposure:"500",
        realizedDailyPnl:"10",unrealizedDailyPnl:"25",consecutiveFailures:0,leverage:"5"}}});
    expect(parseDeviceEvent(event)).toMatchObject({type:"heartbeat",expectedDeploymentVersion:3,payload:{heartbeat:{mode:"live",
      state:"running",health:"healthy",positions:[{symbol:"BTCUSDT",side:"long",quantity:"0.01",entryPrice:"49000",
        markPrice:"50000",unrealizedPnl:"25",leverage:"5"}]},positionIds:[expect.stringMatching(/^pos-/)]}});
    const demo=createLiveHeartbeatTelemetry({bundle:{...bundle,deployment:{...bundle.deployment,mode:"futures-demo"}},
      markPrice:"50000",sequence:1_700_000_000_000_002,health:"healthy",evidence:{
        connectionVerifiedAt:1_700_000_000_000,observedAt:1_700_000_000_002,portfolio:{equity:"1025",
          dayStartEquity:"1000",availableEquity:"700",utcDay:"2023-11-14"},risk:{market:"futures",symbol:"BTCUSDT",
          now:1_700_000_000_002,priceTimestamp:1_700_000_000_000,lastSignalAt:null,openPositions:0,positionSide:"flat",
          currentPositionQuantity:"0",currentPositionNotional:"0",totalExposure:"0",realizedDailyPnl:"10",
          unrealizedDailyPnl:"0",consecutiveFailures:0,leverage:"5"}}});
    expect(parseDeviceEvent(demo)).toMatchObject({type:"heartbeat",payload:{heartbeat:{mode:"futures-demo",positions:[]}}});
  });
  it("uses the same strict evidence contract for Paper positions",()=>{
    const paperBundle={...bundle,deployment:{...bundle.deployment,mode:"paper" as const,state:"stopped" as const}};
    const event=createPaperHeartbeatTelemetry({bundle:paperBundle,markPrice:"105",leverage:"1",observedAt:200,sequence:200_000,
      account:{portfolio:{equity:"1005",dayStartEquity:"1000",utcDay:"1970-01-01",position:{side:"long",quantity:"1",
        entryPrice:"100",peakPrice:"105",troughPrice:"99",usedMargin:"105",layerCount:1}},risk:{lastSignalAt:100,
        openPositions:1,positionSide:"long",currentPositionQuantity:"1",currentPositionNotional:"105",totalExposure:"105",
        realizedDailyPnl:"0",unrealizedDailyPnl:"5",consecutiveFailures:0}}});
    expect(parseDeviceEvent(event)).toMatchObject({type:"heartbeat",payload:{heartbeat:{mode:"paper",state:"running",
      positions:[{markPrice:"105",unrealizedPnl:"5",leverage:"1"}]}}});
  });
});
