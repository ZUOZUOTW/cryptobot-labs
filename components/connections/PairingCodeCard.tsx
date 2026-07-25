"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

type PairingResponse = { code: string; expiresAt: number };
const CODE = /^CBL-[A-Za-z0-9_-]{22}$/;

const validPairing = (value: unknown): value is PairingResponse => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === "string" && CODE.test(record.code)
    && typeof record.expiresAt === "number" && Number.isSafeInteger(record.expiresAt);
};

const pairingLink = (code: string) => `cryptobot-labs://pair?code=${encodeURIComponent(code)}`;

export function PairingCodeCard({ onPairingIssued }: { onPairingIssued?: () => void } = {}) {
  const [pairing, setPairing] = useState<PairingResponse | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "error" | "unauthorized">("idle");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (!pairing) return;
    const update = () => setSeconds(Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1_000)));
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [pairing]);

  useEffect(() => {
    let active = true;
    if (!pairing) return () => { active = false; };
    void QRCode.toDataURL(pairingLink(pairing.code), {
      width: 224, margin: 2, errorCorrectionLevel: "M",
      color: { dark: "#07101d", light: "#ffffff" },
    }).then((value) => { if (active) setQrDataUrl(value); })
      .catch(() => { if (active) setQrDataUrl(""); });
    return () => { active = false; };
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
      setPairing(body); setCopyState("idle"); setState("idle"); onPairingIssued?.();
    } catch { setState("error"); }
  };

  const copyCode = async () => {
    if (!pairing || seconds <= 0) return;
    try { await navigator.clipboard.writeText(pairing.code); setCopyState("copied"); }
    catch { setCopyState("error"); }
  };

  return (
    <section className="connection-card connection-card--pairing" aria-labelledby="pairing-title">
      <div className="connection-card__heading"><div><p className="eyebrow">SECURE PAIRING</p><h2 id="pairing-title">掃描 QR Code</h2></div><span className="connection-step">02</span></div>
      <p className="connection-card__copy">QR Code 只包含五分鐘有效的一次性配對碼，並直接在此裝置產生，不會送到第三方服務。</p>
      {pairing && seconds > 0 ? (
        <div className="pairing-ready" aria-live="polite">
          <div className="pairing-qr">
            {qrDataUrl ? <Image alt="供 CryptoBot Labs Agent 掃描的五分鐘配對 QR Code" height={224} src={qrDataUrl} unoptimized width={224} />
              : <span>正在本機產生 QR Code…</span>}
          </div>
          <div className="pairing-ready__actions">
            <a className="button button--primary" href={pairingLink(pairing.code)}>在這台電腦開啟 Agent</a>
            <button className="button button--ghost" onClick={() => void copyCode()} type="button">{copyState === "copied" ? "已複製配對碼" : "複製配對碼"}</button>
            <code>{pairing.code}</code>
            <span>剩餘 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
            {copyState === "error" && <small role="alert">無法存取剪貼簿，請手動輸入上方配對碼。</small>}
          </div>
        </div>
      ) : <p className="pairing-placeholder">尚未產生配對 QR Code</p>}
      <button className="button button--primary pairing-button" disabled={state === "loading"} onClick={() => void issue()} type="button">
        {state === "loading" ? "正在產生…" : pairing ? "重新產生五分鐘 QR Code" : "產生五分鐘配對 QR Code"}
      </button>
      {state === "error" && <p className="connection-feedback connection-feedback--error" role="alert">暫時無法產生配對碼，請稍後再試。</p>}
      {state === "unauthorized" && <p className="connection-feedback connection-feedback--error" role="alert">登入狀態已過期，請重新登入。</p>}
    </section>
  );
}
