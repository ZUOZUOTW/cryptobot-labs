"use client";

import { useEffect, useState } from "react";

type PairingResponse = { code: string; expiresAt: number };
const CODE = /^CBL-[A-Za-z0-9_-]{22}$/;

const validPairing = (value: unknown): value is PairingResponse => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === "string" && CODE.test(record.code)
    && typeof record.expiresAt === "number" && Number.isSafeInteger(record.expiresAt);
};

export function PairingCodeCard() {
  const [pairing, setPairing] = useState<PairingResponse | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "error" | "unauthorized">("idle");

  useEffect(() => {
    if (!pairing) return;
    const update = () => setSeconds(Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1_000)));
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [pairing]);

  const issue = async () => {
    setState("loading");
    try {
      const response = await fetch("/api/pairing-codes", {
        method: "POST", cache: "no-store", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: "{}",
      });
      if (response.status === 401) { setState("unauthorized"); return; }
      const body: unknown = await response.json();
      if (!response.ok || !validPairing(body) || body.expiresAt <= Date.now()) throw new Error("pairing_failed");
      setPairing(body);
      setState("idle");
    } catch { setState("error"); }
  };

  return (
    <section className="connection-card connection-card--pairing" aria-labelledby="pairing-title">
      <div className="connection-card__heading"><div><p className="eyebrow">SECURE PAIRING</p><h2 id="pairing-title">連結你的裝置</h2></div><span className="connection-step">02</span></div>
      <p className="connection-card__copy">配對碼只維持五分鐘。請在本機代理中輸入；API Secret 永遠只在本機代理設定。</p>
      {pairing && seconds > 0 ? (
        <div className="pairing-code" aria-live="polite">
          <code>{pairing.code}</code>
          <span>剩餘 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
        </div>
      ) : <p className="pairing-placeholder">尚未產生配對碼</p>}
      <button className="button button--primary pairing-button" disabled={state === "loading"} onClick={() => void issue()} type="button">
        {state === "loading" ? "正在產生…" : "產生五分鐘配對碼"}
      </button>
      {state === "error" && <p className="connection-feedback connection-feedback--error" role="alert">暫時無法產生配對碼，請稍後再試。</p>}
      {state === "unauthorized" && <p className="connection-feedback connection-feedback--error" role="alert">登入狀態已過期，請重新登入。</p>}
    </section>
  );
}
