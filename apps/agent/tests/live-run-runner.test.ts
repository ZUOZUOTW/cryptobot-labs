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
const evidence={observedAt:NOW,portfolio:{equity:"1000",dayStartEquity:"1000",availableEquity:"1000",utcDay:"1970-01-01"},
  risk:{market:"spot" as const,symbol:"BTCUSDT",now:NOW,priceTimestamp:NOW-1,lastSignalAt:null,openPositions:0,positionSide:"flat" as const,
    currentPositionQuantity:"0",currentPositionNotional:"0",totalExposure:"0",realizedDailyPnl:"0",unrealizedDailyPnl:"0",consecutiveFailures:0,leverage:"1"}};

function setup(transport:Transport){
  const repository=new MemoryRepository();const market=new MarketStreamState();market.record(quote);
  const clock=new ClockFreshnessGuard();clock.record({synchronizedAt:NOW,driftMs:0});
  const connection=new ConnectionRegistry();connection.record({verifiedAt:NOW,apiKeySuffix:"1234",canTrade:true,withdrawalPermission:"absent",
    permissions:{read:true,spot:true,futures:true}});
  const client=createVaultWeexExecutionClient({vault,transport,now:()=>NOW,rulesProvider:async()=>({rules,verifiedAt:NOW})});
  const sandbox={evaluate:vi.fn(async()=>({signal:{id:"signal-live",action:"buy" as const,reason:"sandbox-buy",allocationRate:0.1,createdAt:NOW},
    scriptHash:"c".repeat(64),durationMs:1})),dispose:vi.fn(async()=>undefined)} satisfies StrategySandboxLike;
  const runner=new LiveRunRunner({repository,client,market,clock,connection,instruments:{requireFresh:()=>rules},runtimeAudit:vi.fn(),runAudit:vi.fn(),
    createStrategyWorker:()=>new StrategyWorker(async()=>sandbox,1_000),now:()=>NOW});
  const request=buildLiveEvaluationRequest({bundle,market:marketSnapshot,quote,account:evidence,signalSequence:1});
  return{repository,runner,request,sandbox,client};
}

describe("live run runner",()=>{
  it("submits once and reconciles an acknowledged order without resubmission",async()=>{
    let clientOrderId="";
    const transport=new Transport([probe(),account(),(request)=>{const body=JSON.parse(request.body??"{}");clientOrderId=body.newClientOrderId;
      return ok({orderId:"42",clientOrderId});},probe(),account(),()=>ok({orderId:"42",clientOrderId,symbol:"BTCUSDT",side:"BUY",origQty:"0.102",
        executedQty:"0.102",avgPrice:"98",status:"FILLED"}),ok([{symbol:"BTCUSDT",commission:"0.01"}])]);
    const {runner,request,repository}=setup(transport);await runner.resume(bundle);
    await expect(runner.evaluate(request)).resolves.toMatchObject({status:"proposed",outcome:{status:"submitted",order:{status:"acknowledged"}}});
    const reconciled=await runner.evaluate(request);
    expect(reconciled).toMatchObject({status:"proposed",outcome:{status:"idempotent",order:{status:"filled"}}});
    expect(transport.requests.filter(({method})=>method==="POST")).toHaveLength(1);
    expect([...repository.orders.values()][0]).toMatchObject({status:"filled",exchangeOrderId:"42"});
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
});
