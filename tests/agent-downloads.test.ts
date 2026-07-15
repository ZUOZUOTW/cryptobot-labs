import { describe, expect, it, vi } from "vitest";

import { createAgentDownloadsHandler, parseLatestAgentRelease } from "../lib/server/agent-downloads";

const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const asset = (tag: string, name: string, value: string) => ({ name, state: "uploaded", size: 1_024,
  digest: digest(value), browser_download_url: `https://github.com/ZUOZUOTW/cryptobot-labs/releases/download/${tag}/${name}` });
const release = () => { const tag = "agent-v1.2.3"; return { tag_name: tag, draft: false, prerelease: false,
  published_at: "2026-07-13T00:00:00.000Z", assets: [
    asset(tag, "CryptoBot Labs Agent-darwin-arm64-1.2.3.zip", "a"),
    asset(tag, "CryptoBot Labs Agent-darwin-x64-1.2.3.zip", "b"),
    asset(tag, "CryptoBot-Labs-Agent-Setup.exe", "c"), asset(tag, "SHA256SUMS", "d"),
    asset(tag, "agent-sbom.cdx.json", "e"), asset(tag, "RELEASES", "f"),
    asset(tag, "cryptobot_labs_agent-1.2.3-full.nupkg", "1"),
  ] }; };

describe("signed Agent downloads", () => {
  it("projects only a complete official release with digests and verification assets", () => {
    expect(parseLatestAgentRelease(release())).toMatchObject({ status: "available", version: "1.2.3",
      downloads: [{ platform: "macos-arm64", sha256: "a".repeat(64) }, { platform: "macos-x64" },
        { platform: "windows-x64" }] });
    expect(parseLatestAgentRelease({ ...release(), assets: release().assets.filter(({ name }) => name !== "SHA256SUMS") })).toBeNull();
    expect(parseLatestAgentRelease({ ...release(), assets: release().assets.map((item) => item.name.endsWith(".exe")
      ? { ...item, browser_download_url: "https://evil.example/agent.exe" } : item) })).toBeNull();
  });

  it("serves a cacheable safe projection and treats no release as unavailable", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(release()), { status: 200,
      headers: { "content-type": "application/json" } }));
    const response = await createAgentDownloadsHandler(fetcher as typeof fetch)();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("max-age=300");
    expect(await response.json()).toMatchObject({ status: "available", version: "1.2.3" });
    expect(fetcher).toHaveBeenCalledWith("https://api.github.com/repos/ZUOZUOTW/cryptobot-labs/releases/latest",
      expect.objectContaining({ headers: expect.objectContaining({ "X-GitHub-Api-Version": "2022-11-28" }) }));
    expect(await (await createAgentDownloadsHandler(vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch)()).json())
      .toEqual({ status: "unavailable" });
  });
});
