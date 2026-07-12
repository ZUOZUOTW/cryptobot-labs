"use client";

import { useId, useState } from "react";

export type EmergencyCommand =
  | { type: "stop-new-orders"; reason: string }
  | { type: "cancel-open-orders"; scope: "deployment"; reason: string }
  | { type: "close-positions"; scope: "all"; symbol: null; confirmationPhrase: "CLOSE POSITIONS"; riskAcknowledged: true; confirmedAt: number };

interface EmergencyStopDialogProps {
  onCommand: (command: EmergencyCommand) => void | Promise<void>;
}

export function EmergencyStopDialog({ onCommand }: EmergencyStopDialogProps) {
  const titleId = useId();
  const [step, setStep] = useState<"idle" | "cancel" | "close">("idle");
  const [phrase, setPhrase] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const execute = async (command: EmergencyCommand) => { setBusy(true); try { await onCommand(command); setStep("idle"); setPhrase(""); setAccepted(false); } finally { setBusy(false); } };

  return (
    <section className="emergency-panel" aria-labelledby={titleId}>
      <header><div><p className="eyebrow">EMERGENCY CONTROLS</p><h2 id={titleId}>緊急控制</h2></div><span>三項操作互不連動</span></header>
      <p>先停止新訂單，再視需要分別取消掛單或關閉部位。任何一步都不會隱式執行下一步。</p>
      <div className="emergency-actions">
        <button className="button button--danger" disabled={busy} onClick={() => void execute({ type: "stop-new-orders", reason: "user-emergency-stop" })} type="button">立即停止新訂單</button>
        <button className="button button--secondary" disabled={busy} onClick={() => setStep("cancel")} type="button">取消所有未成交訂單</button>
        <button className="button button--ghost" disabled={busy} onClick={() => setStep("close")} type="button">關閉所有部位</button>
      </div>
      {step === "cancel" && <div aria-label="確認取消所有未成交訂單" aria-modal="true" className="control-dialog control-dialog--nested" role="dialog"><div className="control-dialog__card glass-panel"><h3>只取消未成交訂單？</h3><p>此操作不會關閉任何既有部位，也不會恢復新訂單。</p><div className="button-row"><button className="button button--ghost" onClick={() => setStep("idle")} type="button">返回</button><button className="button button--danger" onClick={() => void execute({ type: "cancel-open-orders", scope: "deployment", reason: "user-emergency-cancel" })} type="button">確認取消掛單</button></div></div></div>}
      {step === "close" && <div aria-label="高風險：確認關閉所有部位" aria-modal="true" className="control-dialog control-dialog--nested" role="dialog"><div className="control-dialog__card glass-panel"><p className="eyebrow">HIGH-RISK ACTION</p><h3>關閉所有部位</h3><p className="control-dialog__warning">這是獨立的高風險市價操作，可能產生滑價與已實現損失。它不會因停止新訂單或取消掛單而自動發生。</p><label><span>輸入 CLOSE POSITIONS</span><input autoComplete="off" onChange={(event) => setPhrase(event.target.value)} value={phrase} /></label><label className="control-check"><input checked={accepted} onChange={(event) => setAccepted(event.target.checked)} type="checkbox" /><span>我了解此操作將嘗試關閉所有現有部位。</span></label><div className="button-row"><button className="button button--ghost" onClick={() => setStep("idle")} type="button">返回</button><button className="button button--danger" disabled={phrase !== "CLOSE POSITIONS" || !accepted || busy} onClick={() => void execute({ type: "close-positions", scope: "all", symbol: null, confirmationPhrase: "CLOSE POSITIONS", riskAcknowledged: true, confirmedAt: Date.now() })} type="button">高風險確認：關閉部位</button></div></div></div>}
    </section>
  );
}
