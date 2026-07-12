import { useState, type FormEvent } from "react";

import type { AgentRendererApi } from "../shared/ipc-contract";

interface PairingWizardProps {
  api: AgentRendererApi;
  paired: boolean;
  startAtLogin: boolean;
  disabled?: boolean;
  onChanged(): Promise<void>;
  onMessage(message: string): void;
}

export function PairingWizard({ api, paired, startAtLogin, disabled = false, onChanged, onMessage }: PairingWizardProps) {
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await api.pair({
        code: String(form.get("code") ?? "").trim(),
        deviceName: String(form.get("deviceName") ?? "").trim(),
      });
      formElement.reset();
      onMessage("裝置配對完成；網站只會看到此裝置的公開金鑰與安全狀態");
      try { await onChanged(); }
      catch { onMessage("裝置配對完成，但暫時無法重新讀取狀態；請勿重複使用原配對碼"); }
    } catch {
      onMessage("配對失敗：請確認網路後，前往網站 /connections 重新產生五分鐘有效的配對碼");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStartAtLogin(enabled: boolean) {
    setBusy(true);
    try {
      await api.setStartAtLogin(enabled);
      onMessage(enabled ? "已開啟登入後啟動" : "已關閉登入後啟動");
      try { await onChanged(); }
      catch { onMessage(`${enabled ? "已開啟" : "已關閉"}登入後啟動，但暫時無法重新讀取狀態`); }
    } catch {
      onMessage("無法更新自動啟動設定");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="pairing-title">
      <div className="step-tag">步驟 1</div>
      <h2 id="pairing-title">配對 CryptoBot Labs 網站</h2>
      <p>前往網站的「連線管理 /connections」產生五分鐘有效的一次性配對碼。配對只上傳裝置公開金鑰，不會上傳 WEEX 憑證。</p>
      <label>
        配對碼
        <input
          required
          name="code"
          minLength={26}
          maxLength={26}
          pattern="CBL-[A-Za-z0-9_-]{22}"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="CBL-…"
          disabled={disabled || busy || paired}
        />
      </label>
      <label>
        裝置名稱
        <input required name="deviceName" maxLength={80} defaultValue="我的交易電腦" disabled={disabled || busy || paired} />
      </label>
      <button disabled={disabled || busy || paired} type="submit">
        {paired ? "已完成配對" : busy ? "安全配對中…" : "配對裝置"}
      </button>
      <label className="toggle">
        <input
          type="checkbox"
          checked={startAtLogin}
          disabled={disabled || busy}
          onChange={(event) => void toggleStartAtLogin(event.currentTarget.checked)}
        />
        登入後啟動本機代理（選用）
      </label>
    </form>
  );
}
