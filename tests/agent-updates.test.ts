import { describe, expect, it, vi } from "vitest";

import { createAgentUpdateHandler } from "../lib/server/agent-updates";

const tag = "agent-v1.2.3";
const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const asset = (name: string, value: string, size = 1_024) => ({ name, state: "uploaded", size, digest: digest(value),
  browser_download_url: `https://github.com/ZUOZUOTW/cryptobot-labs/releases/download/${tag}/${name}` });
const release = { tag_name: tag, draft: false, prerelease: false, published_at: "2026-07-13T00:00:00.000Z",
  assets: [asset("CryptoBot Labs Agent-darwin-arm64-1.2.3.zip", "a"),
    asset("CryptoBot Labs Agent-darwin-x64-1.2.3.zip", "b"), asset("CryptoBot-Labs-Agent-Setup.exe", "c"),
    asset("SHA256SUMS", "d"), asset("agent-sbom.cdx.json", "e"), asset("RELEASES", "f"),
    asset("cryptobot_labs_agent-1.2.3-full.nupkg", "1", 2_048)] };
const context = (platform: string, version: string, metadata: string) => ({
  params: Promise.resolve({ platform, version, metadata: [metadata] }) });

describe("Agent update feeds", () => {
  it("returns a no-store Squirrel.Mac feed only for a newer signed release", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(release), { status: 200 }));
    const response = await createAgentUpdateHandler(fetcher as typeof fetch)(context("darwin-arm64", "1.2.2", "feed"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ name: "1.2.3", url: expect.stringContaining("darwin-arm64") });
    expect((await createAgentUpdateHandler(fetcher as typeof fetch)(context("darwin-arm64", "1.2.3", "feed"))).status).toBe(204);
  });

  it("validates and rewrites Windows RELEASES to an absolute official package URL", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/RELEASES")
      ? new Response(`${"A".repeat(40)} cryptobot_labs_agent-1.2.3-full.nupkg 2048\n`, { status: 200 })
      : new Response(JSON.stringify(release), { status: 200 }));
    const response = await createAgentUpdateHandler(fetcher as typeof fetch)(context("win32-x64", "1.2.2", "RELEASES"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`${"A".repeat(40)} https://github.com/ZUOZUOTW/cryptobot-labs/releases/download/${tag}/cryptobot_labs_agent-1.2.3-full.nupkg 2048\n`);
    const poisoned = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/RELEASES")
      ? new Response(`${"A".repeat(40)} other.nupkg 2048\n`, { status: 200 })
      : new Response(JSON.stringify(release), { status: 200 }));
    expect((await createAgentUpdateHandler(poisoned as typeof fetch)(context("win32-x64", "1.2.2", "RELEASES"))).status).toBe(503);
  });
});
