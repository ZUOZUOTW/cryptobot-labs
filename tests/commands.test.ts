import { describe, expect, it, vi } from "vitest";
import { createCommandService } from "../lib/server/commands";
import { CommandRepositoryError } from "../db/repositories/deployments";

const input=(type:string,payload:unknown)=>({id:"cmd_1",deploymentId:"dep_1",type,version:1,correlationId:"corr_1",expectedDeploymentVersion:2,payload,expiresAt:200});
const repository=()=>({enqueue:vi.fn().mockResolvedValue({command:{id:"cmd_1"},idempotent:false}),pollForDevice:vi.fn().mockResolvedValue({items:[],nextCursor:null}),ack:vi.fn().mockResolvedValue({acknowledgement:{id:"ack_1"},idempotent:false})});

describe("command service boundary",()=>{
  it("enqueues exact explicitly-schema'd command payloads",async()=>{const repo=repository();const service=createCommandService(repo as never,{now:()=>100});await service.enqueue("usr_1",input("pause",{reason:"operator"}));expect(repo.enqueue).toHaveBeenCalledWith(expect.objectContaining({type:"pause",expectedDeploymentVersion:2,userId:"usr_1"}));await expect(service.enqueue("usr_1",input("pause",{reason:"operator",extra:true}))).rejects.toThrow(/fields/i);await expect(service.enqueue("usr_1",input("unknown",{}))).rejects.toThrow(/type/i);});
  it("keeps stop, cancel, and close distinct and requires explicit close evidence",async()=>{const service=createCommandService(repository() as never,{now:()=>100});await expect(service.enqueue("usr_1",input("stop-new-orders",{reason:"risk"}))).resolves.toBeTruthy();await expect(service.enqueue("usr_1",input("cancel-open-orders",{scope:"deployment",reason:"risk"}))).resolves.toBeTruthy();await expect(service.enqueue("usr_1",input("close-positions",{scope:"all",symbol:null,confirmation:{id:"corr_1",confirmedAt:99,phrase:"CLOSE POSITIONS"}}))).resolves.toBeTruthy();await expect(service.enqueue("usr_1",input("close-positions",{scope:"all",symbol:null,confirmation:{id:"corr_1",confirmedAt:99,phrase:"yes"}}))).rejects.toThrow(/confirmation/i);});
  it("fences poll and ack by verified device and exact acknowledgement",async()=>{const repo=repository();const service=createCommandService(repo as never,{now:()=>100});await expect(service.poll({verified:false,deviceId:"dev_1"} as never,{limit:10,cursor:null})).rejects.toThrow(/verified/i);await service.poll({verified:true,deviceId:"dev_1"},{limit:10,cursor:null});expect(repo.pollForDevice).toHaveBeenCalledWith("dev_1",{now:100,limit:10,cursor:undefined});await expect(service.ack({verified:true,deviceId:"dev_1"},{id:"ack_1",commandId:"cmd_1",deploymentId:"dep_1",expectedDeploymentVersion:2,status:"ok",payload:{code:"OK",message:"done",applied:true,extra:true}})).rejects.toThrow(/fields/i);});
  it("requires acknowledgement status coherence",async()=>{const service=createCommandService(repository() as never,{now:()=>100});const ack={id:"ack_1",commandId:"cmd_1",deploymentId:"dep_1",expectedDeploymentVersion:2,payload:{code:"OK",message:"done",applied:false}};await expect(service.ack({verified:true,deviceId:"dev_1"},{...ack,status:"ok"})).rejects.toThrow(/incoherent/i);await expect(service.ack({verified:true,deviceId:"dev_1"},{...ack,status:"failed"})).resolves.toBeTruthy();});
  it("binds destructive confirmation evidence to correlation and a fresh non-future clock",async()=>{const service=createCommandService(repository() as never,{now:()=>400_000});const close=(correlationId:string,confirmedAt:number)=>({...input("close-positions",{scope:"all",symbol:null,confirmation:{id:correlationId,confirmedAt,phrase:"CLOSE POSITIONS"}}),correlationId,expiresAt:500_000});await expect(service.enqueue("usr_1",close("corr_close",399_999))).resolves.toBeTruthy();await expect(service.enqueue("usr_1",{...close("corr_close",399_999),correlationId:"corr_other"})).rejects.toThrow(/confirmation/i);await expect(service.enqueue("usr_1",close("corr_future",400_001))).rejects.toThrow(/confirmation/i);await expect(service.enqueue("usr_1",close("corr_stale",99_999))).rejects.toThrow(/confirmation/i);const revalidate={localConnection:true,permissions:true,fetchCurrentProductMetadata:true,connectionVersion:1,deploymentConfigurationHash:"a".repeat(64),strategyMarket:"spot",allowedSymbols:["BTCUSDT"],strategyVersionId:"sv_1",riskPolicy:{id:"risk_1",versionFence:{updatedAt:1},hash:"b".repeat(64)}};const unlock=(confirmationId:string,riskAcceptedAt:number,correlationId=confirmationId)=>({...input("request-live-unlock",{confirmationId,riskAcceptedAt,revalidate}),correlationId,expiresAt:500_000});await expect(service.enqueue("usr_1",unlock("corr_live",399_999))).resolves.toBeTruthy();await expect(service.enqueue("usr_1",unlock("evidence_other",399_999,"corr_live"))).rejects.toThrow(/confirmation/i);});
  it("maps only typed repository conflicts and preserves unknown storage failures",async()=>{
    const known=repository();known.enqueue.mockRejectedValueOnce(new CommandRepositoryError("deployment-fence","owned deployment version not found"));
    await expect(createCommandService(known as never,{now:()=>100}).enqueue("usr_1",input("pause",{reason:"operator"})))
      .rejects.toMatchObject({category:"deployment-fence"});
    const conflict=repository();conflict.enqueue.mockRejectedValueOnce(new CommandRepositoryError("command-conflict","command correlation conflict"));
    await expect(createCommandService(conflict as never,{now:()=>100}).enqueue("usr_1",input("pause",{reason:"operator"})))
      .rejects.toMatchObject({category:"command-conflict"});
    const unknown=repository();const outage=new Error("storage temporarily unavailable");unknown.enqueue.mockRejectedValueOnce(outage);
    await expect(createCommandService(unknown as never,{now:()=>100}).enqueue("usr_1",input("pause",{reason:"operator"})))
      .rejects.toBe(outage);
  });
  it("preserves unknown acknowledgement storage failures for safe retry",async()=>{
    const repo=repository();const outage=new Error("ack storage temporarily unavailable");repo.ack.mockRejectedValueOnce(outage);
    await expect(createCommandService(repo as never,{now:()=>100}).ack({verified:true,deviceId:"dev_1"},{
      id:"ack_1",commandId:"cmd_1",deploymentId:"dep_1",expectedDeploymentVersion:2,status:"ok",
      payload:{code:"OK",message:"done",applied:true},
    })).rejects.toBe(outage);
  });
});
