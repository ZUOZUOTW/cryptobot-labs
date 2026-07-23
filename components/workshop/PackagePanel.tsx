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
  const [importState, setImportState] = useState<WorkState>("idle");
  const [message, setMessage] = useState("");
  const saveAttemptRef = useRef<string | null>(null);
  const configurationReady = validateConfig(config).valid;
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

  const hasError = actionState === "error" || importState === "error";
  const requireLogin = () => { window.location.assign(demoAuthPath(`${window.location.pathname}${window.location.search}`)); };
  const saveStrategy = async () => {
    if (!user) { requireLogin(); return; }
    if (authMode === "demo") {
      saveDemoStrategy(config, report, backtestConfigFingerprint(config));
      setMessage("策略與目前回測已保存到展示帳號。"); setActionState("complete");
      return;
    }
    setActionState("working"); setMessage("");
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
      setActionState("complete");
    } catch {
      setMessage("正式策略暫時無法保存；未收到成功回應時會保留相同請求識別碼，重試不會建立重複版本。");
      setActionState("error");
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
    const url = `${window.location.origin}/bots/${encodeURIComponent(publicBot)}`;
    try { await navigator.clipboard.writeText(url); setMessage("公開分享連結已複製；分享內容綁定展示版本 v1。"); }
    catch { setMessage(url); }
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
          <p>建立綁定策略版本的公開檢視連結，方便分享與討論。</p>
          <small>訪客只能查看，不會取得編輯權限</small>
          <button aria-label="建立分享連結" className="button button--secondary" onClick={() => void shareStrategy()} type="button">{user ? "複製公開連結" : "登入並建立連結"}</button>
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
