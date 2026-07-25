import { fetchLatestAgentRelease } from "./agent-downloads";
import { errorResponse, jsonResponse } from "./http";

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const METADATA_BYTES = 32_768;

const newer = (latest: string, current: string): boolean => {
  const left = VERSION.exec(latest); const right = VERSION.exec(current);
  if (!left || !right) return false;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference !== 0) return difference > 0;
  }
  return false;
};

export function createAgentUpdateHandler(fetcher: typeof fetch = fetch) {
  return async (context: { params: Promise<{ platform: string; version: string; metadata: string[] }> }): Promise<Response> => {
    try {
      const { platform, version, metadata } = await context.params;
      if (!VERSION.test(version) || !["darwin-arm64", "darwin-x64", "win32-x64"].includes(platform)
        || !Array.isArray(metadata) || metadata.length !== 1) return errorResponse(null, { status: 404, code: "not_found" });
      const release = await fetchLatestAgentRelease(fetcher);
      if (!release || !newer(release.version, version)) return new Response(null, { status: 204,
        headers: { "cache-control": "no-store" } });
      if (platform.startsWith("darwin-") && metadata[0] === "feed") {
        const download = release.downloads.find(({ platform: candidate }) => candidate === `macos-${platform.slice(7)}`);
        if (!download) throw new Error("Update artifact is unavailable");
        return jsonResponse({ url: download.url, name: release.version, pub_date: release.publishedAt,
          notes: "CryptoBot Labs Agent signed update" }, { headers: { "cache-control": "no-store",
          "x-agent-artifact-sha256": download.sha256 } });
      }
      if (platform === "win32-x64" && metadata[0] === "RELEASES") {
        const response = await fetcher(release.windowsUpdate.releasesUrl, { headers: { Accept: "text/plain",
          "User-Agent": "CryptoBot-Labs-Site" } });
        if (!response.ok) throw new Error("Windows update metadata is unavailable");
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > METADATA_BYTES) throw new Error("Windows metadata is too large");
        const lines = text.trim().split(/\r?\n/); const target = release.windowsUpdate.package;
        const escaped = target.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = lines.map((line) => new RegExp(`^([A-Fa-f0-9]{40})\\s+${escaped}\\s+(\\d+)$`).exec(line))
          .find((candidate) => candidate !== null);
        if (!match || Number(match[2]) !== target.bytes) throw new Error("Windows metadata does not match the release");
        return new Response(`${match[1]!.toUpperCase()} ${target.url} ${target.bytes}\n`, { status: 200, headers: {
          "content-type": "text/plain; charset=utf-8", "cache-control": "no-store",
          "x-content-type-options": "nosniff", "x-agent-artifact-sha256": target.sha256 } });
      }
      return errorResponse(null, { status: 404, code: "not_found" });
    } catch { return errorResponse(null, { status: 503, code: "update_unavailable" }); }
  };
}
