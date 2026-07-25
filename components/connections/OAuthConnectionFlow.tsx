"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { captureAttribution } from "../../lib/attribution";
import { demoAuthPath } from "../../lib/demo-auth";
import { setDemoConnection, useDemoConnection } from "../../lib/demo-connection";
import { usePlatformAuth } from "../PlatformAuthProvider";

type AccountChoice = "existing" | "new" | null;
const STEPS = ["準備帳戶", "WEEX 官方授權", "安全驗證", "先模擬運行"] as const;

export function OAuthConnectionFlow() {
  const { mode, user } = usePlatformAuth();
  const demoConnection = useDemoConnection();
  const [choice, setChoice] = useState<AccountChoice>(null);
  const [productionConnection, setProductionConnection] = useState<{ status: string; withdrawalAccessAbsent: boolean } | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const ready = mode === "demo" ? demoConnection.status === "paper-ready"
    : productionConnection?.status === "active" && productionConnection.withdrawalAccessAbsent;
  const processing = mode === "production" && ["pending", "processing"].includes(productionConnection?.status ?? "");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    captureAttribution(params.get("via"));
    if (mode === "production") {
      const reason = params.get("reason");
      if (params.get("status") === "error") queueMicrotask(() => setStatusMessage(reason === "api_already_bound"
        ? "此 WEEX 帳戶已有本平台 API，請先在 WEEX 刪除舊 Key 後再重新授權。"
        : reason === "authorization_denied" ? "你已取消 WEEX 授權，連線狀態沒有變更。"
          : "WEEX 連線尚未完成，請稍後再試。安全設定仍保持關閉。"
      ));
      fetch("/api/oauth/weex/status", { credentials: "same-origin", cache: "no-store" })
        .then(async (response) => response.ok ? response.json() as Promise<{ connection: typeof productionConnection }> : null)
        .then((result) => { if (result) setProductionConnection(result.connection); })
        .catch(() => setStatusMessage("目前無法讀取連線狀態，請稍後重新整理。"));
    }
  }, [mode]);

  const currentStep = !user ? 0 : ready ? 3 : processing ? 2 : choice ? 1 : 0;
  if (!user) {
    return (
      <section className="connection-auth-gate glass-panel">
        <p className="eyebrow">STEP 00 / SIGN IN</p><h2>先登入，才能保存連線狀態</h2>
        <p>你仍可匿名瀏覽策略與回測。登入後會回到這個步驟；正式憑證只會在固定 IP 後端加密處理。</p>
        <Link className="button button--primary" href={mode === "demo" ? demoAuthPath("/connections") : "/auth?return_to=%2Fconnections"}>Google／Email 登入</Link>
      </section>
    );
  }

  return (
    <div className="oauth-connection-flow">
      <nav aria-label="WEEX OAuth 設定進度" className="connection-progress oauth-progress">
        <ol>{STEPS.map((label, index) => {
          const state = index < currentStep ? "complete" : index === currentStep ? "current" : "waiting";
          return <li data-state={state} key={label}><span><b>{state === "complete" ? "完成" : `0${index + 1}`}</b><strong>{label}</strong><small>{state === "complete" ? "已完成" : state === "current" ? "現在進行" : "等待前一步"}</small></span></li>;
        })}</ol>
      </nav>

      <section className="connection-stage glass-panel" aria-labelledby="account-choice-title">
        <div className="connection-stage__heading"><span className="connection-step">01</span><div><p className="eyebrow">ACCOUNT CHECK</p><h2 id="account-choice-title">你已經有 WEEX 帳戶嗎？</h2>
          <p>OAuth 是授權既有帳戶，不是註冊。選擇符合你的狀況，策略與返回位置會繼續保留。</p></div></div>
        <div className="account-choice-grid">
          <button className="account-choice" data-selected={choice === "existing"} onClick={() => setChoice("existing")} type="button"><strong>我已有 WEEX 帳戶</strong><span>直接前往授權說明</span></button>
          <button className="account-choice" data-selected={choice === "new"} onClick={() => setChoice("new")} type="button"><strong>我還沒有 WEEX 帳戶</strong><span>先開新分頁建立帳戶</span></button>
        </div>
        {choice === "new" && <div className="external-account-note" role="note"><p>請在新分頁自行確認服務內容、資格與風險，再返回本站繼續研究流程。</p>
          <a className="button button--secondary" href="https://www.weex.com/" rel="noreferrer" target="_blank">前往 WEEX 官方網站</a></div>}
      </section>

      <section className="connection-stage glass-panel" aria-labelledby="oauth-start-title">
        <div className="connection-stage__heading"><span className="connection-step">02</span><div><p className="eyebrow">OFFICIAL AUTHORIZATION</p><h2 id="oauth-start-title">前往 WEEX 官方授權</h2>
          <p>正式版會離開本站，由 WEEX 顯示授權內容。API Key、Secret、Passphrase 與 PKCE verifier 永遠不會送到瀏覽器。</p></div></div>
        <ul className="permission-list"><li><span>允許</span>讀取帳戶與交易狀態</li><li><span>允許</span>依你的風險設定建立交易</li><li data-denied="true"><span>禁止</span>提領資產</li></ul>
        {choice ? <Link className="button button--primary" href={mode === "demo" ? "/demo/weex-authorize?return_to=%2Fconnections" : "/api/oauth/weex/start"}>{mode === "demo" ? "前往 WEEX 展示授權" : "前往 WEEX 官方授權"}</Link>
          : <button className="button button--primary" disabled type="button">請先選擇帳戶狀態</button>}
        {statusMessage && <p className="control-feedback" role="alert">{statusMessage}</p>}
      </section>

      <section className="connection-stage glass-panel" aria-labelledby="verification-title">
        <div className="connection-stage__heading"><span className="connection-step">03</span><div><p className="eyebrow">SECURITY CHECK</p><h2 id="verification-title">安全驗證</h2>
          <p>{ready ? `${mode === "demo" ? "展示" : "正式"}連線已完成：只讀與交易能力可用，提領能力明確不存在。` : processing ? "OAuth 正在固定 IP 後端完成驗證與加密，完成前不會開放任何交易能力。" : "授權返回後才會檢查連線、可讀、可交易與提領權限。任何未知權限都不解鎖。"}</p></div></div>
        <ol className="connection-checklist"><li data-complete={ready}><span>{ready ? "完成" : "1"}</span>帳戶只讀查詢</li><li data-complete={ready}><span>{ready ? "完成" : "2"}</span>交易權限確認</li><li data-complete={ready}><span>{ready ? "完成" : "3"}</span>提領權限不存在</li></ol>
      </section>

      <section className={`connection-stage simulation-launch glass-panel${ready ? " is-ready" : ""}`} aria-labelledby="paper-start-title">
        <div className="connection-stage__heading"><span className="connection-step">04</span><div><p className="eyebrow">SIMULATION FIRST</p><h2 id="paper-start-title">第一個運行固定使用模擬模式</h2>
          <p>{ready ? `${mode === "demo" ? "展示連線" : "正式連線"}已就緒。請選擇策略與風險上限，先驗證至少 30 分鐘或 10 次有效評估。` : `完成${mode === "demo" ? "展示" : "正式"}授權與權限檢查後，才可開始模擬運行；實盤仍保持停用。`}</p></div></div>
        <div className="simulation-launch__guardrails"><span>不送出真實訂單</span><span>可隨時停止</span><span>Live 已停用</span></div>
        <div className="button-row">{ready ? <Link className="button button--primary" href="/workshop?bot=orbit-dca&onboarding=paper">選擇策略並開始模擬運行</Link> : <button className="button button--primary" disabled type="button">等待安全驗證</button>}
          {ready && mode === "demo" && <button className="button button--ghost" onClick={() => setDemoConnection("disconnected")} type="button">解除展示連線</button>}</div>
      </section>
    </div>
  );
}
