import { useCallback, useEffect, useState } from "react";
import type { AgentStatus, AgentUpdateStatus } from "../shared/ipc-contract";
import { ConnectionWizard } from "./ConnectionWizard";
import { PairingWizard } from "./PairingWizard";
import "./app.css";

const emptyStatus: AgentStatus = {
  state: "unconfigured",
  credential: { apiKeySuffix: "", configured: false },
  paired: false,
  pairingState: "unpaired",
  startAtLogin: false,
};
const emptyUpdate: AgentUpdateStatus = { state: "idle", version: null, reason: null };
const updateText = (status: AgentUpdateStatus): string => status.state === "downloaded"
  ? `版本 ${status.version ?? "新版"} 已下載；暫停實盤後可安全安裝`
  : status.state === "downloading" ? `正在下載${status.version ? ` v${status.version}` : "更新"}…`
    : status.state === "checking" ? "正在檢查簽署更新…"
      : status.state === "not-available" ? "目前已是最新版本"
        : status.reason === "live-running" ? "實盤運行中，已延後更新"
          : status.state === "disabled" ? "此版本未啟用自動更新" : status.state === "error"
            ? "暫時無法檢查更新" : "可手動檢查正式簽署更新";

export function App() {
  const api = window.cryptoBotAgent;
  const [status, setStatus] = useState(emptyStatus);
  const [message, setMessage] = useState("正在讀取本機代理狀態…");
  const [update, setUpdate] = useState(emptyUpdate);
  const [suggestedPairingCode, setSuggestedPairingCode] = useState("");

  const refresh = useCallback(async () => {
    const next = await api.getStatus();
    setStatus(next);
    setMessage(next.pairingState === "revoked" ? "網站已撤銷此裝置；請重新配對後再使用交易功能"
      : next.pairingState === "expired" ? "裝置授權已過期；請重新配對"
        : next.credential.configured ? `WEEX API ••••${next.credential.apiKeySuffix}` : "尚未設定 WEEX API");
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh().catch(() => setMessage("無法讀取本機狀態")), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => api.onPairingSuggestion((code) => {
    setSuggestedPairingCode(code);
    setMessage("已從網站帶入一次性配對碼，請確認裝置名稱後完成配對");
  }), [api]);
  useEffect(() => {
    let active = true;
    const read = () => void api.getUpdateStatus().then((next) => { if (active) setUpdate(next); }).catch(() => undefined);
    read();
    const onVisibility = () => { if (document.visibilityState === "visible") read(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; document.removeEventListener("visibilitychange", onVisibility); };
  }, [api]);

  return (
    <main className="shell">
      <header><span className="eyebrow">LOCAL EXECUTION AGENT</span><h1>CryptoBot Labs</h1><p>{message}</p></header>
      <section className="status-grid" aria-label="代理狀態">
        <article><span>代理</span><strong>{status.state}</strong></article>
        <article><span>裝置配對</span><strong>{status.pairingState === "paired" ? "已配對" : status.pairingState === "revoked" ? "已撤銷，請重新配對" : status.pairingState === "expired" ? "已過期，請重新配對" : "尚未配對"}</strong></article>
        <article><span>自動啟動</span><strong>{status.startAtLogin ? "已開啟" : "已關閉"}</strong></article>
      </section>

      <div className="columns">
        <PairingWizard api={api} paired={status.paired} startAtLogin={status.startAtLogin} suggestedCode={suggestedPairingCode} onChanged={refresh} onMessage={setMessage} />
        <ConnectionWizard api={api} configured={status.credential.configured} paired={status.paired} onChanged={refresh} onMessage={setMessage} />
      </div>

      <section className="update-zone">
        <div><h2>安全更新</h2><p>{updateText(update)}</p></div>
        {update.state === "downloaded" ? <button type="button" onClick={() => void api.installUpdate()
          .catch(() => setMessage("實盤運行中或更新尚未就緒，無法重新啟動安裝"))}>暫停實盤後安裝</button>
          : <button type="button" disabled={["disabled", "checking", "downloading"].includes(update.state)}
            onClick={() => void api.checkForUpdates().then(setUpdate).catch(() =>
              setUpdate({ state: "error", version: null, reason: null }))}>檢查更新</button>}
      </section>

      <section className="danger-zone">
        <div><h2>緊急停止</h2><p>立即停止送出新訂單；取消掛單與平倉仍需各自確認。</p></div>
        <button type="button" onClick={() => void api.emergencyStop().then(() => setMessage("已要求緊急停止新訂單"))}>停止新訂單</button>
      </section>
    </main>
  );
}
