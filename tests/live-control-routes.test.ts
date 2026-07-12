import { describe, expect, it, vi } from "vitest";
import type { DeploymentRecord, RiskPolicyRecord } from "../db/repositories/deployments";
import { createRunService } from "../lib/server/runs";
import { CommandServiceError, createCommandService } from "../lib/server/commands";

const risk: RiskPolicyRecord = { id:"risk_1",userId:"usr_1",deploymentId:"run_1",allowedSymbolsJson:'["BTCUSDT"]',
  maxOrderNotional:"100",maxPositionNotional:"500",maxTotalExposure:"1000",maxSimultaneousPositions:2,
  maxDailyLoss:"50",maxLeverage:"3",maxSlippageBps:30,minSignalCooldownMs:0,maxConsecutiveFailures:3,
  operationMode:"approval-required",createdAt:390_000,updatedAt:390_000 };
const deployment:DeploymentRecord={id:"run_1",userId:"usr_1",deviceId:"dev_1",strategyVersionId:"sv_1",name:"Orbit",
  mode:"paper",state:"running",version:3,configurationHash:"a".repeat(64),createdAt:390_000,updatedAt:390_000,startedAt:390_000,stoppedAt:null};

describe("run control service",()=>{
  it("requires an exact approved-content envelope for independent agent revalidation",async()=>{
    const enqueue=vi.fn().mockResolvedValue({command:{},idempotent:false});
    const service=createCommandService({enqueue} as never,{now:()=>400_000});
    const base={id:null,deploymentId:"run_1",type:"request-live-unlock",version:1,correlationId:"request-live-1",expectedDeploymentVersion:3,expiresAt:500_000};
    const revalidate={localConnection:true,permissions:true,fetchCurrentProductMetadata:true,connectionVersion:7,
      deploymentConfigurationHash:"a".repeat(64),strategyMarket:"futures",allowedSymbols:["BTCUSDT"],
      strategyVersionId:"sv_1",
      riskPolicy:{id:"risk_1",versionFence:{updatedAt:390_000},hash:"b".repeat(64)}};
    await expect(service.enqueue("usr_1",{...base,payload:{confirmationId:"request-live-1",riskAcceptedAt:399_999,revalidate:{...revalidate,fetchCurrentProductMetadata:false}}})).rejects.toThrow(/revalidation/i);
    await expect(service.enqueue("usr_1",{...base,payload:{confirmationId:"request-live-1",riskAcceptedAt:399_999,revalidate}})).resolves.toBeTruthy();
  });
  it("creates every new run in paper mode",async()=>{
    const deployments={create:vi.fn().mockImplementation(async(input)=>({deployment:{...deployment,id:input.id,mode:input.mode,name:input.name},risk:{...risk,id:input.risk.id,deploymentId:input.id}})),getForUser:vi.fn(),getRiskForUser:vi.fn().mockResolvedValue(risk),listForUser:vi.fn()};
    const getEvidenceForUser=vi.fn().mockResolvedValue({health:null,positions:[],openOrders:[],pnl:null,heartbeatOccurredAt:null,heartbeatExpectedDeploymentVersion:null,lastSignal:null,riskBlocks:[]});
    const service=createRunService({deployments:deployments as never,liveData:{getEvidenceForUser,getMarketForUser:vi.fn().mockResolvedValue("futures"),getConnectionForUser:vi.fn()} as never,commands:{enqueue:vi.fn()} as never,now:()=>400_000});
    const created=await service.create("usr_1","request-1",{deviceId:"dev_1",strategyVersionId:"sv_1",botName:"Orbit",configurationHash:"a".repeat(64),riskPolicy:{allowedSymbols:["BTCUSDT"],maxOrderNotional:"100",maxPositionNotional:"500",maxTotalExposure:"1000",maxSimultaneousPositions:2,maxDailyLoss:"50",maxLeverage:"3",maxSlippageBps:30,minSignalCooldownMs:0,maxConsecutiveFailures:3,operationMode:"approval-required"}});
    expect(deployments.create).toHaveBeenCalledWith(expect.objectContaining({mode:"paper"}));
    expect(created.run).toMatchObject({market:"futures",pnl:null,evidence:{heartbeatOccurredAt:null,heartbeatExpectedDeploymentVersion:null,pnlSource:null}});
    expect(getEvidenceForUser).toHaveBeenCalledWith("usr_1",created.run.id,3);
  });

  it("queues a version-fenced live request with explicit independent agent revalidation",async()=>{
    const enqueue=vi.fn().mockResolvedValue({command:{id:"cmd_1",deploymentId:"run_1",type:"request-live-unlock",version:1,correlationId:"request-live-1",expectedDeploymentVersion:3,status:"pending",createdAt:400_000,expiresAt:700_000},idempotent:false});
    const service=createRunService({deployments:{getForUser:vi.fn().mockResolvedValue(deployment),getRiskForUser:vi.fn().mockResolvedValue(risk)} as never,liveData:{getEvidenceForUser:vi.fn(),getMarketForUser:vi.fn().mockResolvedValue("futures"),getConnectionForUser:vi.fn().mockResolvedValue({status:"verified",hasLocalCredential:true,withdrawalAccessAbsent:true,version:7,verifiedAt:399_000,permissions:{read:true,spotTrade:false,futuresTrade:true,withdrawal:false}})} as never,commands:{enqueue} as never,now:()=>400_000});
    const result=await service.unlock("usr_1","run_1","request-live-1",{expectedVersion:3,typedBotName:"Orbit",riskAcknowledged:true,acceptedAt:399_999});
    expect(result.agentMustRevalidate).toBe(true);
    expect(enqueue).toHaveBeenCalledWith("usr_1",expect.objectContaining({expectedDeploymentVersion:3,payload:expect.objectContaining({revalidate:expect.objectContaining({
      localConnection:true,permissions:true,fetchCurrentProductMetadata:true,connectionVersion:7,
      deploymentConfigurationHash:"a".repeat(64),strategyMarket:"futures",allowedSymbols:["BTCUSDT"],
      strategyVersionId:"sv_1",
      riskPolicy:expect.objectContaining({id:"risk_1",versionFence:{updatedAt:390_000},hash:expect.stringMatching(/^[a-f0-9]{64}$/)}),
    })})}));
  });

  it("does not let cancel or close ride along with stop-new-orders",async()=>{
    const enqueue=vi.fn().mockResolvedValue({command:{id:"cmd_1",deploymentId:"run_1",type:"stop-new-orders",version:1,correlationId:"request-stop-1",expectedDeploymentVersion:3,status:"pending",createdAt:400_000,expiresAt:700_000},idempotent:false});
    const service=createRunService({deployments:{getForUser:vi.fn().mockResolvedValue(deployment)} as never,liveData:{} as never,commands:{enqueue} as never,now:()=>400_000});
    await service.command("usr_1","run_1","request-stop-1",{type:"stop-new-orders",expectedVersion:3,reason:"manual"});
    expect(enqueue).toHaveBeenCalledWith("usr_1",expect.objectContaining({type:"stop-new-orders",payload:{reason:"manual"}}));
  });

  it("maps known command boundary errors but keeps unknown storage failures retryable",async()=>{
    const base={deployments:{getForUser:vi.fn().mockResolvedValue(deployment)} as never,liveData:{} as never,now:()=>400_000};
    const request={type:"stop-new-orders",expectedVersion:3,reason:"manual"};
    await expect(createRunService({...base,commands:{enqueue:vi.fn().mockRejectedValue(new CommandServiceError("invalid-command","bad"))} as never})
      .command("usr_1","run_1","request-invalid",request)).rejects.toMatchObject({status:400,code:"invalid_request"});
    await expect(createRunService({...base,commands:{enqueue:vi.fn().mockRejectedValue(new CommandServiceError("deployment-fence","stale"))} as never})
      .command("usr_1","run_1","request-stale",request)).rejects.toMatchObject({status:409,code:"conflict"});
    await expect(createRunService({...base,commands:{enqueue:vi.fn().mockRejectedValue(new Error("temporary storage outage"))} as never})
      .command("usr_1","run_1","request-retry",request)).rejects.toMatchObject({name:"RetryableCommandStorageError"});
  });
});
