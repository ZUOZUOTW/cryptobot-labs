"use client";

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { exportBotPackage, importBotPackage } from "../../lib/bot-package";
import { validateConfig } from "../../lib/strategy-validation";
import type { BacktestReport, BotConfig } from "../../lib/types";

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
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const canExport = report !== null && validateConfig(config).valid && exportState !== "working";

  useEffect(() => {
    if (!confirmationOpen) return;
    const trigger = exportTriggerRef.current;
    cancelRef.current?.focus();
    return () => trigger?.focus();
  }, [confirmationOpen]);

  const handleConfirmationKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setConfirmationOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === cancelRef.current) {
      event.preventDefault();
      confirmRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
      event.preventDefault();
      cancelRef.current?.focus();
    }
  };

  const confirmExport = async () => {
    if (!report || !canExport) return;
    setConfirmationOpen(false);
    setExportState("working");
    setImportState((current) => current === "error" ? "idle" : current);
    setMessage("");
    let objectUrl: string | undefined;
    try {
      const blob = await exportBotPackage(config, report);
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = packageFilename(config);
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
      setExportState("complete");
      setMessage("完整策略包已開始下載。");
    } catch (error) {
      setExportState("error");
      setMessage(error instanceof Error ? error.message : "無法產生策略套件，請重試。");
    } finally {
      const urlToRevoke = objectUrl;
      if (urlToRevoke !== undefined) {
        window.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 0);
      }
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
            disabled={!canExport}
            onClick={() => setConfirmationOpen(true)}
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

      {message && <p className="package-message" role={hasError ? "alert" : "status"}>{message}</p>}

      {confirmationOpen && (
        <div
          aria-labelledby="package-confirmation-title"
          aria-modal="true"
          className="package-confirmation"
          onKeyDown={handleConfirmationKeyDown}
          role="dialog"
        >
          <div className="package-confirmation__card glass-panel">
            <p className="eyebrow">SIMULATION PACKAGE</p>
            <h3 id="package-confirmation-title">確認下載完整策略包</h3>
            <p>此套件只包含模擬策略與回測資料，無法獨立交易，也不會代表未來績效。</p>
            <div className="button-row">
              <button className="button button--ghost" onClick={() => setConfirmationOpen(false)} ref={cancelRef} type="button">取消</button>
              <button className="button button--primary" onClick={confirmExport} ref={confirmRef} type="button">確認下載</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
