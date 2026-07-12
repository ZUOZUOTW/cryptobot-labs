"use client";

import { useState } from "react";
import type { ConnectionDevice } from "./types";

const STATUS = {
  verified: "已驗證", erased: "本機憑證已清除",
} as const;
const DEVICE_STATUS = { active: "已授權" } as const;
const HEARTBEAT_FRESH_MS = 120_000;

const localDate = (value: number | null) => value === null ? "尚無紀錄" : new Intl.DateTimeFormat("zh-TW", {
  dateStyle: "medium", timeStyle: "short",
}).format(value);

export function DeviceCard({ device, observedAt, onRevoke }: {
  device: ConnectionDevice; observedAt: number; onRevoke: (id: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const connection = device.connection;
  const heartbeatState = device.lastSeenAt === null ? "尚未回報"
    : observedAt - device.lastSeenAt <= HEARTBEAT_FRESH_MS ? "最近 2 分鐘內有回報" : "已超過 2 分鐘未回報";
  const revoke = async () => {
    setBusy(true);
    try { await onRevoke(device.id); }
    finally { setBusy(false); setConfirming(false); }
  };

  return (
    <article className="device-card">
      <header className="device-card__header">
        <div><p>{device.platform === "macos" ? "macOS" : "Windows"}</p><h3>{device.name}</h3></div>
        <span className={`connection-pill connection-pill--${device.deviceStatus}`}>{DEVICE_STATUS[device.deviceStatus]}</span>
      </header>
      <dl className="device-facts">
        <div><dt>交易連線</dt><dd>{connection?.provider ?? "尚未設定"}</dd></div>
        <div><dt>API Key</dt><dd>{connection?.maskedApiKeySuffix ?? "未提供"}</dd></div>
        <div><dt>連線狀態</dt><dd>{connection ? STATUS[connection.status] : "尚未設定"}</dd></div>
        <div><dt>最近驗證</dt><dd>{localDate(connection?.verifiedAt ?? null)}</dd></div>
        <div><dt>本機憑證</dt><dd>{connection?.hasLocalCredential ? "本機已保存" : "本機未保存"}</dd></div>
        <div><dt>代理健康</dt><dd>{heartbeatState}</dd></div>
        <div><dt>最近連線</dt><dd>{localDate(device.lastSeenAt)}</dd></div>
      </dl>
      <div className="permission-list" aria-label="WEEX API 權限">
        <span className={connection?.permissions.read ? "is-allowed" : ""}>讀取：{connection?.permissions.read ? "允許" : "未允許"}</span>
        <span className={connection?.permissions.spotTrade ? "is-allowed" : ""}>現貨交易：{connection?.permissions.spotTrade ? "允許" : "未允許"}</span>
        <span className={connection?.permissions.futuresTrade ? "is-allowed" : ""}>合約交易：{connection?.permissions.futuresTrade ? "允許" : "未允許"}</span>
        <span className="is-safe">提領：{connection?.permissions.withdrawal ? "已允許（請移除）" : "未允許"}</span>
      </div>
      <p className="connection-note" role="note">網站不保存 API Key 或 API Secret。撤銷裝置會阻止它繼續存取控制平面，但不會遠端刪除電腦內的檔案。</p>
      <div className="device-actions">
        <button className="button button--ghost button--small" disabled title="代理命令通道將於執行控制功能完成後啟用" type="button">重新驗證（尚未啟用）</button>
        <button className="button button--ghost button--small" disabled title="請先在本機代理中清除憑證" type="button">清除本機憑證（請到代理操作）</button>
        {!confirming ? <button className="button button--danger button--small" onClick={() => setConfirming(true)} type="button">撤銷此裝置</button> : (
          <div className="device-confirm" role="group" aria-label="確認撤銷裝置">
            <span>確定撤銷？</span>
            <button className="button button--danger button--small" disabled={busy} onClick={() => void revoke()} type="button">{busy ? "撤銷中…" : "確認撤銷"}</button>
            <button className="button button--ghost button--small" disabled={busy} onClick={() => setConfirming(false)} type="button">取消</button>
          </div>
        )}
      </div>
    </article>
  );
}
