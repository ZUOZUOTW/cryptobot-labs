import { useState, type FormEvent } from "react";

import type { AgentRendererApi } from "../shared/ipc-contract";

interface ConnectionWizardProps {
  api: AgentRendererApi;
  configured: boolean;
  paired: boolean;
  disabled?: boolean;
  onChanged(): Promise<void>;
  onMessage(message: string): void;
}

function clearCredentialFields(form: HTMLFormElement): void {
  for (const name of ["apiKey", "secretKey", "passphrase"]) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) input.value = "";
  }
}

export function ConnectionWizard({ api, configured, paired, disabled = false, onChanged, onMessage }: ConnectionWizardProps) {
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await api.saveCredentials({
        apiKey: String(form.get("apiKey") ?? "").trim(),
        secretKey: String(form.get("secretKey") ?? "").trim(),
        passphrase: String(form.get("passphrase") ?? "").trim(),
      });
      formElement.reset();
      onMessage("憑證已加密保存於這台裝置；Secret Key 與 Passphrase 不會傳給網站");
      try { await onChanged(); }
      catch { onMessage("憑證已安全保存，但暫時無法重新讀取狀態；請勿重複提交"); }
    } catch {
      onMessage("保存失敗：請檢查欄位與作業系統加密功能");
    } finally {
      clearCredentialFields(formElement);
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      const verified = await api.verifyCredentials();
      const permissions = [verified.permissions.read && "讀取", verified.permissions.spotTrade && "現貨交易", verified.permissions.futuresTrade && "合約交易"]
        .filter(Boolean)
        .join("、");
      onMessage(`WEEX 權限驗證完成：${permissions || "未授權"}；提幣權限已確認關閉`);
      try { await onChanged(); }
      catch { onMessage(`WEEX 權限驗證完成：${permissions || "未授權"}；但暫時無法重新讀取狀態`); }
    } catch {
      onMessage("驗證失敗：實盤功能維持鎖定，請確認 API 權限與網路連線");
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (!window.confirm("確定要從這台裝置永久移除 WEEX API 憑證？")) return;
    setBusy(true);
    try {
      await api.eraseCredentials();
      onMessage("本機 WEEX API 憑證已移除");
      try { await onChanged(); }
      catch { onMessage("本機 WEEX API 憑證已移除，但暫時無法重新讀取狀態"); }
    } catch {
      onMessage("無法移除憑證；代理維持鎖定，請稍後再試");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="connection-title">
      <div className="step-tag">步驟 2</div>
      <h2 id="connection-title">連接 WEEX API</h2>
      <p>建議建立專用 API Key，只開啟讀取與所需交易權限。禁止使用具有提幣權限的金鑰。</p>
      {!paired && <p className="inline-notice">請先完成網站配對，再設定交易連線。</p>}
      <label>API Key<input required name="apiKey" autoComplete="off" spellCheck={false} disabled={disabled || busy || !paired} /></label>
      <label>Secret Key<input required name="secretKey" type="password" autoComplete="new-password" spellCheck={false} disabled={disabled || busy || !paired} /></label>
      <label>Passphrase<input required name="passphrase" type="password" autoComplete="new-password" spellCheck={false} disabled={disabled || busy || !paired} /></label>
      <div className="button-row">
        <button disabled={disabled || busy || !paired} type="submit">{busy ? "處理中…" : configured ? "輪替加密憑證" : "加密保存"}</button>
        <button disabled={disabled || busy || !configured || !paired} type="button" className="secondary" onClick={() => void verify()}>驗證權限</button>
        {configured && <button disabled={disabled || busy} type="button" className="text-button" onClick={() => void erase()}>移除</button>}
      </div>
    </form>
  );
}
