import type { HttpRequest, HttpResponse, HttpTransport } from "@cryptobot-labs/weex-client";
import { describe, expect, it } from "vitest";

import { createLiveAccountService } from "../src/main/live-account-service";

const NOW=1_700_000_000_000;
const response=(body:unknown,headers:Record<string,string>={}):HttpResponse=>({status:200,headers,body});
class Transport implements HttpTransport {
  readonly requests:HttpRequest[]=[];
  constructor(private readonly responses:HttpResponse[]){}
  async send(request:HttpRequest){this.requests.push(request);const next=this.responses.shift();if(!next)throw new Error("unexpected request");return next;}
}
const vault={withCredentials:async<T>(operation:(value:Readonly<{apiKey:string;secretKey:string;passphrase:string}>)=>T|Promise<T>)=>
  operation({apiKey:"api-key",secretKey:"secret-key",passphrase:"passphrase"})};
const spotRules={market:"spot" as const,symbol:"BTCUSDT",baseAsset:"BTC",quoteAsset:"USDT",tickSize:"0.1",stepSize:"0.001",minimumQuantity:"0.001"};

describe("live account service",()=>{
  it("normalizes a verified flat spot account into credential-free risk evidence",async()=>{
    const account={canTrade:true,canWithdraw:false,balances:[{asset:"BTC",free:"0",locked:"0"},{asset:"USDT",free:"1000",locked:"20"}]};
    const transport=new Transport([response({symbol:"BTCUSDT",price:"50000"},{date:new Date(NOW).toUTCString()}),response(account),response(account)]);
    const evidence=await createLiveAccountService({vault,transport,now:()=>NOW}).collect({target:{market:"spot",mode:"live"},rules:spotRules,
      referencePrice:"50000",priceTimestamp:NOW,configuredLeverage:"1",local:{lastSignalAt:null,realizedDailyPnl:"0",consecutiveFailures:0,dayStartEquity:"1020"}});
    expect(evidence).toEqual({observedAt:NOW,portfolio:{equity:"1020",availableEquity:"1000",dayStartEquity:"1020",utcDay:"2023-11-14"},
      risk:{market:"spot",symbol:"BTCUSDT",now:NOW,priceTimestamp:NOW,lastSignalAt:null,openPositions:0,positionSide:"flat",
        currentPositionQuantity:"0",currentPositionNotional:"0",totalExposure:"0",realizedDailyPnl:"0",unrealizedDailyPnl:"0",
        consecutiveFailures:0,leverage:"1"}});
    expect(JSON.stringify(evidence)).not.toMatch(/api-key|secret-key|passphrase/i);
  });

  it("binds a verified hedge-mode futures position to matching local ownership evidence",async()=>{
    const balances=[{asset:"USDT",balance:"1000",availableBalance:"700",frozen:"100",unrealizePnl:"25"}];
    const config={canTrade:true,canDeposit:true,canWithdraw:false,dualSidePosition:true,updateTime:NOW};
    const positions=[{id:"7",asset:"USDT",symbol:"BTCUSDT",side:"LONG",leverage:"5",size:"0.02",openValue:"900",
      unrealizePnl:"25",updatedTime:NOW}];
    const transport=new Transport([response({symbol:"BTCUSDT",price:"50000"},{date:new Date(NOW).toUTCString()}),
      response(balances),response(config),response(balances),response(positions)]);
    const service=createLiveAccountService({vault,transport,now:()=>NOW});
    const localPosition={side:"long" as const,quantity:"0.02",entryPrice:"45000",peakPrice:"51000",troughPrice:"44000",usedMargin:"180",layerCount:1};
    await expect(service.collect({target:{market:"futures",mode:"live"},rules:{...spotRules,market:"futures",maximumLeverage:"100"},
      referencePrice:"50000",priceTimestamp:NOW,configuredLeverage:"5",local:{lastSignalAt:NOW-60_000,realizedDailyPnl:"10",consecutiveFailures:1,
        dayStartEquity:"1100",position:localPosition}})).resolves.toMatchObject({portfolio:{equity:"1025",availableEquity:"700",
          dayStartEquity:"1100",position:{entryPrice:"45000",peakPrice:"51000",usedMargin:"180"}},
        risk:{openPositions:1,positionSide:"long",currentPositionQuantity:"0.02",currentPositionNotional:"900",totalExposure:"900",
          realizedDailyPnl:"10",unrealizedDailyPnl:"25",leverage:"5"}});
    expect(transport.requests.at(-1)?.url).toBe("https://api-contract.weex.com/capi/v3/account/position/allPosition");
  });

  it("fails closed when an exchange position is not owned by local deployment state",async()=>{
    const balances=[{asset:"USDT",balance:"1000",availableBalance:"700",frozen:"100",unrealizePnl:"25"}];
    const config={canTrade:true,canDeposit:true,canWithdraw:false,dualSidePosition:true,updateTime:NOW};
    const positions=[{id:"7",asset:"USDT",symbol:"BTCUSDT",side:"LONG",leverage:"5",size:"0.02",openValue:"900",unrealizePnl:"25",updatedTime:NOW}];
    const transport=new Transport([response({symbol:"BTCUSDT",price:"50000"},{date:new Date(NOW).toUTCString()}),
      response(balances),response(config),response(balances),response(positions)]);
    await expect(createLiveAccountService({vault,transport,now:()=>NOW}).collect({target:{market:"futures",mode:"live"},
      rules:{...spotRules,market:"futures",maximumLeverage:"100"},referencePrice:"50000",priceTimestamp:NOW,configuredLeverage:"5",
      local:{lastSignalAt:null,realizedDailyPnl:"0",consecutiveFailures:0,dayStartEquity:"1000"}})).rejects.toThrow(/not owned/i);
  });
});
