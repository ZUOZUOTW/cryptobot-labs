import { useState, type FormEvent } from "react";

import type { Market, RiskPolicy } from "@cryptobot-labs/trading-core";
import { isRiskPolicyComplete } from "./RiskSetup";

export interface LiveUnlockSummary {
  botName: string;
  market: Market;
  symbol: string;
  requestedLeverage: string;
  apiKeySuffix: string;
  credentialVerified: boolean;
  permissions: {
    read: boolean;
    spot: boolean;
    futures: boolean;
    withdrawal: false | "unknown";
  };
  policy: RiskPolicy;
}

export type LiveUnlockBlocker =
  | "credential-not-verified"
  | "read-permission-missing"
  | "trade-permission-missing"
  | "withdrawal-permission-unverified"
  | "risk-policy-incomplete";

export function getLiveUnlockBlockers(summary: LiveUnlockSummary): LiveUnlockBlocker[] {
  const blockers: LiveUnlockBlocker[] = [];
  if (!summary.credentialVerified) blockers.push("credential-not-verified");
  if (!summary.permissions.read) blockers.push("read-permission-missing");
  if (summary.market === "spot" ? !summary.permissions.spot : !summary.permissions.futures) blockers.push("trade-permission-missing");
  if (summary.permissions.withdrawal !== false) blockers.push("withdrawal-permission-unverified");
  if (!isRiskPolicyComplete(summary.policy)) blockers.push("risk-policy-incomplete");
  return blockers;
}

export function canSubmitLiveUnlock(
  summary: LiveUnlockSummary,
  typedBotName: string,
  acceptedRisk: boolean,
): boolean {
  return getLiveUnlockBlockers(summary).length === 0 && acceptedRisk && typedBotName === summary.botName;
}

interface LiveUnlockProps {
  summary: LiveUnlockSummary;
  busy?: boolean;
  onUnlock(input: { typedBotName: string; acceptedRisk: true }): Promise<void> | void;
}

const BLOCKER_COPY: Record<LiveUnlockBlocker, string> = {
  "credential-not-verified": "尚未由本機代理驗證 WEEX API",
  "read-permission-missing": "缺少讀取權限",
  "trade-permission-missing": "缺少所選市場的交易權限",
  "withdrawal-permission-unverified": "無法確認提幣權限已關閉",
  "risk-policy-incomplete": "風險上限尚未填妥",
};

export function LiveUnlock({ summary, busy = false, onUnlock }: LiveUnlockProps) {
  const [typedBotName, setTypedBotName] = useState("");
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const blockers = getLiveUnlockBlockers(summary);
  const canSubmit = canSubmitLiveUnlock(summary, typedBotName, acceptedRisk) && !busy;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    await onUnlock({ typedBotName, acceptedRisk: true });
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-labelledby="live-unlock-title">
      <div className="step-tag">高風險操作</div>
      <h2 id="live-unlock-title">解鎖 WEEX 實盤</h2>
      <p>目前仍是 CryptoBot Labs 模擬交易。實盤解鎖只適用於下方這個帳戶、策略與風險範圍。</p>
      <dl>
        <dt>機器人</dt><dd>{summary.botName}</dd>
        <dt>市場</dt><dd>{summary.market === "spot" ? "WEEX 現貨實盤" : "WEEX 合約實盤"}</dd>
        <dt>商品 / 槓桿</dt><dd>{summary.symbol} / {summary.market === "spot" ? "1×" : `${summary.requestedLeverage}×`}</dd>
        <dt>本機金鑰</dt><dd>WEEX ••••{summary.apiKeySuffix || "未設定"}</dd>
        <dt>單筆 / 每日虧損上限</dt><dd>{summary.policy.maximumOrderNotional} / {summary.policy.maximumDailyLoss} USDT</dd>
      </dl>
      {blockers.length > 0 && (
        <div role="alert" className="inline-notice">
          <strong>實盤維持鎖定</strong>
          <ul>{blockers.map((blocker) => <li key={blocker}>{BLOCKER_COPY[blocker]}</li>)}</ul>
        </div>
      )}
      <label className="toggle">
        <input type="checkbox" checked={acceptedRisk} disabled={busy || blockers.length > 0} onChange={(event) => setAcceptedRisk(event.currentTarget.checked)} />
        我了解自動交易可能快速造成損失，並接受上述風險範圍。
      </label>
      <label>
        輸入機器人名稱「{summary.botName}」以確認
        <input
          aria-label="輸入機器人名稱以解鎖實盤"
          autoComplete="off"
          disabled={busy || blockers.length > 0}
          value={typedBotName}
          onChange={(event) => setTypedBotName(event.currentTarget.value)}
        />
      </label>
      <button type="submit" disabled={!canSubmit}>{busy ? "重新驗證中…" : "重新驗證並解鎖實盤"}</button>
      <p>解鎖時本機代理仍會重新驗證權限、商品規則與行情時效；任何一項失敗都不會送單。</p>
    </form>
  );
}
