"use client";

import Image from "next/image";
import { useRef, useState, type ChangeEvent } from "react";
import { importBotPackage } from "../../lib/bot-package";
import { validateConfig } from "../../lib/strategy-validation";
import type { BacktestReport, BotConfig } from "../../lib/types";
import { demoAuthPath } from "../../lib/demo-auth";
import { usePlatformAuth } from "../PlatformAuthProvider";
import { backtestConfigFingerprint } from "../../lib/backtest";
import { saveDemoStrategy } from "../../lib/demo-strategies";
import { BOT_CATALOG } from "../../data/bots";
import type { SignalFlowCheckState } from "./StrategySummary";

interface PackagePanelProps {
  config: BotConfig;
  flowCheckState?: SignalFlowCheckState;
  report: BacktestReport | null;
  onImport: (config: BotConfig, report: BacktestReport) => { ok: true } | { ok: false; reason: string };
}

type WorkState = "idle" | "working" | "complete" | "error";
interface SavedVersion { id: string; configHash: string }

const ACTION_MASCOTS = {
  save: "/mascots/ai-strategy-vault-v1.webp",
  share: "/mascots/ai-version-broadcast-v1.webp",
} as const;

function ActionVisual({ type }: { type: keyof typeof ACTION_MASCOTS }) {
  return (
    <div className="workshop-action-visual" data-visual={type} aria-hidden="true">
      <Image alt="" className="workshop-action-visual__mascot" height={1086} priority={false} src={ACTION_MASCOTS[type]} width={1448} />
      <span className="workshop-action-visual__beam" />
    </div>
  );
}

export function PackagePanel({ config, flowCheckState = "untested", report, onImport }: PackagePanelProps) {
  const { mode: authMode, user } = usePlatformAuth();
  const [actionState, setActionState] = useState<WorkState>("idle");
  const [publishState, setPublishState] = useState<WorkState>("idle");
  const [importState, setImportState] = useState<WorkState>("idle");
  const [message, setMessage] = useState("");
  const [description, setDescription] = useState("");
  const [weexReferralUrl, setWeexReferralUrl] = useState("");
  const [publication, setPublication] = useState<{ fingerprint: string; url: string } | null>(null);
  const saveAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const savedVersionRef = useRef<{ fingerprint: string; version: SavedVersion } | null>(null);
  const configurationReady = validateConfig(config).valid;
  const fingerprint = backtestConfigFingerprint(config);
  const publishedUrl = publication?.fingerprint === fingerprint ? publication.url : "";
  const flowCheckLabel = flowCheckState === "passed" ? "通過測試" : flowCheckState === "failed" ? "未通過測試" : "未測試";

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
      setMessage(`已匯入 ${file.name}，策略設定與回測報告已還原。`);
    } catch (error) {
      setImportState("error");
      setMessage(error instanceof Error ? error.message : "策略套件匯入失敗");
    }
  };

  const hasError = actionState === "error" || publishState === "error" || importState === "error";
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

  const shareStrategy = async () => {
    if (!user) { requireLogin(); return; }
    if (publishedUrl) {
      try { await navigator.clipboard.writeText(publishedUrl); setMessage("公開分享連結已複製。"); }
      catch { setMessage(publishedUrl); }
      return;
    }
    if (authMode === "demo") {
      const publicBot = BOT_CATALOG.some((bot) => bot.id === config.id) ? config.id : "orbit-dca";
      const url = `${window.location.origin}/bots/${encodeURIComponent(publicBot)}`;
      try { await navigator.clipboard.writeText(url); setMessage("展示分享連結已複製。"); }
      catch { setMessage(url); }
      return;
    }
    if (!configurationReady || flowCheckState !== "passed" || !report?.evidence?.complete) {
      setMessage("發布前請先通過訊號流程測試，並完成具有完整 WEEX 歷史行情證據的回測。");
      setPublishState("error");
      return;
    }
    if (!validReferralUrl(weexReferralUrl.trim())) {
      setMessage("請輸入有效的 WEEX HTTPS 邀請註冊連結；為避免錯誤導流，不接受其他網域。");
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
      setMessage("歷史證據完成，正在發布至策略列表並建立社群分享頁…");
      const publicationResponse = await fetch("/api/strategy-publications", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyVersionId: version.id,
          backtestJobId: backtestBody.backtest.id,
          description: publicDescription,
          weexReferralUrl: weexReferralUrl.trim(),
        }),
      });
      if (publicationResponse.status === 401) { requireLogin(); return; }
      const publicationBody = await publicationResponse.json().catch(() => null) as {
        publication?: { slug?: unknown };
      } | null;
      if (!publicationResponse.ok || typeof publicationBody?.publication?.slug !== "string") {
        throw new Error("publish_failed");
      }
      const url = `${window.location.origin}/strategies/${encodeURIComponent(publicationBody.publication.slug)}`;
      setPublication({ fingerprint, url });
      setPublishState("complete");
      try {
        await navigator.clipboard.writeText(url);
        setMessage("策略已發布到公開列表，分享連結已複製；訪客頁會顯示你的 WEEX 邀請註冊按鈕。");
      } catch {
        setMessage(`策略已發布到公開列表：${url}`);
      }
    } catch {
      setPublishState("error");
      setMessage("發布未完成；策略不會出現在公開列表。請確認行情資料與 WEEX 邀請連結後重試。");
    }
  };
  return (
    <section className="workshop-panel package-panel glass-panel" aria-labelledby="package-panel-title">
      <div className="workshop-panel__heading">
        <div>
          <p className="eyebrow">04 / SAVE &amp; SHARE</p>
          <h2 id="package-panel-title">保存與分享策略</h2>
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
          <button aria-label="保存策略" className="button button--secondary" disabled={actionState === "working"} onClick={() => void saveStrategy()} type="button">{actionState === "working" ? "保存中…" : user ? "保存到工作區" : "登入並保存"}</button>
        </article>
        <article className="workshop-action-card" data-action="share">
          <div className="workshop-action-card__top"><span>02 / SHARE</span><em>VERSION LINK</em></div>
          <ActionVisual type="share" />
          <h3>建立分享連結</h3>
          <p>完成驗證後發布至策略列表，建立適合 LINE、X、Facebook 與 Telegram 預覽的固定版本頁。</p>
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
              <label>
                <span>你的 WEEX 邀請註冊連結</span>
                <input
                  autoComplete="url"
                  inputMode="url"
                  onChange={(event) => setWeexReferralUrl(event.target.value)}
                  placeholder="https://www.weex.com/..."
                  type="url"
                  value={weexReferralUrl}
                />
              </label>
            </div>
          )}
          <small>訪客只能查看；自訂原始碼、Email 與交易憑證不會公開</small>
          <button
            aria-label="建立分享連結"
            className="button button--secondary"
            disabled={publishState === "working"}
            onClick={() => void shareStrategy()}
            type="button"
          >
            {publishState === "working" ? "驗證並發布中…" : publishedUrl ? "複製公開連結" : user ? "驗證、發布並複製連結" : "登入並建立連結"}
          </button>
        </article>
      </div>

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
    </section>
  );
}
