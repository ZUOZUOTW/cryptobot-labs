import { describe, expect, it, vi } from "vitest";
import { createDeviceEventService, parseDeviceEvent } from "../lib/server/device-events";

const base=(type:string,payload:unknown)=>({version:1,id:"evt_1",type,deploymentId:"dep_1",expectedDeploymentVersion:2,correlationId:"corr_1",occurredAt:100,payload});

describe("device event boundary",()=>{
  it("accepts only exact envelopes and event types",()=>{
    expect(()=>parseDeviceEvent({...base("agent-error",{code:"E_AGENT",message:"offline",retryable:true}),extra:true})).toThrow(/fields/i);
    expect(()=>parseDeviceEvent(base("made-up",{}))).toThrow(/type/i);
    expect(parseDeviceEvent(base("agent-error",{code:"E_AGENT",message:"offline",retryable:true}))).toMatchObject({type:"agent-error",expectedDeploymentVersion:2});
  });
  it.each(["secretKey","pass_phrase","ＡＰＩ＿ＫＥＹ","authorization","access-sign","cookie","private-key","raw_account"])("rejects sensitive name %s recursively",(name)=>{
    expect(()=>parseDeviceEvent(base("agent-error",{code:"E",message:"safe",retryable:true,nested:{[name]:"value"}}))).toThrow(/forbidden|credential/i);
  });
  it("rejects secret-shaped values and only accepts a fixed masked suffix",()=>{
    expect(()=>parseDeviceEvent(base("agent-error",{code:"E",message:"Bearer abcdefghijklmnop",retryable:true}))).toThrow(/credential/i);
    expect(()=>parseDeviceEvent(base("key-rotated",{apiKeySuffix:"ABC123"}))).toThrow(/suffix/i);
    expect(parseDeviceEvent(base("key-rotated",{apiKeySuffix:"****A1B2"})).payload).toEqual({apiKeySuffix:"****A1B2"});
  });
  it("does not trust nested deployment identity and dispatches verified device identity",async()=>{
    expect(()=>parseDeviceEvent(base("heartbeat",{heartbeat:{deploymentId:"dep_other",sequence:1,occurredAt:100,mode:"paper",state:"running",health:"healthy",positions:[]},positionIds:[]}))).toThrow(/fence/i);
    const activity={appendDeviceAudit:vi.fn().mockResolvedValue({event:{id:"evt_1"},idempotent:false})};
    const deployments={getForDevice:vi.fn().mockResolvedValue({id:"dep_1",deviceId:"dev_verified",version:2})};
    const service=createDeviceEventService(activity as never,{deployments:deployments as never,now:()=>101});
    await service.ingest({verified:true,deviceId:"dev_verified"},base("agent-error",{code:"E",message:"safe",retryable:true}));
    expect(activity.appendDeviceAudit).toHaveBeenCalledWith(expect.objectContaining({deviceId:"dev_verified",deploymentId:"dep_1"}));
  });
  it("checks the expected deployment version before every dispatch",async()=>{
    const activity={appendDeviceAudit:vi.fn()};
    const deployments={getForDevice:vi.fn().mockResolvedValue({id:"dep_1",deviceId:"dev_1",version:3})};
    const service=createDeviceEventService(activity as never,{deployments:deployments as never,now:()=>100});
    await expect(service.ingest({verified:true,deviceId:"dev_1"},base("agent-error",{code:"E",message:"safe",retryable:true}))).rejects.toMatchObject({category:"deployment-fence"});
    expect(activity.appendDeviceAudit).not.toHaveBeenCalled();
  });
});
