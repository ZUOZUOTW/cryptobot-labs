"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePlatformAuth } from "../PlatformAuthProvider";

interface ConnectionState {
  status: string;
  credentialSource?: "manual" | "oauth";
  maskedApiKeySuffix?: string | null;
  withdrawalAccessAbsent?: boolean;
}

const executorEgressIp = process.env.NEXT_PUBLIC_EXECUTOR_EGRESS_IP?.trim();

const failureMessages: Record<string, string> = {
  invalid_credentials: "WEEX 無法核對這組 API Key、Secret Key 或 Passphrase。請重新複製三項資料；Passphrase 無法找回時需建立新 API。",
  ip_not_allowed: executorEgressIp
    ? `WEEX 拒絕目前來源 IP。請確認白名單包含 ${executorEgressIp}，儲存後等待設定生效再試。`
    : "WEEX 拒絕目前來源 IP。部署者尚未公開固定出口 IP，請先向營運方確認再更新白名單。",
  permission_denied: "這組 API 尚未開啟 Readonly、Spot 或 Futures 真倉交易權限，或新權限仍在生效中。請檢查設定並稍後再試。",
  clock_error: "WEEX 拒絕請求時間。雲端時間校正暫時異常，請稍後重試。",
  rate_limited: "WEEX 暫時限制請求頻率，請稍後再試。",
  weex_unavailable: "WEEX 私有 API 暫時無法連線，請稍後再試。",
  invalid_weex_response: "WEEX 回傳了目前無法辨識的帳戶資料格式，平台尚未保存這組憑證。",
  hedge_mode_required: "WEEX 合約帳戶目前是單向持倉模式。請先在 WEEX 切換為雙向持倉（Hedge Mode），再重新驗證。",
  verification_failed: "無法完成 WEEX API 驗證。請確認憑證、Readonly／Spot／Futures 權限及 IP 白名單。",
  executor_unavailable: "AWS Executor 暫時無法連線，請稍後再試。",
  invalid_request: "輸入格式不正確。請重新複製 API Key、Secret Key 與 Passphrase。",
};

export function ManualApiConnectionFlow() {
  const { mode, user } = usePlatformAuth();
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [message, setMessage] = useState("");

  const loadConnection = useCallback(async () => {
    if (mode !== "production" || !user) return;
    setChecking(true);
    try {
      const response = await fetch("/api/oauth/weex/status", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("connection_status_unavailable");
      const result = await response.json() as { connection?: ConnectionState | null };
      setConnection(result.connection ?? null);
      setStatusError(false);
      setMessage("");
    } catch {
      setStatusError(true);
      setMessage("暫時無法確認既有連線。請重試檢查；已綁定的 API 不需要重新輸入。");
    } finally {
      setChecking(false);
    }
  }, [mode, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConnection(), 0);
    return () => window.clearTimeout(timer);
  }, [loadConnection]);

  if (!user) return <section className="connection-auth-gate glass-panel">
    <p className="eyebrow">SIGN IN REQUIRED</p><h2>登入後綁定 WEEX API</h2>
    <p>憑證會經同源 HTTPS 由 Netlify 函式在記憶體中轉送至固定 IP 的 AWS Executor，隨即使用 AWS KMS 加密；資料庫與瀏覽器都不保存明文。</p>
    <Link className="button button--primary" href="/auth?return_to=%2Fconnections">登入並繼續</Link>
  </section>;

  const active = connection?.status === "active" && connection.withdrawalAccessAbsent === true;
  const submit = async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch("/api/connections/weex/manual", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          secretKey: secretKey.trim(),
          passphrase: passphrase.trim(),
        }),
      });
      const body = await response.json() as { connection?: ConnectionState; error?: string; reason?: string };
      if (!response.ok || !body.connection) {
        const reason = body.reason ?? body.error ?? "verification_failed";
        throw new Error(reason);
      }
      setConnection({ ...body.connection, withdrawalAccessAbsent: true });
      setApiKey(""); setSecretKey(""); setPassphrase("");
      setEditing(false);
      setState("done"); setMessage("WEEX API 已驗證並由 AWS KMS 加密。雲端策略現在可 24 小時運行。");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "verification_failed";
      setState("error");
      setMessage(failureMessages[reason] ?? failureMessages.verification_failed);
    }
  };

  const completedFields = [apiKey.trim(), secretKey, passphrase].filter(Boolean).length;
  const isComplete = completedFields === 3;

  return <section className="connection-stage glass-panel" aria-labelledby="manual-api-form-title">
    <div className="connection-stage__heading"><span className="connection-step">01</span><div>
      <p className="eyebrow">CLOUD CREDENTIAL VAULT</p><h2 id="manual-api-form-title">直接輸入 WEEX API</h2>
      <p>不需安裝任何程式。固定出口 IP 為 <strong>{executorEgressIp ?? "尚未由部署者設定"}</strong>；建立 API 時請加入白名單，只啟用 Readonly 與需要的 Spot／Futures 權限。</p>
    </div></div>
    {checking && <p className="control-feedback" role="status">正在確認已綁定的 WEEX API…</p>}
    {active && !editing && <div className="connection-active-summary" role="status">
      <div><strong>{connection.credentialSource === "oauth"
        ? "已透過 WEEX OAuth 連線"
        : `已綁定手動 API ••••${connection.maskedApiKeySuffix ?? ""}`}</strong>
        <p>憑證已由 AWS KMS 安全保存，真倉雲端執行可用；回到此頁不需要重新輸入。</p></div>
      <button className="button button--ghost button--small" onClick={() => {
        setEditing(true); setMessage(""); setState("idle");
      }} type="button">{connection.credentialSource === "oauth" ? "改用手動 API" : "更換手動 API"}</button>
    </div>}
    {statusError && !active && message && <div className="control-feedback" role="alert">
      <p>{message}</p>
      <button className="button button--secondary button--small" disabled={checking}
        onClick={() => { setMessage(""); void loadConnection(); }}
        type="button">{checking ? "檢查中…" : "重新檢查連線"}</button>
    </div>}
    {!checking && !statusError && (!active || editing) && <form className="manual-api-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="manual-api-form__fields">
        <label className="manual-api-field">
          <span className="manual-api-field__label">API Key <strong>必填</strong></span>
          <input aria-describedby="weex-api-key-help" aria-required="true" autoCapitalize="none" autoComplete="off"
            disabled={state === "loading"} maxLength={256} onChange={(event) => setApiKey(event.target.value)}
            placeholder="貼上 WEEX API Key" required spellCheck={false} value={apiKey} />
          <small id="weex-api-key-help">從 WEEX API 管理頁複製；建立時加入上方固定 IP。</small>
        </label>
        <label className="manual-api-field">
          <span className="manual-api-field__label">Secret Key <strong>必填</strong></span>
          <input aria-describedby="weex-secret-key-help" aria-required="true" autoCapitalize="none"
            autoComplete="new-password" disabled={state === "loading"} maxLength={256}
            onChange={(event) => setSecretKey(event.target.value)} placeholder="輸入 Secret Key" required
            spellCheck={false} type="password" value={secretKey} />
          <small id="weex-secret-key-help">只會透過一次性驗證流程轉送至 AWS Executor，不會保存在瀏覽器或 Netlify 資料庫。</small>
        </label>
        <label className="manual-api-field">
          <span className="manual-api-field__label">Passphrase <strong>必填</strong></span>
          <input aria-describedby="weex-passphrase-help" aria-required="true" autoCapitalize="none"
            autoComplete="new-password" disabled={state === "loading"} maxLength={256}
            onChange={(event) => setPassphrase(event.target.value)} placeholder="輸入 API Passphrase" required
            spellCheck={false} type="password" value={passphrase} />
          <small id="weex-passphrase-help">請輸入建立這組 API 時設定的 Passphrase。</small>
        </label>
      </div>
      <div className="manual-api-form__progress" aria-live="polite">
        <span>{completedFields}/3 欄已填寫</span>
        <small>{isComplete ? "已可進行安全驗證與綁定。" : "三個欄位皆為必填，完成後才能綁定。"}</small>
      </div>
      <ul className="permission-list"><li><span>允許</span>讀取帳戶與 Spot / Futures 真倉交易</li>
        <li><span>允許</span>AWS Executor 24/7 執行策略</li><li data-denied="true"><span>不支援</span>提領或轉出資產</li></ul>
      <button className="button button--primary" disabled={state === "loading" || !isComplete}
        type="submit">{state === "loading" ? "安全驗證與加密中…" : active ? "更新 WEEX API" : "驗證並綁定 API"}</button>
      {active && editing && <button className="button button--ghost" disabled={state === "loading"}
        onClick={() => {
          setEditing(false); setApiKey(""); setSecretKey(""); setPassphrase(""); setMessage(""); setState("idle");
        }} type="button">保留目前 API</button>}
      {message && <p className="control-feedback" role={state === "error" ? "alert" : "status"}>{message}</p>}
    </form>}
  </section>;
}
