"use client";

import { useState } from "react";
import { downloadBlob } from "../lib/browser-download";
import type { BotPackageFile } from "../lib/bot-package";

export function PackageFallbackFiles({ files }: { files: BotPackageFile[] }) {
  const [error, setError] = useState("");
  return <section aria-label="單一檔案備援下載" className="package-fallback">
    <p>ZIP 下載失敗，可改為分別下載 5 個單一檔案。</p>
    <div className="package-fallback__files">{files.map((file) => <button
      aria-label={`下載單一檔案 ${file.name}`}
      key={file.name}
      onClick={() => {
        try { downloadBlob(file.blob, file.name); setError(""); }
        catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : "單一檔案下載失敗"); }
      }}
      type="button"
    >{file.name}</button>)}</div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
