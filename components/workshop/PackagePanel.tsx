"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { buildBotPackageFiles, exportBotPackage, importBotPackage, type BotPackageFile } from "../../lib/bot-package";
import { downloadBlob } from "../../lib/browser-download";
import { validateConfig } from "../../lib/strategy-validation";
import type { BacktestReport, BotConfig } from "../../lib/types";
import { demoAuthPath } from "../../lib/demo-auth";
import { usePlatformAuth } from "../PlatformAuthProvider";
import { createDemoPaperRun } from "../../lib/demo-runs";
import { backtestConfigFingerprint } from "../../lib/backtest";
import { saveDemoStrategy } from "../../lib/demo-strategies";
import { BOT_CATALOG } from "../../data/bots";
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
  const { mode: authMode, user } = usePlatformAuth();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [exportState, setExportState] = useState<WorkState>("idle");
  const [importState, setImportState] = useState<WorkState>("idle");
  const [message, setMessage] = useState("");
  const [fallbackFiles, setFallbackFiles] = useState<BotPackageFile[]>([]);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreAfterExportRef = useRef(false);
  const saveAttemptRef = useRef<string | null>(null);
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
  const requireLogin = () => { window.location.assign(demoAuthPath(`${window.location.pathname}${window.location.search}`)); };
  const saveStrategy = async () => {
    if (!user) { requireLogin(); return; }
    if (authMode === "demo") {
      saveDemoStrategy(config, report, backtestConfigFingerprint(config));
      setMessage("策略與目前回測已保存到展示帳號。"); setExportState("complete");
      return;
    }
    setExportState("working"); setMessage("");
    saveAttemptRef.current ??= `strategy-${crypto.randomUUID()}`;
    try {
      const response = await fetch("/api/strategies", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": saveAttemptRef.current },
        body: JSON.stringify({ config }),
      });
      if (response.status === 401) { requireLogin(); return; }
      if (!response.ok) throw new Error("save_failed");
      saveAttemptRef.current = null;
      setMessage("策略已保存為帳號專屬的不可變版本。正式歷史回測會另外保存資料與結果證據。");
      setExportState("complete");
    } catch {
      setMessage("正式策略暫時無法保存；未收到成功回應時會保留相同請求識別碼，重試不會建立重複版本。");
      setExportState("error");
    }
  };
  const shareStrategy = async () => {
    if (!user) { requireLogin(); return; }
    const isPublicBot = BOT_CATALOG.some((bot) => bot.id === config.id);
    if (authMode === "production" && !isPublicBot) {
      setMessage("這個自訂策略目前是私人版本；公開發布流程尚未完成前，不會產生指向其他策略的替代連結。");
      return;
    }
    const publicBot = isPublicBot ? config.id : "orbit-dca";
    const url = `${window.location.origin}/bots/${encodeURIComponent(publicBot)}?via=cryptobot-labs`;
    try { await navigator.clipboard.writeText(url); setMessage("公開分享連結已複製；分享內容綁定展示版本 v1。"); }
    catch { setMessage(url); }
  };
  const startPaper = () => {
    if (!user) { requireLogin(); return; }
    if (authMode === "production") {
      document.getElementById("formal-backtest-request")?.scrollIntoView({ behavior: "smooth", block: "start" });
      setMessage("請在「正式歷史回測」建立策略版本與回測證據；完成後即可選擇執行裝置並建立 Paper 運行。");
      return;
    }
    if (!report) { setMessage("請先完成一次快速回測，再開始 Paper。"); setExportState("error"); return; }
    const run = createDemoPaperRun({ botId: config.id, botName: config.name });
    window.location.assign(`/runs/${run.id}`);
  };

  return (
    <section className="workshop-panel package-panel glass-panel" aria-labelledby="package-panel-title">
      <div className="workshop-panel__heading">
        <div>
          <p className="eyebrow">04 / SAVE &amp; RUN</p>
          <h2 id="package-panel-title">保存、分享與開始 Paper</h2>
        </div>
        <span className="workshop-count">{authMode === "demo" ? "CLOUD DEMO" : "MEMBER WORKSPACE"}</span>
      </div>

      <div className="workshop-action-readiness" aria-label="策略發布準備狀態">
        <div data-state="ready"><span>策略設定</span><strong>已就緒</strong></div>
        <div data-state={report ? "ready" : "waiting"}><span>快速回測</span><strong>{report ? "已完成" : "待執行"}</strong></div>
        <div data-state={user ? "ready" : "waiting"}><span>會員工作區</span><strong>{user ? "已登入" : "登入後啟用"}</strong></div>
      </div>

      <div className="workshop-primary-actions">
        <article className="workshop-action-card" data-action="save">
          <div className="workshop-action-card__top"><span>01 / SAVE</span><em>{user ? "MEMBER READY" : "LOGIN REQUIRED"}</em></div>
          <h3>保存策略</h3>
          <p>將目前積木、參數與程式碼存入會員工作區，之後可回來繼續調整。</p>
          <small>不會因此啟用交易或連接 WEEX</small>
          <button aria-label="保存策略" className="button button--secondary" disabled={exportState === "working"} onClick={() => void saveStrategy()} type="button">{exportState === "working" ? "保存中…" : user ? "保存到工作區" : "登入並保存"}</button>
        </article>
        <article className="workshop-action-card" data-action="share">
          <div className="workshop-action-card__top"><span>02 / SHARE</span><em>VERSION LINK</em></div>
          <h3>建立分享連結</h3>
          <p>建立綁定策略版本與推廣來源的公開檢視連結，方便分享與討論。</p>
          <small>訪客只能查看，不會取得編輯權限</small>
          <button aria-label="建立分享連結" className="button button--secondary" onClick={() => void shareStrategy()} type="button">{user ? "複製公開連結" : "登入並建立連結"}</button>
        </article>
        <article className="workshop-action-card" data-action="paper" data-ready={Boolean(report)}>
          <div className="workshop-action-card__top"><span>03 / PAPER</span><em>{report ? "BACKTEST READY" : "RUN BACKTEST FIRST"}</em></div>
          <h3>開始 Paper</h3>
          <p>{authMode === "demo" ? "使用公開行情模擬策略運行，不連接 WEEX，也不會送出真實訂單。" : "先建立正式回測證據，再選擇執行裝置與完整風險上限。"}</p>
          <small>{report ? "快速回測已完成，可進入下一步" : "完成快速回測後即可啟用"}</small>
          <button aria-label={authMode === "demo" ? "開始 Paper" : "前往正式回測"} className="button button--primary" disabled={authMode === "demo" && !report} onClick={startPaper} type="button">{authMode === "demo" ? "開始 Paper 模擬" : "前往正式回測"}</button>
        </article>
      </div>

      <details className="legacy-package workshop-legacy-package"><summary>匯入／匯出策略檔案（進階）</summary><div className="package-panel__grid">
        <section aria-labelledby="package-export-title">
          <h3 id="package-export-title">下載</h3>
          <p>完成目前設定的 WEEX 歷史行情回測後，才能輸出包含設定、原始碼、報告、說明與版本資訊的套件。</p>
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
          {!report && <small>請先執行目前設定的 WEEX 歷史行情回測。</small>}
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
      </div></details>

      {message && <p className="package-message" data-tone={hasError ? "danger" : "success"} role={hasError ? "alert" : "status"}>{message}</p>}
      {fallbackFiles.length > 0 && <PackageFallbackFiles files={fallbackFiles} />}

      {confirmationOpen && (
        <DownloadConfirmationDialog
          description="此套件只包含策略設定與 WEEX 歷史行情回測資料，無法獨立交易，也不代表未來績效。"
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
