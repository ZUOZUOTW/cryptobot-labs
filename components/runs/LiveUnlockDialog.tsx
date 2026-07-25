"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RiskPolicyForm, isCompleteRiskPolicy, type RiskPolicyDraft } from "./RiskPolicyForm";
import type { RiskPolicy } from "./types";

export interface LivePermissions {
  verified: boolean;
  hasLocalCredential: boolean;
  read: boolean;
  trade: boolean;
  withdrawal: false;
}

interface LiveUnlockDialogProps {
  botName: string;
  onCancel?: () => void;
  onConfirm?: (input: { typedBotName: string; riskAcknowledged: true; acceptedAt: number; riskPolicy: RiskPolicyDraft }) => void | Promise<void>;
  permissions: LivePermissions;
  policy: RiskPolicy;
}

export function LiveUnlockDialog({ botName, onCancel, onConfirm, permissions, policy }: LiveUnlockDialogProps) {
  const titleId = useId();
  const [draft, setDraft] = useState<RiskPolicyDraft>(() => {
    const { id, ...value } = policy;
    void id;
    return value;
  });
  const [typedName, setTypedName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const permissionReady = permissions.verified && permissions.hasLocalCredential && permissions.read && permissions.trade && permissions.withdrawal === false;
  const enabled = permissionReady && isCompleteRiskPolicy(draft) && typedName === botName && accepted && !submitting;

  useEffect(() => { cancelRef.current?.focus(); }, []);

  return (
    <div aria-labelledby={titleId} aria-modal="true" className="control-dialog" onKeyDown={(event) => { if (event.key === "Escape") onCancel?.(); }} role="dialog">
      <div className="control-dialog__card glass-panel">
        <header><div><p className="eyebrow">LIVE ACCESS GATE</p><h2 id={titleId}>啟用 {botName} 實盤</h2></div><span className="run-mode" data-mode="paper">模擬運行（預設）</span></header>
        <p className="control-dialog__warning">實盤會送出真實訂單並可能造成全部資金損失。此請求只會送至本機代理；代理仍須重新驗證憑證、權限、商品規格與以下風險上限。</p>
        <dl className="live-readiness">
          <div><dt>本機憑證</dt><dd>{permissions.hasLocalCredential ? "已回報存在" : "未就緒"}</dd></div>
          <div><dt>交易權限</dt><dd>{permissions.verified && permissions.trade ? "已驗證" : "未驗證"}</dd></div>
          <div><dt>提領權限</dt><dd>{permissions.withdrawal === false ? "未允許" : "不安全"}</dd></div>
        </dl>
        {!permissionReady && <p className="control-feedback control-feedback--danger" role="alert">尚未取得安全的本機權限證據，不能申請實盤。</p>}
        <RiskPolicyForm disabled onChange={setDraft} value={draft} />
        <div className="live-confirmation">
          <label><span>輸入機器人名稱</span><input autoComplete="off" onChange={(event) => setTypedName(event.target.value)} value={typedName} /></label>
          <label className="control-check"><input checked={accepted} onChange={(event) => setAccepted(event.target.checked)} type="checkbox" /><span>我了解所有交易均可能產生損失，並接受上述風險上限。</span></label>
        </div>
        {submitError && <p className="control-feedback control-feedback--danger" role="alert">{submitError}</p>}
        <div className="button-row">
          <button className="button button--ghost" onClick={onCancel} ref={cancelRef} type="button">返回模擬</button>
          <button className="button button--danger" disabled={!enabled} onClick={async () => { setSubmitting(true); setSubmitError(""); try { await onConfirm?.({ typedBotName: typedName, riskAcknowledged: true, acceptedAt: Date.now(), riskPolicy: draft }); } catch { setSubmitError("實盤申請未通過。請重新驗證本機權限與風險設定後再試。"); } finally { setSubmitting(false); } }} type="button">{submitting ? "送出申請中…" : "確認並啟用實盤"}</button>
        </div>
      </div>
    </div>
  );
}
