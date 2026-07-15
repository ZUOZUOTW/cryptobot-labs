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

export function DeviceCard({ device, observedAt, onCommand, onRevoke }: {
  device: ConnectionDevice; observedAt: number;
  onCommand: (device: ConnectionDevice, type: "revalidate-connection" | "erase-local-credentials") => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [eraseConfirming, setEraseConfirming] = useState(false);
  const [busy, setBusy] = useState<"revalidate" | "erase" | "revoke" | null>(null);
  const connection = device.connection;
  const heartbeatState = device.lastSeenAt === null ? "尚未回報"
    : observedAt - device.lastSeenAt <= HEARTBEAT_FRESH_MS ? "最近 2 分鐘內有回報" : "已超過 2 分鐘未回報";
  const revoke = async () => {
    setBusy("revoke");
    try { await onRevoke(device.id); }
    finally { setBusy(null); setConfirming(false); }
  };
  const connectionCommand = async (type: "revalidate-connection" | "erase-local-credentials") => {
    setBusy(type === "revalidate-connection" ? "revalidate" : "erase");
    try { await onCommand(device, type); }
    finally { setBusy(null); setEraseConfirming(false); }
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
      <p className="connection-note" role="note">網站不保存 API Key 或 API Secret。清除命令會要求代理先暫停交易再刪除本機金鑰；撤銷裝置只會阻止控制平面存取。</p>
      <div className="device-actions">
        <button className="button button--ghost button--small" disabled={busy !== null || !device.commandTarget || !connection?.hasLocalCredential}
          onClick={() => void connectionCommand("revalidate-connection")} title={!device.commandTarget ? "請先建立 Paper 運行" : undefined} type="button">
          {busy === "revalidate" ? "命令排隊中…" : "重新驗證 WEEX"}</button>
        {!eraseConfirming ? <button className="button button--ghost button--small"
          disabled={busy !== null || !device.commandTarget || !connection?.hasLocalCredential}
          onClick={() => setEraseConfirming(true)} title={!device.commandTarget ? "請先建立 Paper 運行" : undefined}
          type="button">清除本機憑證</button> : (
          <div className="device-confirm" role="group" aria-label="確認清除本機憑證">
            <span>將先暫停交易並永久刪除本機 WEEX 金鑰。</span>
            <button className="button button--danger button--small" disabled={busy !== null}
              onClick={() => void connectionCommand("erase-local-credentials")} type="button">
              {busy === "erase" ? "命令排隊中…" : "確認清除"}</button>
            <button className="button button--ghost button--small" disabled={busy !== null}
              onClick={() => setEraseConfirming(false)} type="button">取消</button>
          </div>)}
        {!confirming ? <button className="button button--danger button--small" onClick={() => setConfirming(true)} type="button">撤銷此裝置</button> : (
          <div className="device-confirm" role="group" aria-label="確認撤銷裝置">
            <span>確定撤銷？</span>
            <button className="button button--danger button--small" disabled={busy !== null} onClick={() => void revoke()} type="button">{busy === "revoke" ? "撤銷中…" : "確認撤銷"}</button>
            <button className="button button--ghost button--small" disabled={busy !== null} onClick={() => setConfirming(false)} type="button">取消</button>
          </div>
        )}
      </div>
    </article>
  );
}
