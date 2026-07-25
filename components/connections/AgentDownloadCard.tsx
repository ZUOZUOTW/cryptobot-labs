"use client";

import { useEffect, useState } from "react";

const AGENTS = [
  { id: "macos-arm64", platform: "macOS", detail: "Apple Silicon（M 系列）", mark: "⌘" },
  { id: "macos-x64", platform: "macOS", detail: "Intel", mark: "⌘" },
  { id: "windows-x64", platform: "Windows", detail: "Windows 11 / 10（64 位元）", mark: "⊞" },
] as const;

type Download = { platform: typeof AGENTS[number]["id"]; name: string; url: string; sha256: string; bytes: number };
type Release = { status: "available"; version: string; publishedAt: string; downloads: Download[];
  checksumsUrl: string; sbomUrl: string };

const releaseOf = (value: unknown): Release | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.status !== "available" || typeof item.version !== "string" || !/^\d+\.\d+\.\d+$/.test(item.version)
    || typeof item.publishedAt !== "string" || !Array.isArray(item.downloads)
    || typeof item.checksumsUrl !== "string" || typeof item.sbomUrl !== "string") return null;
  const downloads = item.downloads as unknown[];
  if (downloads.length !== 3 || downloads.some((entry) => !entry || typeof entry !== "object"
    || !AGENTS.some(({ id }) => id === (entry as { platform?: unknown }).platform)
    || typeof (entry as { name?: unknown }).name !== "string" || typeof (entry as { url?: unknown }).url !== "string"
    || typeof (entry as { sha256?: unknown }).sha256 !== "string" || !/^[a-f0-9]{64}$/.test((entry as { sha256: string }).sha256)
    || !Number.isSafeInteger((entry as { bytes?: unknown }).bytes) || Number((entry as { bytes: number }).bytes) < 1)) return null;
  return item as unknown as Release;
};

export function AgentDownloadCard({ onDownloadStarted }: { onDownloadStarted?: () => void } = {}) {
  const [state, setState] = useState<"loading" | "available" | "unavailable">("loading");
  const [release, setRelease] = useState<Release | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/agent-downloads", { cache: "no-store", headers: { Accept: "application/json" },
      signal: controller.signal }).then(async (response) => {
      const parsed = response.ok ? releaseOf(await response.json()) : null;
      if (!controller.signal.aborted) { setRelease(parsed); setState(parsed ? "available" : "unavailable"); }
    }).catch(() => { if (!controller.signal.aborted) setState("unavailable"); });
    return () => controller.abort();
  }, []);
  return (
    <section className="connection-card connection-card--download" aria-labelledby="agent-download-title">
      <div className="connection-card__heading">
        <div><p className="eyebrow">LOCAL EXECUTION AGENT</p><h2 id="agent-download-title">安裝本機代理</h2></div>
        <span className={`connection-pill connection-pill--${state === "available" ? "verified" : "preview"}`}>
          {state === "available" ? `正式版 v${release!.version}` : state === "loading" ? "檢查正式版本" : "尚無正式版本"}</span>
      </div>
      <p className="connection-card__copy">
        本機代理負責保存 WEEX API 憑證及執行交易。網站不接收、傳送或保存 API Secret。
      </p>
      <div className="agent-build-grid">
        {AGENTS.map(({ id, platform, detail, mark }) => {
          const download = release?.downloads.find((item) => item.platform === id);
          return <article className="agent-build" key={id}>
            <span className="agent-build__mark" aria-hidden="true">{mark}</span>
            <div><h3>{platform}</h3><p>{detail}</p><small>{download ? `SHA-256 ${download.sha256.slice(0, 12)}…` : "僅提供通過簽章驗證的正式安裝檔"}</small></div>
            {download ? <a className="button button--primary button--small" href={download.url} onClick={onDownloadStarted}
              aria-label={`下載 ${platform} ${detail} 正式版`}>下載正式版</a>
              : <button className="button button--ghost button--small" disabled type="button"
                aria-label={`${platform} ${detail} 尚未提供下載`}>{state === "loading" ? "檢查中…" : "尚未提供下載"}</button>}
          </article>
        })}
      </div>
      <p className="connection-note" role="note">安裝檔完成簽署、安全驗證、SHA-256 與 SBOM 發布前，不會提供臨時或假下載連結。
        {release && <> <a href={release.checksumsUrl}>校驗碼</a> · <a href={release.sbomUrl}>SBOM</a></>}</p>
    </section>
  );
}
