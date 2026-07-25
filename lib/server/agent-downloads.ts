import { errorResponse, jsonResponse } from "./http";

const REPOSITORY = "ZUOZUOTW/cryptobot-labs";
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const VERSION = /^agent-v(\d+\.\d+\.\d+)$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_ASSET_BYTES = 536_870_912;

export interface AgentDownload {
  readonly platform: "macos-arm64" | "macos-x64" | "windows-x64";
  readonly name: string;
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface AgentReleaseDownloads {
  readonly status: "available";
  readonly version: string;
  readonly publishedAt: string;
  readonly downloads: readonly AgentDownload[];
  readonly checksumsUrl: string;
  readonly sbomUrl: string;
  readonly windowsUpdate: { readonly releasesUrl: string; readonly package: AgentDownload };
}

type Asset = { name: string; state: string; size: number; digest: string; browser_download_url: string };

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object"
  && !Array.isArray(value) ? value as Record<string, unknown> : null;

function safeAsset(value: unknown, tag: string): Asset | null {
  const item = record(value);
  if (!item || typeof item.name !== "string" || typeof item.state !== "string"
    || !Number.isSafeInteger(item.size) || Number(item.size) < 1 || Number(item.size) > MAX_ASSET_BYTES
    || typeof item.digest !== "string" || !DIGEST.test(item.digest)
    || typeof item.browser_download_url !== "string") return null;
  let url: URL;
  try { url = new URL(item.browser_download_url); } catch { return null; }
  const expected = `/${REPOSITORY}/releases/download/${tag}/${item.name}`;
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password
    || url.search || url.hash || pathname !== expected) return null;
  return { name: item.name, state: item.state, size: Number(item.size), digest: item.digest,
    browser_download_url: url.href };
}

export function parseLatestAgentRelease(value: unknown): AgentReleaseDownloads | null {
  const release = record(value);
  if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string"
    || typeof release.published_at !== "string" || !Array.isArray(release.assets)) return null;
  const match = VERSION.exec(release.tag_name);
  const publishedAt = Date.parse(release.published_at);
  if (!match || !Number.isSafeInteger(publishedAt) || publishedAt < 1 || release.assets.length > 30) return null;
  const version = match[1]!;
  const assets = release.assets.map((asset) => safeAsset(asset, release.tag_name as string));
  if (assets.some((asset) => asset === null)) return null;
  const byName = new Map((assets as Asset[]).map((asset) => [asset.name, asset]));
  if (byName.size !== assets.length) return null;
  const required = {
    "macos-arm64": `CryptoBot Labs Agent-darwin-arm64-${version}.zip`,
    "macos-x64": `CryptoBot Labs Agent-darwin-x64-${version}.zip`,
    "windows-x64": "CryptoBot-Labs-Agent-Setup.exe",
  } as const;
  const checksum = byName.get("SHA256SUMS"); const sbom = byName.get("agent-sbom.cdx.json");
  const releases = byName.get("RELEASES");
  const windowsPackages = [...byName.values()].filter(({ name }) =>
    new RegExp(`^cryptobot_labs_agent-${version.replaceAll(".", "\\.")}-full\\.nupkg$`, "i").test(name));
  if (!checksum || !sbom || !releases || windowsPackages.length !== 1 || checksum.state !== "uploaded"
    || sbom.state !== "uploaded" || releases.state !== "uploaded" || windowsPackages[0]!.state !== "uploaded") return null;
  const downloads = Object.entries(required).map(([platform, name]) => {
    const asset = byName.get(name);
    if (!asset || asset.state !== "uploaded") return null;
    return { platform: platform as AgentDownload["platform"], name, url: asset.browser_download_url,
      sha256: asset.digest.slice("sha256:".length), bytes: asset.size };
  });
  if (downloads.some((download) => download === null)) return null;
  const windowsPackage = windowsPackages[0]!;
  return { status: "available", version, publishedAt: new Date(publishedAt).toISOString(),
    downloads: downloads as AgentDownload[], checksumsUrl: checksum.browser_download_url,
    sbomUrl: sbom.browser_download_url, windowsUpdate: { releasesUrl: releases.browser_download_url,
      package: { platform: "windows-x64", name: windowsPackage.name, url: windowsPackage.browser_download_url,
        sha256: windowsPackage.digest.slice("sha256:".length), bytes: windowsPackage.size } } };
}

export async function fetchLatestAgentRelease(fetcher: typeof fetch = fetch): Promise<AgentReleaseDownloads | null> {
  const response = await fetcher(RELEASE_API, { headers: { Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "CryptoBot-Labs-Site" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Release lookup failed");
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error("Release response is too large");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error("Release response is too large");
  return parseLatestAgentRelease(JSON.parse(text) as unknown);
}

export function createAgentDownloadsHandler(fetcher: typeof fetch = fetch) {
  return async (): Promise<Response> => {
    try {
      const parsed = await fetchLatestAgentRelease(fetcher);
      return jsonResponse(parsed ?? { status: "unavailable" }, { headers: {
        "cache-control": "public, max-age=300, stale-if-error=3600", "x-content-type-options": "nosniff" } });
    } catch { return errorResponse(null, { status: 503, code: "release_unavailable" }); }
  };
}
