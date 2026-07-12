"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DeviceCard } from "./DeviceCard";
import type { ConnectionDevice, ConnectionPermissions, ConnectionSummary } from "./types";

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const string = (value: unknown) => typeof value === "string" ? value : null;
const nullableTimestamp = (value: unknown): number | null | undefined => value === null ? null
  : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(",") === [...keys].sort().join(",");

const permissionsOf = (value: unknown): ConnectionPermissions | null => {
  const source = record(value);
  if (!source || !exactKeys(source, ["read", "spotTrade", "futuresTrade", "withdrawal"])
    || source.read !== true || typeof source.spotTrade !== "boolean"
    || typeof source.futuresTrade !== "boolean" || source.withdrawal !== false) return null;
  return { read: true, spotTrade: source.spotTrade, futuresTrade: source.futuresTrade, withdrawal: false };
};

const connectionOf = (value: unknown): ConnectionSummary | null => {
  const source = record(value);
  if (!source || !exactKeys(source, ["provider", "maskedApiKeySuffix", "permissions", "verifiedAt", "status", "hasLocalCredential"])) return null;
  const provider = source.provider === "WEEX" ? "WEEX" : null;
  const status = ["verified", "erased"].includes(String(source.status))
    ? source.status as ConnectionSummary["status"] : null;
  if (!provider || !status) return null;
  const masked = source.maskedApiKeySuffix === null ? null : string(source.maskedApiKeySuffix);
  const permissions = permissionsOf(source.permissions);
  const verifiedAt = nullableTimestamp(source.verifiedAt);
  if ((masked !== null && !/^\*{4}[A-Za-z0-9]{4}$/.test(masked)) || permissions === null || verifiedAt === undefined
    || typeof source.hasLocalCredential !== "boolean") return null;
  if (status === "verified" && (masked === null || verifiedAt === null || !source.hasLocalCredential)) return null;
  if (status === "erased" && (masked !== null || verifiedAt !== null || source.hasLocalCredential)) return null;
  return { provider, maskedApiKeySuffix: masked, permissions, verifiedAt, status,
    hasLocalCredential: source.hasLocalCredential };
};

const deviceOf = (value: unknown): ConnectionDevice | null => {
  const source = record(value);
  if (!source || !exactKeys(source, ["id", "name", "platform", "deviceStatus", "lastSeenAt", "connection"])) return null;
  const id = string(source.id);
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) return null;
  if (source.platform !== "macos" && source.platform !== "windows") return null;
  if (source.deviceStatus !== "active") return null;
  const name = string(source.name);
  if (!name || name.length > 100) return null;
  const lastSeenAt = nullableTimestamp(source.lastSeenAt);
  if (lastSeenAt === undefined) return null;
  const connection = source.connection === null ? null : connectionOf(source.connection);
  if (source.connection !== null && connection === null) return null;
  return { id, name, platform: source.platform, deviceStatus: source.deviceStatus,
    lastSeenAt, connection };
};

const itemsOf = (value: unknown): ConnectionDevice[] | null => {
  const source = record(value);
  if (!source || !exactKeys(source, ["connections", "nextCursor"])) return null;
  if (source.nextCursor !== null && string(source.nextCursor) === null) return null;
  const items = source && Array.isArray(source.connections) ? source.connections : null;
  if (!items) return null;
  const parsed = items.map(deviceOf);
  if (parsed.some((item) => item === null)) return null;
  return parsed as ConnectionDevice[];
};

export function ConnectionsPanel() {
  const [items, setItems] = useState<ConnectionDevice[]>([]);
  const [observedAt, setObservedAt] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unauthorized">("loading");
  const [feedback, setFeedback] = useState("");
  const load = useCallback(async () => {
    setState("loading"); setFeedback("");
    try {
      const response = await fetch("/api/connections", { cache: "no-store", headers: { Accept: "application/json" } });
      if (response.status === 401) { setState("unauthorized"); return; }
      const body: unknown = await response.json();
      const parsed = itemsOf(body);
      if (!response.ok || parsed === null) throw new Error("connections_failed");
      setItems(parsed); setObservedAt(Date.now()); setState("ready");
    } catch { setState("error"); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const revoke = async (id: string) => {
    setFeedback("");
    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE", cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("revoke_failed");
      setItems((current) => current.filter((item) => item.id !== id));
      setFeedback("裝置已撤銷。請在該電腦的本機代理中另行清除 API 憑證。");
    } catch { setFeedback("無法撤銷此裝置，請重新整理後再試。"); }
  };

  return (
    <section className="connections-panel" aria-labelledby="devices-title">
      <div className="connection-card__heading"><div><p className="eyebrow">TRUSTED DEVICES</p><h2 id="devices-title">我的代理裝置</h2></div>{state === "ready" && <button className="button button--ghost button--small" onClick={() => void load()} type="button">重新整理</button>}</div>
      <div aria-live="polite">
        {state === "loading" && <p className="connections-empty">正在載入裝置與連線狀態…</p>}
        {state === "error" && <div className="connections-empty"><p>無法載入裝置。</p><button className="button button--secondary button--small" onClick={() => void load()} type="button">重試載入</button></div>}
        {state === "unauthorized" && <p className="connections-empty">登入狀態已過期。 <Link href="/signin-with-chatgpt?return_to=%2Fconnections">使用 ChatGPT 重新登入</Link></p>}
        {feedback && <p className="connection-feedback" role="status">{feedback}</p>}
      </div>
      {state === "ready" && items.length === 0 && <p className="connections-empty">尚無已配對裝置。請先安裝本機代理，再使用上方配對碼。</p>}
      {state === "ready" && items.length > 0 && <ul className="device-list" aria-label="我的代理裝置">{items.map((device) => <li key={device.id}><DeviceCard device={device} observedAt={observedAt} onRevoke={revoke} /></li>)}</ul>}
    </section>
  );
}
