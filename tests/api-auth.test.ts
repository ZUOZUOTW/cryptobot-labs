import { describe, expect, it, vi } from "vitest";
import { requireApiUser } from "../lib/server/auth";
import { requireSameOrigin } from "../lib/server/origin";
import { HttpProblem, errorResponse, readStrictJson, requestId } from "../lib/server/http";

const userRepository = () => ({
  upsertIdentity: vi.fn(async (input: { id: string; email: string; displayName: string; now: number }) => ({
    id: input.id, normalizedEmail: input.email, displayName: input.displayName, createdAt: input.now, updatedAt: input.now,
  })),
});
const request = (method = "POST", headers: Record<string,string> = {}) => new Request("https://app.example.test/api/x", { method, headers });

describe("API platform identity", () => {
  it("returns 401 for missing identity and ignores spoofed client identity headers", async () => {
    const repository=userRepository();
    const result=await requireApiUser(request("GET",{"oai-authenticated-user-email":"spoof@example.com"}),{
      identityProvider:{getIdentity:async()=>null},userRepository:repository,deriveUserId:async()=>"usr_spoof",now:()=>1,
    });
    expect(result.ok).toBe(false); if(result.ok) return;
    expect(result.response.status).toBe(401); expect(result.response.headers.get("cache-control")).toBe("no-store");
    expect(repository.upsertIdentity).not.toHaveBeenCalled();
  });
  it("normalizes trusted identity and delegates collision handling to the user repository", async () => {
    const repository=userRepository();
    const deriveUserId=vi.fn(async()=>"usr_a");
    const result=await requireApiUser(request("GET"),{identityProvider:{getIdentity:async()=>({email:" A@Example.COM ",displayName:" Alice "})},
      userRepository:repository,deriveUserId,now:()=>10});
    expect(result).toMatchObject({ok:true,user:{id:"usr_a",normalizedEmail:"a@example.com",displayName:"Alice"}});
    expect(deriveUserId).toHaveBeenCalledWith("a@example.com");
    expect(repository.upsertIdentity).toHaveBeenCalledWith({id:"usr_a",email:"a@example.com",displayName:"Alice",now:10});
    repository.upsertIdentity.mockRejectedValueOnce(new Error("UNIQUE normalized_email secret@example.com"));
    const conflict=await requireApiUser(request("GET"),{identityProvider:{getIdentity:async()=>({email:"a@example.com",displayName:"Alice"})},
      userRepository:repository,deriveUserId:async()=>"other",now:()=>11});
    expect(conflict.ok).toBe(false); if(!conflict.ok) expect(await conflict.response.text()).not.toContain("secret@example.com");
  });
  it("rejects malformed trusted identity",async()=>{const repository=userRepository();const result=await requireApiUser(request("GET"),{
    identityProvider:{getIdentity:async()=>({email:"bad",displayName:"X"})},userRepository:repository,deriveUserId:async()=>"usr",now:()=>1});
    expect(result.ok).toBe(false);expect(repository.upsertIdentity).not.toHaveBeenCalled();});
});

describe("strict same origin",()=>{
  const config={publicOrigin:"https://app.example.test"};
  it("allows GET without CSRF headers and same-origin unsafe requests",()=>{expect(()=>requireSameOrigin(request("GET"),config)).not.toThrow();expect(()=>requireSameOrigin(request("POST",{origin:"https://app.example.test",host:"app.example.test"}),config)).not.toThrow();});
  it.each(["https://evil.test","null"])("rejects unsafe origin %s",(origin)=>{expect(()=>requireSameOrigin(request("POST",{origin,host:"app.example.test"}),config)).toThrow(HttpProblem);});
  it("rejects missing origin unless fetch metadata proves same-origin",()=>{expect(()=>requireSameOrigin(request("POST",{host:"app.example.test"}),config)).toThrow();expect(()=>requireSameOrigin(request("POST",{host:"app.example.test","sec-fetch-site":"same-origin"}),config)).not.toThrow();expect(()=>requireSameOrigin(request("POST",{host:"evil.test","sec-fetch-site":"same-origin"}),config)).toThrow();});
  it("handles explicit localhost and trusted proxy configuration",()=>{expect(()=>requireSameOrigin(new Request("http://localhost:3000/api",{method:"POST",headers:{origin:"http://localhost:3000",host:"localhost:3000"}}),{publicOrigin:"http://localhost:3000"})).not.toThrow();expect(()=>requireSameOrigin(request("POST",{origin:"https://public.example",host:"internal:8787","x-forwarded-host":"public.example","x-forwarded-proto":"https"}),{publicOrigin:"https://public.example",trustedProxy:{enabled:true,allowedHosts:["public.example"]}})).not.toThrow();});
});

describe("HTTP safety helpers",()=>{
  it("enforces JSON content type, byte limits, and strict parsing",async()=>{await expect(readStrictJson(new Request("https://x",{method:"POST",body:"{}"}),{maximumBytes:10,parse:(v)=>v})).rejects.toMatchObject({status:415});await expect(readStrictJson(new Request("https://x",{method:"POST",headers:{"content-type":"application/json"},body:'{"abcdefgh":1}'}),{maximumBytes:5,parse:(v)=>v})).rejects.toMatchObject({status:413});await expect(readStrictJson(new Request("https://x",{method:"POST",headers:{"content-type":"application/json"},body:"{"}),{maximumBytes:10,parse:(v)=>v})).rejects.toMatchObject({status:400});await expect(readStrictJson(new Request("https://x",{method:"POST",headers:{"content-type":"application/json"},body:'{"ok":true}'}),{maximumBytes:32,parse:(v)=>{const x=v as Record<string,unknown>;if(Object.keys(x).join()!=="ok")throw new Error("strict");return x.ok;}})).resolves.toBe(true);});
  it("returns no-store credential-safe errors and validates request ids",async()=>{const response=errorResponse(new Error("secretKey=TOP_SECRET"),{status:500,code:"TOP_SECRET",requestId:"req_123"});expect(response.headers.get("cache-control")).toBe("no-store");const body=await response.text();expect(body).not.toContain("TOP_SECRET");expect(body).toContain('"code":"internal"');expect(requestId("req_ABC-123")).toBe("req_ABC-123");expect(()=>requestId("bad id")).toThrow();});
});
