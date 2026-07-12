"use client";

import type { RiskPolicy } from "./types";

export type RiskPolicyDraft = Omit<RiskPolicy, "id">;

interface RiskPolicyFormProps {
  disabled?: boolean;
  onChange: (policy: RiskPolicyDraft) => void;
  value: RiskPolicyDraft;
}

export const isCompleteRiskPolicy = (policy: RiskPolicyDraft): boolean => policy.allowedSymbols.length > 0
  && [policy.maxOrderNotional, policy.maxPositionNotional, policy.maxTotalExposure, policy.maxDailyLoss, policy.maxLeverage].every((value) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number(value) > 0)
  && [policy.maxSimultaneousPositions, policy.maxSlippageBps, policy.minSignalCooldownMs, policy.maxConsecutiveFailures].every((value) => Number.isSafeInteger(value) && value >= 0)
  && policy.maxSimultaneousPositions > 0 && policy.maxConsecutiveFailures > 0;

export function RiskPolicyForm({ disabled = false, onChange, value }: RiskPolicyFormProps) {
  const setText = (key: keyof RiskPolicyDraft) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: event.target.value });
  const setNumber = (key: keyof RiskPolicyDraft) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: Number(event.target.value) });
  return (
    <fieldset className="risk-policy-form" disabled={disabled}>
      <legend>實盤風險上限</legend>
      <p>所有欄位都必須完整，且本機代理會在接受實盤命令前重新驗證。</p>
      <label className="risk-policy-form__wide"><span>允許交易對（以逗號分隔）</span><input aria-label="允許交易對" onChange={(event) => onChange({ ...value, allowedSymbols: event.target.value.toUpperCase().split(",").map((item) => item.trim()).filter(Boolean) })} value={value.allowedSymbols.join(", ")} /></label>
      <label><span>單筆訂單上限 USDT</span><input min="0.01" onChange={setText("maxOrderNotional")} step="0.01" type="number" value={value.maxOrderNotional} /></label>
      <label><span>單一部位上限 USDT</span><input min="0.01" onChange={setText("maxPositionNotional")} step="0.01" type="number" value={value.maxPositionNotional} /></label>
      <label><span>總曝險上限 USDT</span><input min="0.01" onChange={setText("maxTotalExposure")} step="0.01" type="number" value={value.maxTotalExposure} /></label>
      <label><span>同時持倉上限</span><input min="1" onChange={setNumber("maxSimultaneousPositions")} step="1" type="number" value={value.maxSimultaneousPositions} /></label>
      <label><span>單日最大虧損 USDT</span><input min="0.01" onChange={setText("maxDailyLoss")} step="0.01" type="number" value={value.maxDailyLoss} /></label>
      <label><span>最大槓桿</span><input min="1" onChange={setText("maxLeverage")} step="0.1" type="number" value={value.maxLeverage} /></label>
      <label><span>最大滑價 bps</span><input min="0" onChange={setNumber("maxSlippageBps")} step="1" type="number" value={value.maxSlippageBps} /></label>
      <label><span>訊號冷卻毫秒</span><input min="0" onChange={setNumber("minSignalCooldownMs")} step="1000" type="number" value={value.minSignalCooldownMs} /></label>
      <label><span>連續失敗上限</span><input min="1" onChange={setNumber("maxConsecutiveFailures")} step="1" type="number" value={value.maxConsecutiveFailures} /></label>
      <label><span>執行方式</span><select onChange={(event) => onChange({ ...value, operationMode: event.target.value as RiskPolicyDraft["operationMode"] })} value={value.operationMode}><option value="approval-required">每筆需核准</option><option value="automatic">在上限內自動</option></select></label>
    </fieldset>
  );
}
