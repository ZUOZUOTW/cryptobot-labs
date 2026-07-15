import { cloneVisualStrategyBlock, createTrackedOrder, type VisualBotConfig } from "@cryptobot-labs/trading-core";
import { describe, expect, it, vi } from "vitest";

import type { DeploymentBundle } from "../src/main/deployment-client";
import { LiveScheduler } from "../src/main/live-scheduler";
import { MarketStreamState } from "../src/main/market-stream";

const NOW = 7_200_000;
const config: VisualBotConfig = { id: "live-1", name: "Live", exchange: "WEEX", market: "spot", symbol: "BTCUSDT",
  timeframe: "1m", logicMode: "all", leverage: 1, blocks: ["rsi", "stop-loss"].map(cloneVisualStrategyBlock) };
const bundle: DeploymentBundle = { schemaVersion: 1,
  deployment: { id: "dep-1", version: 1, strategyVersionId: "sv-1", mode: "live", state: "paused",
    configurationHash: "a".repeat(64) },
  strategy: { market: "spot", symbol: "BTCUSDT", configHash: "b".repeat(64), sourceHash: null, config, source: null },
  risk: { id: "risk-1", allowedSymbols: ["BTCUSDT"], maxOrderNotional: "100", maxPositionNotional: "500",
    maxTotalExposure: "1000", maxSimultaneousPositions: 2, maxDailyLoss: "50", maxLeverage: "1",
    maxSlippageBps: 30, minSignalCooldownMs: 0, maxConsecutiveFailures: 3, operationMode: "automatic", updatedAt: 1 } };

describe("live scheduler", () => {
  it("initializes from verified account equity and evaluates each completed candle once", async () => {
    const market = new MarketStreamState();
    const snapshot = { collectedAt: NOW, rules: { market: "spot" as const, symbol: "BTCUSDT", baseAsset: "BTC",
      quoteAsset: "USDT", tickSize: "0.1", stepSize: "0.001", minimumQuantity: "0.001" },
    candles: [{ openTime: NOW - 60_000, closeTime: NOW - 1, open: "100", high: "101", low: "99", close: "100",
      volume: "10", complete: true }] };
    const collector = { collect: vi.fn(async () => { market.record({ market: "spot", symbol: "BTCUSDT", bid: "100", ask: "100",
      last: "100", exchangeTimestamp: NOW - 1, receivedAt: NOW }); return snapshot; }) };
    let initialized = false; let cursor: number | null = null; let sequence = 0;
    const state = { initialize: vi.fn(async () => { initialized = true; }), snapshot: vi.fn(async () => initialized ? {
      dayStartEquity: "1000", utcDay: "1970-01-01", lastSignalAt: null, realizedDailyPnl: "0", consecutiveFailures: 0,
      nextSignalSequence: sequence + 1, lastEvaluatedCloseTime: cursor } : null), mark: vi.fn(async () => undefined),
    rollDay: vi.fn(async () => undefined), applyFill: vi.fn(async () => undefined),
    completeEvaluation: vi.fn(async ({ closeTime }: { closeTime: number }) => { cursor = closeTime; sequence += 1; }) };
    let held=false;
    const account = { collect: vi.fn(async () => ({ connectionVerifiedAt: NOW, observedAt: NOW,
      portfolio: { equity: "1000", dayStartEquity: "1000", availableEquity: "1000", utcDay: "1970-01-01",
        ...(held?{position:{side:"long" as const,quantity:"1",entryPrice:"90",peakPrice:"100",troughPrice:"89",usedMargin:"100",layerCount:1}}:{}) },
      risk: { market: "spot" as const, symbol: "BTCUSDT", now: NOW, priceTimestamp: NOW - 1, lastSignalAt: null,
        openPositions: held?1:0, positionSide: held?"long" as const:"flat" as const, currentPositionQuantity: held?"1":"0",
        currentPositionNotional: held?"100":"0", totalExposure: held?"100":"0", realizedDailyPnl: "0",
        unrealizedDailyPnl: held?"10":"0", consecutiveFailures: 0, leverage: "1" } })) };
    const closeOrder=createTrackedOrder({deploymentId:"dep-1",clientOrderId:"manual-close-order",
      executionTarget:{market:"spot",mode:"live"},approvedIntent:{symbol:"BTCUSDT",side:"sell",quantity:"1",price:"100",
        expectedSlippageBps:"5",reduceOnly:true},at:NOW});
    const runner = { resume: vi.fn(async () => undefined), pause: vi.fn(async () => undefined),
      stopNewOrders: vi.fn(), cancelOpenOrders: vi.fn(async () => ({ cancelled: 0, rejected: 0, unresolved: 0, skipped: 0 })),
      closePosition: vi.fn(async()=>({status:"submitted" as const,order:closeOrder})),
      reconcileActiveOrders: vi.fn(async () => ({ ready: true as const, evidence: [] })),
      evaluate: vi.fn(async () => ({ status: "discarded" as const, reason: "hold" as const })) };
    let scheduled: (() => void) | null = null;
    const connection = { refresh: vi.fn() };
    const onHeartbeat=vi.fn();
    const scheduler = new LiveScheduler({ collector, market, account, connection, state: () => state,
      orders: { listForDeployment: vi.fn(async () => []) }, runner, onFault: vi.fn(), onHeartbeat,
      schedule: (work) => { scheduled = work; return 1; }, cancel: vi.fn() });

    await scheduler.resume(bundle); expect(runner.evaluate).not.toHaveBeenCalled();
    await scheduler.activate(); expect(state.initialize).toHaveBeenCalledWith(expect.objectContaining({ dayStartEquity: "1000" }));
    expect(runner.evaluate).toHaveBeenCalledOnce(); expect(state.completeEvaluation).toHaveBeenCalledOnce();
    expect(connection.refresh).toHaveBeenCalledWith(NOW);
    (scheduled as (() => void) | null)?.(); await vi.waitFor(() => expect(collector.collect).toHaveBeenCalledTimes(2));
    expect(runner.evaluate).toHaveBeenCalledOnce();
    await vi.waitFor(()=>expect(onHeartbeat).toHaveBeenCalledTimes(2));
    expect(onHeartbeat.mock.calls.slice(0,2).map((call)=>call[3])).toEqual([NOW*1_000,NOW*1_000+1]);
    scheduler.stopNewOrders("dep-1"); expect(runner.stopNewOrders).toHaveBeenCalledOnce();
    await expect(scheduler.cancelOpenOrders("dep-1")).resolves.toMatchObject({ cancelled: 0, unresolved: 0 });
    expect(runner.cancelOpenOrders).toHaveBeenCalledWith("dep-1");
    await expect(scheduler.closePositions("dep-1", null, "cmd-close-1")).resolves.toEqual({ closed: 0, reason: "flat" });
    expect(runner.closePosition).not.toHaveBeenCalled();held=true;
    await expect(scheduler.closePositions("dep-1","BTCUSDT","cmd-close-2")).resolves.toEqual({closed:1,order:closeOrder});
    expect(runner.closePosition).toHaveBeenCalledWith(expect.objectContaining({riskContext:expect.objectContaining({positionSide:"long"})}),
      "close-cmd-close-2");
    await scheduler.pause(); expect(runner.pause).toHaveBeenCalledOnce();
  });

  it("fails closed before account evaluation when order reconciliation is unresolved", async () => {
    const market = new MarketStreamState(); market.record({ market: "spot", symbol: "BTCUSDT", bid: "100", ask: "100", last: "100",
      exchangeTimestamp: NOW - 1, receivedAt: NOW });
    const runner = { resume: vi.fn(async () => undefined), pause: vi.fn(async () => undefined), evaluate: vi.fn(),
      stopNewOrders: vi.fn(), cancelOpenOrders: vi.fn(async () => ({ cancelled: 0, rejected: 0, unresolved: 0, skipped: 0 })),
      closePosition: vi.fn(),
      reconcileActiveOrders: vi.fn(async () => ({ ready: false as const, reason: "live-order-unresolved" })) };
    const onFault = vi.fn();
    const scheduler = new LiveScheduler({ market, runner, onFault, connection: { refresh: vi.fn() },
      orders: { listForDeployment: vi.fn() },
      state: () => ({ initialize: vi.fn(), snapshot: vi.fn(), mark: vi.fn(), rollDay: vi.fn(), applyFill: vi.fn(),
        completeEvaluation: vi.fn() }), account: { collect: vi.fn() },
      collector: { collect: vi.fn(async () => ({ collectedAt: NOW, rules: { market: "spot" as const, symbol: "BTCUSDT",
        baseAsset: "BTC", quoteAsset: "USDT", tickSize: "0.1", stepSize: "0.001", minimumQuantity: "0.001" },
      candles: [{ openTime: NOW - 60_000, closeTime: NOW - 1, open: "100", high: "101", low: "99", close: "100",
        volume: "10", complete: true }] })) } });
    await scheduler.resume(bundle);
    await expect(scheduler.activate()).rejects.toThrow("live-order-unresolved");
    expect(runner.evaluate).not.toHaveBeenCalled(); expect(runner.pause).toHaveBeenCalledOnce();
    expect(onFault).toHaveBeenCalledWith("live-evaluation-failed", bundle);
  });

  it("runs a futures Demo deployment with an isolated Demo target and cursor",async()=>{
    const demoConfig={...config,id:"demo-1",name:"Demo",market:"futures" as const,symbol:"BTCSUSDT",leverage:5};
    const demoBundle:DeploymentBundle={...bundle,
      deployment:{...bundle.deployment,id:"dep-demo",mode:"futures-demo",strategyVersionId:"sv-demo"},
      strategy:{...bundle.strategy,market:"futures",symbol:"BTCSUSDT",config:demoConfig},
      risk:{...bundle.risk!,id:"risk-demo",allowedSymbols:["BTCSUSDT"],maxLeverage:"5"}};
    const market=new MarketStreamState();
    const rules={market:"futures" as const,symbol:"BTCSUSDT",baseAsset:"BTC",quoteAsset:"SUSDT",tickSize:"0.1",
      stepSize:"0.001",minimumQuantity:"0.001",maximumLeverage:"100"};
    const snapshot={collectedAt:NOW,rules,candles:[{openTime:NOW-60_000,closeTime:NOW-1,open:"100",high:"101",
      low:"99",close:"100",volume:"10",complete:true}]};
    const collector={collect:vi.fn(async()=>{market.record({market:"futures",symbol:"BTCSUSDT",bid:"100",ask:"100",
      last:"100",exchangeTimestamp:NOW-1,receivedAt:NOW});return snapshot;})};
    let initialized=false;
    const state={initialize:vi.fn(async()=>{initialized=true;}),snapshot:vi.fn(async()=>initialized?{dayStartEquity:"5000",
      utcDay:"1970-01-01",lastSignalAt:null,realizedDailyPnl:"0",consecutiveFailures:0,nextSignalSequence:1,
      lastEvaluatedCloseTime:null}:null),mark:vi.fn(async()=>undefined),rollDay:vi.fn(async()=>undefined),
      applyFill:vi.fn(async()=>undefined),completeEvaluation:vi.fn(async()=>undefined)};
    const account={collect:vi.fn(async()=>({connectionVerifiedAt:NOW,observedAt:NOW,
      portfolio:{equity:"5000",availableEquity:"5000",dayStartEquity:"5000",utcDay:"1970-01-01"},
      risk:{market:"futures" as const,symbol:"BTCSUSDT",now:NOW,priceTimestamp:NOW-1,lastSignalAt:null,openPositions:0,
        positionSide:"flat" as const,currentPositionQuantity:"0",currentPositionNotional:"0",totalExposure:"0",
        realizedDailyPnl:"0",unrealizedDailyPnl:"0",consecutiveFailures:0,leverage:"5"}}))};
    const runner={resume:vi.fn(async()=>undefined),pause:vi.fn(async()=>undefined),stopNewOrders:vi.fn(),
      cancelOpenOrders:vi.fn(async()=>({cancelled:0,rejected:0,unresolved:0,skipped:0})),closePosition:vi.fn(),
      reconcileActiveOrders:vi.fn(async()=>({ready:true as const,evidence:[]})),
      evaluate:vi.fn(async()=>({status:"discarded" as const,reason:"hold" as const}))};
    const scheduler=new LiveScheduler({collector,market,account,connection:{refresh:vi.fn()},state:()=>state,
      orders:{listForDeployment:vi.fn(async()=>[])},runner,onFault:vi.fn(),schedule:()=>1,cancel:vi.fn()});

    await scheduler.resume(demoBundle);await scheduler.activate();
    expect(account.collect).toHaveBeenCalledWith(expect.objectContaining({target:{market:"futures",mode:"futures-demo"}}));
    expect(state.initialize).toHaveBeenCalledWith(expect.objectContaining({mode:"futures-demo",market:"futures"}));
    expect(runner.evaluate).toHaveBeenCalledWith(expect.objectContaining({context:expect.objectContaining({mode:"futures-demo"})}));
    await scheduler.pause();
  });
});
