import type { ChangeEvent } from "react";

import { validateRiskPolicy, type RiskPolicy } from "@cryptobot-labs/trading-core";

export const DEFAULT_RISK_POLICY: RiskPolicy = Object.freeze({
  allowedSymbols: Object.freeze(["BTCUSDT"]),
  maximumOrderNotional: "100",
  maximumPositionNotional: "300",
  maximumTotalExposure: "500",
  maximumSimultaneousPositions: 1,
  maximumDailyLoss: "50",
  maximumLeverage: "3",
  maximumSlippageBps: "20",
  minimumSignalCooldownMs: 60_000,
  maximumConsecutiveFailures: 3,
  maximumPriceAgeMs: 10_000,
});

interface RiskSetupProps {
  value: RiskPolicy;
  disabled?: boolean;
  onChange(policy: RiskPolicy): void;
}

const DECIMAL_FIELDS = [
  ["maximumOrderNotional", "單筆訂單上限（USDT）"],
  ["maximumPositionNotional", "單一持倉上限（USDT）"],
  ["maximumTotalExposure", "總曝險上限（USDT）"],
  ["maximumDailyLoss", "每日最大虧損（USDT）"],
  ["maximumLeverage", "合約最大槓桿"],
  ["maximumSlippageBps", "最大滑價（bps）"],
] as const;

const INTEGER_FIELDS = [
  ["maximumSimultaneousPositions", "同時持倉數上限", 1],
  ["minimumSignalCooldownMs", "訊號冷卻（毫秒）", 1_000],
  ["maximumConsecutiveFailures", "連續失敗上限", 1],
  ["maximumPriceAgeMs", "行情最長有效時間（毫秒）", 1_000],
] as const;

export function isRiskPolicyComplete(policy: RiskPolicy): boolean {
  return validateRiskPolicy(policy) === null;
}

export function RiskSetup({ value, disabled = false, onChange }: RiskSetupProps) {
  function updateDecimal(event: ChangeEvent<HTMLInputElement>) {
    const field = event.currentTarget.name as (typeof DECIMAL_FIELDS)[number][0];
    onChange({ ...value, [field]: event.currentTarget.value });
  }

  function updateInteger(event: ChangeEvent<HTMLInputElement>) {
    const field = event.currentTarget.name as (typeof INTEGER_FIELDS)[number][0];
    onChange({ ...value, [field]: Number(event.currentTarget.value) });
  }

  return (
    <section aria-labelledby="risk-setup-title">
      <div className="step-tag">風險護欄</div>
      <h2 id="risk-setup-title">先設定可承受的範圍</h2>
      <p>每一項都必須有上限；網站或策略不能繞過這些本機限制。新策略一律先以模擬交易啟動。</p>
      <label>
        允許交易對（以逗號分隔）
        <input
          aria-describedby="allowed-symbols-help"
          disabled={disabled}
          value={value.allowedSymbols.join(", ")}
          onChange={(event) => onChange({
            ...value,
            allowedSymbols: event.currentTarget.value.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
          })}
          placeholder="BTCUSDT, ETHUSDT"
        />
      </label>
      <p id="allowed-symbols-help">只有列出的 WEEX 商品可以送單。</p>
      <div className="columns">
        {DECIMAL_FIELDS.map(([field, label]) => (
          <label key={field}>{label}<input required disabled={disabled} name={field} inputMode="decimal" value={value[field]} onChange={updateDecimal} /></label>
        ))}
        {INTEGER_FIELDS.map(([field, label, step]) => (
          <label key={field}>{label}<input required disabled={disabled} name={field} type="number" min={1} step={step} value={value[field]} onChange={updateInteger} /></label>
        ))}
      </div>
      {!isRiskPolicyComplete(value) && <p role="alert" className="inline-notice">請填妥所有風險上限後再申請實盤。</p>}
    </section>
  );
}
