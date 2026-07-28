import {
  cloneVisualStrategyBlock,
  type OrderRepository,
  type TrackedOrder,
  type VisualBotConfig,
} from "@cryptobot-labs/trading-core";
import type { HttpRequest, HttpResponse, HttpTransport } from "@cryptobot-labs/weex-client";
import { describe, expect, it, vi } from "vitest";

import { ConnectionRegistry } from "../src/main/connections";
import type { DeploymentBundle } from "../src/main/deployment-client";
import { buildLiveEvaluationRequest } from "../src/main/live-evaluation-context";
import { LiveRunRunner } from "../src/main/live-run-runner";
import { ClockFreshnessGuard, MarketStreamState } from "../src/main/market-stream";
import { createVaultWeexExecutionClient } from "../src/main/vault-weex-execution-client";
import { StrategyWorker, type StrategySandboxLike } from "../src/runtime/strategy-worker";

const NOW=7_200_000;
const BROKER_ID="WEEX111162";
class MemoryRepository implements OrderRepository {
  readonly orders=new Map<string,TrackedOrder>();
  async getByClientOrderId(id:string){return this.orders.get(id)??null;}
  async listActive(deploymentId:string,symbol?:string){return [...this.orders.values()].filter((order)=>order.deploymentId===deploymentId
    &&(!symbol||order.approvedIntent.symbol===symbol)&&!["filled","cancelled","rejected","risk-rejected"].includes(order.status));}
  async claim(order:TrackedOrder){const current=this.orders.get(order.clientOrderId);if(current)return{claimed:false as const,reason:"client-order-id-exists" as const,order:current};
    this.orders.set(order.clientOrderId,order);return{claimed:true as const,order};}
  async save(order:TrackedOrder,expected:number|null){if((this.orders.get(order.clientOrderId)?.version??null)!==expected)throw new Error("conflict");
    this.orders.set(order.clientOrderId,order);return order;}
}
type Step=HttpResponse|Error|((request:HttpRequest)=>HttpResponse|Promise<HttpResponse>);
class Transport implements HttpTransport {
  readonly requests:HttpRequest[]=[];
  constructor(private readonly steps:Step[]){}
  async send(request:HttpRequest){this.requests.push(request);const step=this.steps.shift();if(!step)throw new Error("unexpected request");
    if(step instanceof Error)throw step;return typeof step==="function"?await step(request):step;}
}
const ok=(body:unknown,headers:Record<string,string>={}):HttpResponse=>({status:200,headers,body});
const probe=()=>ok({symbol:"BTCUSDT",price:"98"},{date:new Date(NOW).toUTCString()});
const account=()=>ok({canTrade:true,canWithdraw:false,balances:[]});
const vault={withCredentials:async<T>(consume:(credentials:Readonly<{apiKey:string;secretKey:string;passphrase:string}>)=>T|Promise<T>)=>
  consume({apiKey:"api-key",secretKey:"secret-key",passphrase:"passphrase"})};
const rules={market:"spot" as const,symbol:"BTCUSDT",baseAsset:"BTC",quoteAsset:"USDT",tickSize:"0.1",stepSize:"0.001",
  minimumQuantity:"0.001",minimumNotional:"5"};
const source="export default () => ({action:'buy',reason:'sandbox-buy',allocationRate:0.1})";
const config:VisualBotConfig={id:"live-1",name:"Live",exchange:"WEEX",market:"spot",symbol:"BTCUSDT",timeframe:"1h",logicMode:"all",
  leverage:1,blocks:["rsi","fixed-position","stop-loss"].map(cloneVisualStrategyBlock),source};
const bundle:DeploymentBundle={schemaVersion:1,deployment:{id:"dep-live",version:2,strategyVersionId:"sv-live",mode:"live",state:"stopped",
  configurationHash:"a".repeat(64)},strategy:{market:"spot",symbol:"BTCUSDT",configHash:"b".repeat(64),sourceHash:"c".repeat(64),config,source},
  risk:{id:"risk-live",allowedSymbols:["BTCUSDT"],maxOrderNotional:"100",maxPositionNotional:"500",maxTotalExposure:"1000",
    maxSimultaneousPositions:2,maxDailyLoss:"50",maxLeverage:"1",maxSlippageBps:30,minSignalCooldownMs:0,maxConsecutiveFailures:3,
    operationMode:"automatic",updatedAt:1}};
const candles=[{openTime:0,closeTime:3_599_999,open:"100",high:"101",low:"99",close:"100",volume:"10",complete:true},
  {openTime:3_600_000,closeTime:NOW-1,open:"98",high:"99",low:"97",close:"98",volume:"10",complete:true}];
const marketSnapshot={candles,rules,collectedAt:NOW};
const quote={market:"spot" as const,symbol:"BTCUSDT",bid:"97.9",ask:"98.1",last:"98",exchangeTimestamp:NOW-1,receivedAt:NOW};
const evidence={connectionVerifiedAt:NOW,observedAt:NOW,portfolio:{equity:"1000",dayStartEquity:"1000",availableEquity:"1000",utcDay:"1970-01-01"},
  risk:{market:"spot" as const,symbol:"BTCUSDT",now:NOW,priceTimestamp:NOW-1,lastSignalAt:null,openPositions:0,positionSide:"flat" as const,
    currentPositionQuantity:"0",currentPositionNotional:"0",totalExposure:"0",realizedDailyPnl:"0",unrealizedDailyPnl:"0",consecutiveFailures:0,leverage:"1"}};

function setup(transport:Transport){
  const repository=new MemoryRepository();const market=new MarketStreamState();market.record(quote);
  const clock=new ClockFreshnessGuard();clock.record({synchronizedAt:NOW,driftMs:0});
  const connection=new ConnectionRegistry();connection.record({verifiedAt:NOW,apiKeySuffix:"1234",canTrade:true,withdrawalPermission:"absent",
    permissions:{read:true,spot:true,futures:true}});
  const client=createVaultWeexExecutionClient({brokerId:BROKER_ID,vault,transport,now:()=>NOW,
    rulesProvider:async()=>({rules,verifiedAt:NOW})});
  const sandbox={evaluate:vi.fn(async()=>({signal:{id:"signal-live",action:"buy" as const,reason:"sandbox-buy",allocationRate:0.1,createdAt:NOW},
    scriptHash:"c".repeat(64),durationMs:1})),dispose:vi.fn(async()=>undefined)} satisfies StrategySandboxLike;
  const onReconciledOrder=vi.fn();
  const runner=new LiveRunRunner({brokerId:BROKER_ID,repository,client,market,clock,connection,
    instruments:{requireFresh:()=>rules},runtimeAudit:vi.fn(),runAudit:vi.fn(),
    onReconciledOrder,
    createStrategyWorker:()=>new StrategyWorker(async()=>sandbox,1_000),now:()=>NOW});
  const request=buildLiveEvaluationRequest({bundle,market:marketSnapshot,quote,account:evidence,signalSequence:1});
  return{repository,runner,request,sandbox,client,onReconciledOrder};
}

describe("live run runner",()=>{
  it("submits once and reconciles an acknowledged order without resubmission",async()=>{
    let clientOrderId="";
    const transport=new Transport([probe(),account(),(request)=>{const body=JSON.parse(request.body??"{}");clientOrderId=body.newClientOrderId;
      return ok({orderId:"42",clientOrderId});},probe(),account(),()=>ok({orderId:"42",clientOrderId,symbol:"BTCUSDT",side:"BUY",origQty:"0.102",
        executedQty:"0.102",avgPrice:"98",status:"FILLED"}),ok([{id:"1",orderId:"42",symbol:"BTCUSDT",price:"98",qty:"0.102",
          commission:"0.01",commissionAsset:"USDT",time:NOW}])]);
    const {runner,request,repository,onReconciledOrder}=setup(transport);await runner.resume(bundle);
    await expect(runner.evaluate(request)).resolves.toMatchObject({status:"proposed",outcome:{status:"submitted",order:{status:"acknowledged"}}});
    const reconciled=await runner.evaluate(request);
    expect(reconciled).toMatchObject({status:"proposed",outcome:{status:"idempotent",order:{status:"filled"}}});
    expect(transport.requests.filter(({method})=>method==="POST")).toHaveLength(1);
    expect([...repository.orders.keys()][0]).toMatch(/^b-WEEX111162-[A-Za-z0-9_-]{22}$/u);
    expect([...repository.orders.values()][0]).toMatchObject({status:"filled",exchangeOrderId:"42"});
    expect(onReconciledOrder).toHaveBeenCalledWith(expect.objectContaining({status:"filled"}),expect.objectContaining({fills:[
      expect.objectContaining({exchangeFillId:"1",quantity:"0.102",fee:"0.01",feeCurrency:"USDT",filledAt:NOW})]}));
    await runner.pause();
  });

  it("pauses after one ambiguous submit and never retries the POST",async()=>{
    const transport=new Transport([probe(),account(),new Error("timeout after dispatch")]);
    const {runner,request}=setup(transport);await runner.resume(bundle);
    await expect(runner.evaluate(request)).resolves.toEqual({status:"paused",reason:"ambiguous-order"});
    await expect(runner.evaluate(request)).resolves.toEqual({status:"paused",reason:"ambiguous-order"});
    expect(transport.requests.filter(({method})=>method==="POST")).toHaveLength(1);
    await runner.pause();
  });

  it("keeps the normal coordinator stopped while a manual close still passes the risk engine",async()=>{
    let submitted:Record<string,unknown>={};
    const transport=new Transport([probe(),account(),(request)=>{submitted=JSON.parse(request.body??"{}");
      return ok({orderId:"close-42",clientOrderId:submitted.newClientOrderId});}]);
    const {runner}=setup(transport);await runner.resume(bundle);runner.stopNewOrders();
    const closeEvidence={...evidence,portfolio:{...evidence.portfolio,position:{side:"long" as const,quantity:"0.102",entryPrice:"90",
      peakPrice:"100",troughPrice:"89",usedMargin:"9.996",layerCount:1}},risk:{...evidence.risk,openPositions:1,
      positionSide:"long" as const,currentPositionQuantity:"0.102",currentPositionNotional:"9.996",totalExposure:"9.996"}};
    const closeRequest=buildLiveEvaluationRequest({bundle,market:marketSnapshot,quote,account:closeEvidence,signalSequence:2});
    await expect(runner.closePosition(closeRequest.context,"manual-close-1")).resolves.toMatchObject({status:"submitted",
      order:{status:"acknowledged",approvedIntent:{side:"sell",reduceOnly:true,quantity:"0.102"}}});
    expect(submitted).toMatchObject({side:"SELL",quantity:"0.102"});
    expect(transport.requests.filter(({method})=>method==="POST")).toHaveLength(1);
    await runner.pause();
  });

  it("runs a futures Demo strategy through the trusted runner and simulated market-order route",async()=>{
    const demoRules={...rules,market:"futures" as const,symbol:"BTCSUSDT",quoteAsset:"SUSDT",maximumLeverage:"100"};
    const demoConfig={...config,id:"demo-1",name:"Demo",market:"futures" as const,symbol:"BTCSUSDT",leverage:5};
    const demoBundle:DeploymentBundle={...bundle,
      deployment:{...bundle.deployment,id:"dep-demo",mode:"futures-demo",strategyVersionId:"sv-demo"},
      strategy:{...bundle.strategy,market:"futures",symbol:"BTCSUSDT",config:demoConfig},
      risk:{...bundle.risk!,id:"risk-demo",allowedSymbols:["BTCSUSDT"],maxLeverage:"5"}};
    const demoQuote={...quote,market:"futures" as const,symbol:"BTCSUSDT"};
    const demoEvidence={...evidence,
      risk:{...evidence.risk,market:"futures" as const,symbol:"BTCSUSDT",leverage:"5"}};
    const repository=new MemoryRepository();const market=new MarketStreamState();market.record(demoQuote);
    const clock=new ClockFreshnessGuard();clock.record({synchronizedAt:NOW,driftMs:0});
    const connection=new ConnectionRegistry();connection.record({verifiedAt:NOW,apiKeySuffix:"1234",canTrade:true,
      withdrawalPermission:"unknown",permissions:{read:true,spot:false,futures:true}});
    const balances=[{asset:"SUSDT",balance:"1000",availableBalance:"1000",frozen:"0",unrealizePnl:"0"}];
    const transport=new Transport([probe(),ok(balances),(request)=>ok({orderId:"demo-42",
      clientOrderId:JSON.parse(request.body??"{}").newClientOrderId})]);
    const client=createVaultWeexExecutionClient({brokerId:BROKER_ID,vault,transport,now:()=>NOW,
      rulesProvider:async()=>({rules:demoRules,verifiedAt:NOW})});
    const sandbox={evaluate:vi.fn(async()=>({signal:{id:"signal-demo",action:"buy" as const,reason:"sandbox-buy",
      allocationRate:0.1,createdAt:NOW},scriptHash:"c".repeat(64),durationMs:1})),dispose:vi.fn(async()=>undefined)} satisfies StrategySandboxLike;
    const runner=new LiveRunRunner({brokerId:BROKER_ID,repository,client,market,clock,connection,
      instruments:{requireFresh:()=>demoRules},
      runtimeAudit:vi.fn(),runAudit:vi.fn(),createStrategyWorker:()=>new StrategyWorker(async()=>sandbox,1_000),now:()=>NOW});
    const request=buildLiveEvaluationRequest({bundle:demoBundle,market:{...marketSnapshot,rules:demoRules},quote:demoQuote,
      account:demoEvidence,signalSequence:1});

    await runner.resume(demoBundle);
    await expect(runner.evaluate(request)).resolves.toMatchObject({status:"proposed",outcome:{status:"submitted",
      order:{executionTarget:{market:"futures",mode:"futures-demo"},status:"acknowledged"}}});
    const posted=transport.requests.find(({method})=>method==="POST");
    expect(posted?.url).toBe("https://api-contract.weex.com/capi/v3/sim/order");
    expect(JSON.parse(posted?.body??"{}")).toMatchObject({type:"MARKET",symbol:"BTCSUSDT"});
    await runner.pause();
  });
});
