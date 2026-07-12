import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AgentStatus } from "../shared/ipc-contract";
import "./app.css";

const emptyStatus: AgentStatus = {
  state: "unconfigured",
  credential: { apiKeySuffix: "", configured: false },
  paired: false,
  startAtLogin: false,
};

export function App() {
  const api = window.cryptoBotAgent;
  const [status, setStatus] = useState(emptyStatus);
  const [message, setMessage] = useState("正在讀取本機代理狀態…");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await api.getStatus();
    setStatus(next);
    setMessage(next.credential.configured ? `WEEX API ••••${next.credential.apiKeySuffix}` : "尚未設定 WEEX API");
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh().catch(() => setMessage("無法讀取本機狀態")), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function saveCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await api.saveCredentials({
        apiKey: String(form.get("apiKey") ?? ""),
        secretKey: String(form.get("secretKey") ?? ""),
        passphrase: String(form.get("passphrase") ?? ""),
      });
      formElement.reset();
      setMessage("憑證已加密保存於這台裝置，網站不會取得 Secret");
      await refresh();
    } catch {
      setMessage("保存失敗；請檢查欄位，憑證不會離開本機代理");
    } finally {
      for (const name of ["apiKey", "secretKey", "passphrase"]) {
        const input = formElement.elements.namedItem(name);
        if (input instanceof HTMLInputElement) input.value = "";
      }
      setBusy(false);
    }
  }

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await api.pair({ code: String(form.get("code") ?? ""), deviceName: String(form.get("deviceName") ?? "") });
      formElement.reset();
      await refresh();
      setMessage("裝置配對完成");
    } catch { setMessage("配對失敗或配對碼已失效"); }
    finally { setBusy(false); }
  }

  return (
    <main className="shell">
      <header><span className="eyebrow">LOCAL EXECUTION AGENT</span><h1>CryptoBot Labs</h1><p>{message}</p></header>
      <section className="status-grid" aria-label="代理狀態">
        <article><span>代理</span><strong>{status.state}</strong></article>
        <article><span>裝置配對</span><strong>{status.paired ? "已配對" : "尚未配對"}</strong></article>
        <article><span>自動啟動</span><strong>{status.startAtLogin ? "已開啟" : "已關閉"}</strong></article>
      </section>

      <div className="columns">
        <form onSubmit={saveCredentials}>
          <h2>連接 WEEX API</h2>
          <p>只保存在此電腦的作業系統加密儲存區。請勿開啟提幣權限。</p>
          <label>API Key<input required name="apiKey" autoComplete="off" /></label>
          <label>Secret Key<input required name="secretKey" type="password" autoComplete="new-password" /></label>
          <label>Passphrase<input required name="passphrase" type="password" autoComplete="new-password" /></label>
          <button disabled={busy} type="submit">加密保存</button>
          <button disabled={busy || !status.credential.configured} type="button" className="secondary" onClick={() => void api.verifyCredentials().then(refresh).catch(() => setMessage("驗證失敗"))}>驗證權限</button>
        </form>

        <form onSubmit={pair}>
          <h2>配對網站</h2>
          <p>在網站產生一次性配對碼；配對不會上傳 Secret。</p>
          <label>配對碼<input required name="code" minLength={6} maxLength={32} autoComplete="off" /></label>
          <label>裝置名稱<input required name="deviceName" maxLength={80} defaultValue="我的交易電腦" /></label>
          <button disabled={busy} type="submit">配對裝置</button>
          <label className="toggle"><input type="checkbox" checked={status.startAtLogin} onChange={(event) => void api.setStartAtLogin(event.currentTarget.checked).then(refresh)} />登入後啟動代理（選用）</label>
        </form>
      </div>

      <section className="danger-zone">
        <div><h2>緊急停止</h2><p>立即停止送出新訂單；取消掛單與平倉仍需各自確認。</p></div>
        <button type="button" onClick={() => void api.emergencyStop().then(() => setMessage("已要求緊急停止新訂單"))}>停止新訂單</button>
      </section>
    </main>
  );
}
