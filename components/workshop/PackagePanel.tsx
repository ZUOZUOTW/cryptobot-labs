"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  buildBotPackageFiles,
  exportBotPackage,
  importBotPackage,
  type BotPackageFile,
} from "../../lib/bot-package";
import { validateConfig } from "../../lib/strategy-validation";
import type { BacktestReport, BotConfig } from "../../lib/types";
import { demoAuthPath } from "../../lib/demo-auth";
import { usePlatformAuth } from "../PlatformAuthProvider";
import { backtestConfigFingerprint } from "../../lib/backtest";
import { saveDemoStrategy } from "../../lib/demo-strategies";
import type { SignalFlowCheckState } from "./StrategySummary";
import { validateStrategyName } from "../../lib/strategy-name";
import { downloadBlob } from "../../lib/browser-download";
import { DownloadConfirmationDialog } from "../DownloadConfirmationDialog";
import { PackageFallbackFiles } from "../PackageFallbackFiles";

interface PackagePanelProps {
  config: BotConfig;
  flowCheckState?: SignalFlowCheckState;
  formalEvidence?: { strategyVersionId: string; backtestJobId: string };
  report: BacktestReport | null;
  onImport: (config: BotConfig, report: BacktestReport | null) => { ok: true } | { ok: false; reason: string };
}

type WorkState = "idle" | "working" | "complete" | "error";
interface SavedVersion { id: string; configHash: string }
interface PublishedPublication { slug: string; updatedAt: number }

const ACTION_MASCOTS = {
  save: "/mascots/ai-strategy-vault-v1.webp",
  publish: "/mascots/ai-version-broadcast-v1.webp",
} as const;

function ActionVisual({ type }: { type: keyof typeof ACTION_MASCOTS }) {
  return (
    <div className="workshop-action-visual" data-visual={type} aria-hidden="true">
      <Image alt="" className="workshop-action-visual__mascot" height={1086} priority={false} src={ACTION_MASCOTS[type]} width={1448} />
      <span className="workshop-action-visual__beam" />
    </div>
  );
}

const safeFilenameStem = (config: BotConfig): string => (
  config.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "weex-strategy"
);

export function PackagePanel({ config, flowCheckState = "untested", formalEvidence, report, onImport }: PackagePanelProps) {
  const { mode: authMode, user } = usePlatformAuth();
  const fingerprint = backtestConfigFingerprint(config);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [exportState, setExportState] = useState<WorkState>("idle");
  const [backupState, setBackupState] = useState<WorkState>("idle");
  const [actionState, setActionState] = useState<WorkState>("idle");
  const [publishState, setPublishState] = useState<WorkState>("idle");
  const [shareState, setShareState] = useState<WorkState>("idle");
  const [importState, setImportState] = useState<WorkState>("idle");
  const [message, setMessage] = useState("");
  const [description, setDescription] = useState("");
  const [weexReferralUrl, setWeexReferralUrl] = useState("");
  const [fallback, setFallback] = useState<{ fingerprint: string; files: BotPackageFile[] } | null>(null);
  const [publication, setPublication] = useState<{ fingerprint: string; slug: string; url: string } | null>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const exportInFlightRef = useRef(false);
  const restoreAfterExportRef = useRef(false);
  const latestFingerprintRef = useRef(fingerprint);
  const saveAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const savedVersionRef = useRef<{ fingerprint: string; version: SavedVersion } | null>(null);
  const configurationReady = validateConfig(config).valid;
  const strategyName = validateStrategyName(config.name);
  const exportableReport = report;
  const canExport = exportableReport !== null && configurationReady && exportState !== "working";
  const publishedUrl = publication?.fingerprint === fingerprint ? publication.url : "";
  const flowCheckLabel = flowCheckState === "passed" ? "通過測試" : flowCheckState === "failed" ? "未通過測試" : "未測試";

  useEffect(() => {
    if (confirmationOpen || exportState === "working" || !restoreAfterExportRef.current) return;
    restoreAfterExportRef.current = false;
    exportTriggerRef.current?.focus();
  }, [confirmationOpen, exportState]);

  useEffect(() => {
    latestFingerprintRef.current = fingerprint;
  }, [fingerprint]);

  const confirmExport = async () => {
    if (!exportableReport || !canExport || exportInFlightRef.current) return;
    exportInFlightRef.current = true;
    const exportFingerprint = fingerprint;
    const exportConfig = config;
    const packageReport = exportableReport;
    restoreAfterExportRef.current = true;
    setConfirmationOpen(false);
    setExportState("working");
    setImportState((current) => current === "error" ? "idle" : current);
    setBackupState((current) => current === "error" ? "idle" : current);
    setMessage("");
    try {
      const blob = await exportBotPackage(exportConfig, packageReport);
      if (latestFingerprintRef.current !== exportFingerprint) {
        throw new Error("策略設定已變更，請以目前設定重新完成回測後再匯出。");
      }
      downloadBlob(blob, `${safeFilenameStem(exportConfig)}-package.zip`);
      setFallback(null);
      setExportState("complete");
      setMessage("完整策略包已開始下載。");
    } catch (error) {
      let nextFallback: BotPackageFile[] = [];
      if (latestFingerprintRef.current !== exportFingerprint) {
        setFallback(null);
      } else {
        try {
          nextFallback = await buildBotPackageFiles(exportConfig, packageReport);
        } catch {
          nextFallback = [];
        }
        setFallback(nextFallback.length > 0 ? { fingerprint: exportFingerprint, files: nextFallback } : null);
      }
      setExportState("error");
      setMessage(error instanceof Error ? error.message : "無法產生策略套件，請重試。");
    } finally {
      exportInFlightRef.current = false;
    }
  };

  const downloadDraftBackup = () => {
    setMessage("");
    setBackupState("working");
    try {
      const blob = new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: "application/json" });
      downloadBlob(blob, `${safeFilenameStem(config)}-draft-backup.json`);
      setBackupState("complete");
      setMessage("草稿備份 JSON 已開始下載；此檔案不是可執行策略套件。");
    } catch (error) {
      setBackupState("error");
      setMessage(error instanceof Error ? error.message : "草稿備份 JSON 下載失敗");
    }
  };

  const importPackage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setMessage("");
    setActionState((current) => current === "error" ? "idle" : current);
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
      setMessage(imported.report
        ? `已匯入 ${file.name}，策略設定與可重現的模擬報告已還原。`
        : `已匯入 ${file.name} 的策略設定；跨裝置歷史證據不作為驗證依據，請重新執行行情回測。`);
    } catch (error) {
      setImportState("error");
      setMessage(error instanceof Error ? error.message : "策略套件匯入失敗");
    }
  };

  const hasError = exportState === "error" || backupState === "error" || actionState === "error" || publishState === "error"
    || shareState === "error" || importState === "error";
  const requireLogin = () => { window.location.assign(demoAuthPath(`${window.location.pathname}${window.location.search}`)); };
  const parseSavedVersion = (value: unknown): SavedVersion | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const strategyVersion = (value as { strategyVersion?: unknown }).strategyVersion;
    if (!strategyVersion || typeof strategyVersion !== "object" || Array.isArray(strategyVersion)) return null;
    const record = strategyVersion as Record<string, unknown>;
    return typeof record.id === "string" && typeof record.configHash === "string"
      && /^[a-f0-9]{64}$/.test(record.configHash) ? { id: record.id, configHash: record.configHash } : null;
  };
  const saveStrategy = async (announce = true): Promise<SavedVersion | null> => {
    if (!strategyName.valid) {
      setMessage(strategyName.reason);
      setActionState("error");
      return null;
    }
    if (!configurationReady) {
      setMessage("請先完成有效的策略名稱、進場條件與風控設定。");
      setActionState("error");
      return null;
    }
    if (!user) { requireLogin(); return null; }
    if (authMode === "demo") {
      saveDemoStrategy(config, report, backtestConfigFingerprint(config));
      if (announce) setMessage("策略與目前回測已保存到展示帳號。");
      setActionState("complete");
      return null;
    }
    if (savedVersionRef.current?.fingerprint === fingerprint) return savedVersionRef.current.version;
    setActionState("working"); setMessage("");
    if (saveAttemptRef.current?.fingerprint !== fingerprint) {
      saveAttemptRef.current = { fingerprint, key: `strategy-${crypto.randomUUID()}` };
    }
    try {
      const response = await fetch("/api/strategies", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": saveAttemptRef.current.key },
        body: JSON.stringify({ config }),
      });
      if (response.status === 401) { requireLogin(); return null; }
      const body = await response.json().catch(() => null) as unknown;
      const version = parseSavedVersion(body);
      if (!response.ok || !version) throw new Error("save_failed");
      savedVersionRef.current = { fingerprint, version };
      saveAttemptRef.current = null;
      if (announce) setMessage("策略已保存為帳號專屬的不可變版本。正式歷史回測會另外保存資料與結果證據。");
      setActionState("complete");
      return version;
    } catch {
      setMessage("正式策略暫時無法保存；未收到成功回應時會保留相同請求識別碼，重試不會建立重複版本。");
      setActionState("error");
      return null;
    }
  };

  const validReferralUrl = (value: string): boolean => {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      return url.protocol === "https:" && !url.username && !url.password && !url.hash
        && (url.port === "" || url.port === "443")
        && (hostname === "weex.com" || hostname.endsWith(".weex.com"));
    } catch { return false; }
  };
  const parsePublishedPublication = (value: unknown): PublishedPublication | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = (value as { publication?: unknown }).publication;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const record = candidate as Record<string, unknown>;
    return typeof record.slug === "string" && /^[a-z0-9][a-z0-9-]{7,79}$/.test(record.slug)
      && Number.isSafeInteger(record.updatedAt) && Number(record.updatedAt) >= 0
      ? { slug: record.slug, updatedAt: record.updatedAt as number }
      : null;
  };
  const publicationUrl = ({ slug, updatedAt }: PublishedPublication): string => {
    const url = new URL(`/strategies/${encodeURIComponent(slug)}`, window.location.origin);
    url.searchParams.set("v", String(updatedAt));
    return url.toString();
  };

  const publishStrategy = async () => {
    if (!strategyName.valid) {
      setMessage(strategyName.reason);
      setPublishState("error");
      return;
    }
    if (!user) { requireLogin(); return; }
    if (publishedUrl) {
      setMessage("目前策略版本已發布；分享連結不會重新發布或變更策略。");
      return;
    }
    if (authMode === "demo") {
      setMessage("展示環境不會發布會員策略；請登入正式會員帳號後再發布。");
      setPublishState("error");
      return;
    }
    if (!configurationReady || flowCheckState !== "passed" || !report?.evidence?.complete) {
      setMessage("發布前請先通過訊號流程測試，並完成具有完整 WEEX 歷史行情證據的回測。");
      setPublishState("error");
      return;
    }
    const publicDescription = description.trim()
      || `${config.name} 使用 ${config.symbol} ${config.timeframe} 週期，由 ${config.blocks.length} 個進出場、倉位與風控模組組成。`;
    if (publicDescription.length < 20 || publicDescription.length > 400) {
      setMessage("公開介紹需為 20–400 個字元。");
      setPublishState("error");
      return;
    }

    setPublishState("working");
    setMessage("正在固定策略版本並建立正式歷史回測證據…");
    try {
      let strategyVersionId: string;
      let backtestJobId: string;
      if (formalEvidence) {
        strategyVersionId = formalEvidence.strategyVersionId;
        backtestJobId = formalEvidence.backtestJobId;
      } else {
        const version = await saveStrategy(false);
        if (!version) throw new Error("save_failed");
        const backtestKey = `publish-backtest-${crypto.randomUUID()}`;
        const backtestResponse = await fetch("/api/backtests", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "Idempotency-Key": backtestKey },
          body: JSON.stringify({
            strategyVersionId: version.id,
            market: config.market,
            symbol: config.symbol,
            interval: config.timeframe,
            startTime: report.evidence.startTime,
            endTime: report.evidence.endTime,
            initialCapital: "10000",
            feeRate: report.evidence.feeRate,
            slippageRate: report.evidence.slippageRate,
            leverage: String(config.leverage),
            fundingMode: config.market === "futures" && report.evidence.fundingIncluded ? "historical" : "none",
            gapPolicy: "fail",
          }),
        });
        if (backtestResponse.status === 401) { requireLogin(); return; }
        const backtestBody = await backtestResponse.json().catch(() => null) as {
          backtest?: { id?: unknown; status?: unknown };
          error?: { code?: unknown };
        } | null;
        if (!backtestResponse.ok || typeof backtestBody?.backtest?.id !== "string"
          || backtestBody.backtest.status !== "succeeded") {
          throw new Error(typeof backtestBody?.error?.code === "string"
            ? backtestBody.error.code : "verified_backtest_failed");
        }
        strategyVersionId = version.id;
        backtestJobId = backtestBody.backtest.id;
      }
      setMessage("歷史證據完成，正在發布至策略列表並建立社群分享頁…");
      const publicationResponse = await fetch("/api/strategy-publications", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyVersionId,
          backtestJobId,
          description: publicDescription,
        }),
      });
      if (publicationResponse.status === 401) { requireLogin(); return; }
      const published = parsePublishedPublication(await publicationResponse.json().catch(() => null));
      if (!publicationResponse.ok || !published) throw new Error("publish_failed");
      const url = publicationUrl(published);
      setPublication({ fingerprint, slug: published.slug, url });
      setPublishState("complete");
      setShareState("idle");
      setMessage("策略已發布到公開策略列表；你現在可以查看公開頁或分享策略連結。");
    } catch {
      setPublishState("error");
      setMessage("發布未完成；策略不會出現在公開列表。請確認行情資料後重試。");
    }
  };

  const sharePublishedStrategy = async () => {
    if (!publishedUrl || !publication || publication.fingerprint !== fingerprint) {
      setShareState("error");
      setMessage("請先將目前策略版本發布到公開策略列表，再分享策略連結。");
      return;
    }
    const referralUrl = weexReferralUrl.trim();
    if (referralUrl && !validReferralUrl(referralUrl)) {
      setShareState("error");
      setMessage("請輸入有效的 WEEX HTTPS 邀請註冊連結；為避免錯誤導流，不接受其他網域。");
      return;
    }
    setShareState("working");
    let shareUrl = publishedUrl;
    try {
      if (referralUrl) {
        const response = await fetch(`/api/strategy-publications/${encodeURIComponent(publication.slug)}`, {
          method: "PATCH",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weexReferralUrl: referralUrl }),
        });
        if (response.status === 401) { requireLogin(); return; }
        const updated = parsePublishedPublication(await response.json().catch(() => null));
        if (!response.ok || !updated || updated.slug !== publication.slug) {
          throw new Error("referral_update_failed");
        }
        shareUrl = publicationUrl(updated);
        setPublication({ fingerprint, slug: updated.slug, url: shareUrl });
      }
    } catch {
      setShareState("error");
      setMessage("邀請連結無法保存；公開策略未變更，請確認網址後重試。");
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareState("complete");
      setMessage(referralUrl ? "邀請連結已保存，策略分享連結已複製。" : "策略分享連結已複製。");
    } catch {
      setShareState("error");
      setMessage(referralUrl
        ? `邀請連結已保存，但無法自動複製；請手動分享此策略連結：${shareUrl}`
        : `無法自動複製，請手動分享此策略連結：${shareUrl}`);
    }
  };
  return (
    <section className="workshop-panel package-panel glass-panel" aria-labelledby="package-panel-title">
      <div className="workshop-panel__heading">
        <div>
          <p className="eyebrow">04 / SAVE · PUBLISH · SHARE</p>
          <h2 id="package-panel-title">保存、發布與分享策略</h2>
        </div>
        <span className="workshop-count">{authMode === "demo" ? "CLOUD DEMO" : "MEMBER WORKSPACE"}</span>
      </div>

      <div className="workshop-action-readiness" aria-label="策略發布準備狀態">
        <article data-state={configurationReady ? "passed" : "failed"}>
          <span className="workshop-action-readiness__index">01</span>
          <div><span>策略設定</span><strong>{configurationReady ? "已就緒" : "需要調整"}</strong></div>
          <i aria-hidden="true" />
        </article>
        <article data-state={report ? "passed" : "pending"}>
          <span className="workshop-action-readiness__index">02</span>
          <div><span>行情回測</span><strong>{report ? "已完成" : "待執行"}</strong></div>
          <i aria-hidden="true" />
        </article>
        <article data-state={flowCheckState}>
          <span className="workshop-action-readiness__index">03</span>
          <div><span>快速測試訊號流程</span><strong>{flowCheckLabel}</strong></div>
          <i aria-hidden="true" />
        </article>
        <article data-state={publishedUrl ? "passed" : "pending"}>
          <span className="workshop-action-readiness__index">04</span>
          <div><span>公開策略頁</span><strong>{publishedUrl ? "已發布" : "待發布"}</strong></div>
          <i aria-hidden="true" />
        </article>
      </div>

      <div className="workshop-primary-actions">
        <article className="workshop-action-card" data-action="save">
          <div className="workshop-action-card__top"><span>01 / SAVE</span><em>{user ? "MEMBER READY" : "LOGIN REQUIRED"}</em></div>
          <ActionVisual type="save" />
          <h3>保存策略</h3>
          <p>將目前積木、參數與程式碼存入會員工作區，之後可回來繼續調整。</p>
          <small>不會因此啟用交易或連接交易帳戶</small>
          <button aria-label="保存策略" className="button button--secondary" disabled={actionState === "working" || !configurationReady} onClick={() => void saveStrategy()} type="button">{actionState === "working" ? "保存中…" : user ? "保存到工作區" : "登入並保存"}</button>
        </article>
        <article className="workshop-action-card" data-action="publish">
          <div className="workshop-action-card__top"><span>02 / PUBLISH</span><em>PUBLIC LIST</em></div>
          <ActionVisual type="publish" />
          <h3>發布到公開策略列表</h3>
          <p>完成驗證後固定目前策略版本，發布到會員公開策略列表，讓其他用戶可以查看與套用。</p>
          {authMode === "production" && (
            <div className="publication-fields">
              <label>
                <span>公開策略介紹</span>
                <textarea
                  maxLength={400}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={`${config.name} 的使用情境、特色與主要風險（可留空自動產生）`}
                  rows={3}
                  value={description}
                />
              </label>
            </div>
          )}
          <small>訪客只能查看；自訂原始碼、Email 與交易憑證不會公開</small>
          <button
            aria-label="發布策略到公開列表"
            className="button button--secondary"
            disabled={publishState === "working" || !strategyName.valid || authMode === "demo"}
            onClick={() => void publishStrategy()}
            type="button"
          >
            {publishState === "working"
              ? "驗證並發布中…"
              : publishedUrl
                ? "目前版本已發布"
                : authMode === "demo"
                  ? "展示環境無法公開發布"
                  : user
                    ? "發布策略到公開列表"
                    : "登入並發布策略"}
          </button>
        </article>
      </div>

      <section
        aria-labelledby="workshop-share-strategy-title"
        className="workshop-share-action"
        data-ready={Boolean(publishedUrl)}
      >
        <div className="workshop-share-action__copy">
          <span>03 / SHARE</span>
          <h3 id="workshop-share-strategy-title">分享策略連結</h3>
          <p>
            {publishedUrl
              ? "可選填 WEEX 邀請連結，再複製目前已發布版本的公開網址。"
              : "發布完成後，才可複製公開策略網址並分享給其他用戶。"}
          </p>
          {authMode === "production" && (
            <label className="workshop-share-action__referral">
              <span>WEEX 邀請註冊連結（選填）</span>
              <input
                aria-label="WEEX 邀請註冊連結（選填）"
                autoComplete="url"
                disabled={!publishedUrl || shareState === "working"}
                inputMode="url"
                onChange={(event) => setWeexReferralUrl(event.target.value)}
                placeholder="https://www.weex.com/..."
                type="url"
                value={weexReferralUrl}
              />
              <small>不填仍可分享；填寫後會顯示在公開策略頁，且只會套用到這個已發布版本。</small>
            </label>
          )}
        </div>
        <div className="workshop-share-action__controls">
          {publishedUrl
            ? <a className="button button--secondary" href={publishedUrl}>查看公開策略</a>
            : <span>尚未發布，暫無可分享連結</span>}
          <button
            aria-label="複製策略分享連結"
            className="button button--primary"
            disabled={!publishedUrl || shareState === "working"}
            onClick={() => void sharePublishedStrategy()}
            type="button"
          >
            {shareState === "working"
              ? weexReferralUrl.trim() ? "正在儲存並複製…" : "正在複製…"
              : "複製策略連結"}
          </button>
        </div>
      </section>

      <section className="workshop-portable-package" aria-labelledby="package-export-title">
        <div>
          <h3 id="package-export-title">匯出與備份</h3>
          <p>完整策略包會綁定目前設定與對應回測；草稿備份 JSON 則可隨時保存尚未完成或未通過驗證的內容。</p>
        </div>
        <div className="package-export-actions">
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
          <button
            className="button button--secondary"
            disabled={backupState === "working"}
            onClick={downloadDraftBackup}
            type="button"
          >
            {backupState === "working" ? "準備草稿備份中…" : "下載草稿備份 JSON"}
          </button>
        </div>
        <div className="workshop-portable-package__notes">
          {!exportableReport && <small>完整策略包需要先完成目前設定的歷史行情回測；草稿備份不受此限制。</small>}
          {exportableReport && !configurationReady && <small>設定已變更或尚未通過驗證，請修正並重新回測後再匯出完整策略包。</small>}
          <small>草稿備份不是可執行策略套件，也不含交易憑證。</small>
        </div>
      </section>

      <details className="legacy-package workshop-legacy-package"><summary>匯入策略檔案（進階）</summary><div className="package-panel__grid package-panel__grid--single">
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
      {fallback?.fingerprint === fingerprint && <PackageFallbackFiles files={fallback.files} />}

      {confirmationOpen && (
        <DownloadConfirmationDialog
          description="策略包包含目前設定、JavaScript 原始碼、歷史行情回測資料、說明與版本資訊。"
          id="package-confirmation-title"
          onCancel={() => setConfirmationOpen(false)}
          onConfirm={() => void confirmExport()}
          restoreFocusOnConfirm={false}
          title="確認下載完整策略包"
          triggerRef={exportTriggerRef}
        />
      )}
    </section>
  );
}
