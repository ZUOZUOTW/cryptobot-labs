"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { buildBotPackageFiles, exportBotPackage, importBotPackage, type BotPackageFile } from "../../lib/bot-package";
import { downloadBlob } from "../../lib/browser-download";
import { validateConfig } from "../../lib/strategy-validation";
import type { BacktestReport, BotConfig } from "../../lib/types";
import { DownloadConfirmationDialog } from "../DownloadConfirmationDialog";
import { PackageFallbackFiles } from "../PackageFallbackFiles";

interface PackagePanelProps {
  config: BotConfig;
  report: BacktestReport | null;
  onImport: (config: BotConfig, report: BacktestReport) => { ok: true } | { ok: false; reason: string };
}

type WorkState = "idle" | "working" | "complete" | "error";

const packageFilename = (config: BotConfig): string => {
  const slug = config.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "weex-strategy"}-package.zip`;
};

export function PackagePanel({ config, report, onImport }: PackagePanelProps) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [exportState, setExportState] = useState<WorkState>("idle");
  const [importState, setImportState] = useState<WorkState>("idle");
  const [message, setMessage] = useState("");
  const [fallbackFiles, setFallbackFiles] = useState<BotPackageFile[]>([]);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreAfterExportRef = useRef(false);
  const canExport = report !== null && validateConfig(config).valid && exportState !== "working";

  useEffect(() => {
    if (confirmationOpen || exportState === "working" || !restoreAfterExportRef.current) return;
    restoreAfterExportRef.current = false;
    exportTriggerRef.current?.focus();
  }, [confirmationOpen, exportState]);

  const confirmExport = async () => {
    if (!report || !canExport) return;
    restoreAfterExportRef.current = true;
    setConfirmationOpen(false);
    setExportState("working");
    setImportState((current) => current === "error" ? "idle" : current);
    setMessage("");
    try {
      const blob = await exportBotPackage(config, report);
      downloadBlob(blob, packageFilename(config));
      setFallbackFiles([]);
      setExportState("complete");
      setMessage("完整策略包已開始下載。");
    } catch (error) {
      setExportState("error");
      setMessage(error instanceof Error ? error.message : "無法產生策略套件，請重試。");
      try { setFallbackFiles(await buildBotPackageFiles(config, report)); }
      catch { setFallbackFiles([]); }
    }
  };

  const importPackage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setMessage("");
    setExportState((current) => current === "error" ? "idle" : current);
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setImportState("error");
      setMessage("只接受 .zip 策略套件");
      return;
    }

    setImportState("working");
    try {
      const imported = await importBotPackage(file);
      const accepted = onImport(imported.config, imported.report);
      if (!accepted.ok) throw new Error(accepted.reason);
      setImportState("complete");
      setMessage(`已匯入 ${file.name}，策略設定與回測報告已還原。`);
    } catch (error) {
      setImportState("error");
      setMessage(error instanceof Error ? error.message : "策略套件匯入失敗");
    }
  };

  const hasError = exportState === "error" || importState === "error";

  return (
    <section className="workshop-panel package-panel glass-panel" aria-labelledby="package-panel-title">
      <div className="workshop-panel__heading">
        <div>
          <p className="eyebrow">04 / PACKAGE</p>
          <h2 id="package-panel-title">策略套件</h2>
        </div>
        <span className="workshop-count">5 FILE ZIP</span>
      </div>

      <div className="package-panel__grid">
        <section aria-labelledby="package-export-title">
          <h3 id="package-export-title">下載</h3>
          <p>完成目前設定的模擬回測後，才能輸出包含設定、原始碼、報告、說明與版本資訊的套件。</p>
          <button
            className="button button--primary"
            data-package-export-trigger="true"
            disabled={!canExport}
            onClick={() => {
              restoreAfterExportRef.current = false;
              setConfirmationOpen(true);
            }}
            ref={exportTriggerRef}
            type="button"
          >
            {exportState === "working" ? "產生套件中…" : "下載完整策略包"}
          </button>
          {!report && <small>請先執行目前設定的模擬回測。</small>}
        </section>

        <section aria-labelledby="package-import-title">
          <h3 id="package-import-title">匯入</h3>
          <p>選擇 CryptoBot Labs 的 ZIP 套件；只有結構驗證成功後才會替換目前草稿。</p>
          <label className="package-file" htmlFor="package-file-input">
            <span>{importState === "working" ? "驗證套件中…" : "匯入策略 ZIP 套件"}</span>
            <input
              accept=".zip,application/zip"
              disabled={importState === "working"}
              id="package-file-input"
              onChange={importPackage}
              type="file"
            />
          </label>
        </section>
      </div>

      {message && <p className="package-message" data-tone={hasError ? "danger" : "success"} role={hasError ? "alert" : "status"}>{message}</p>}
      {fallbackFiles.length > 0 && <PackageFallbackFiles files={fallbackFiles} />}

      {confirmationOpen && (
        <DownloadConfirmationDialog
          description="此套件只包含模擬策略與回測資料，無法獨立交易，也不會代表未來績效。"
          id="package-confirmation-title"
          onCancel={() => setConfirmationOpen(false)}
          onConfirm={confirmExport}
          restoreFocusOnConfirm={false}
          title="確認下載完整策略包"
          triggerRef={exportTriggerRef}
        />
      )}
    </section>
  );
}
