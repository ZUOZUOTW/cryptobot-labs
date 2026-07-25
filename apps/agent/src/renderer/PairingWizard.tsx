import { useEffect, useRef, useState, type FormEvent } from "react";

import type { AgentRendererApi } from "../shared/ipc-contract";
import { pairingCodeFromDeepLink } from "../shared/pairing-deep-link";

interface PairingWizardProps {
  api: AgentRendererApi;
  paired: boolean;
  startAtLogin: boolean;
  disabled?: boolean;
  suggestedCode?: string;
  onChanged(): Promise<void>;
  onMessage(message: string): void;
}

export function PairingWizard({ api, paired, startAtLogin, disabled = false, suggestedCode = "", onChanged, onMessage }: PairingWizardProps) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(suggestedCode);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  // The native deep-link can arrive after the renderer mounts and must hydrate the controlled field.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!paired && suggestedCode) setCode(suggestedCode); }, [paired, suggestedCode]);
  useEffect(() => {
    if (!scannerOpen) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    type Detection = { rawValue: string };
    type Detector = { detect(source: HTMLVideoElement): Promise<Detection[]> };
    type DetectorConstructor = new (options: { formats: string[] }) => Detector;
    const DetectorClass = (globalThis as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    if (!DetectorClass || !navigator.mediaDevices?.getUserMedia) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScannerMessage("此系統不支援相機掃描，請使用網站的「在這台電腦開啟 Agent」或複製配對碼。");
      return;
    }
    const detector = new DetectorClass({ formats: ["qr_code"] });
    const scan = async () => {
      if (cancelled || !videoRef.current) return;
      try {
        const results = await detector.detect(videoRef.current);
        const parsed = results.map(({ rawValue }) => pairingCodeFromDeepLink(rawValue)).find(Boolean);
        if (parsed) {
          setCode(parsed); setScannerMessage("已讀取一次性配對碼，請確認裝置名稱後按「配對裝置」。"); setScannerOpen(false); return;
        }
      } catch { /* Camera frames can be temporarily unavailable while starting. */ }
      if (!cancelled) timer = window.setTimeout(() => void scan(), 300);
    };
    void navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment" } }).then(async (next) => {
      if (cancelled) { next.getTracks().forEach((track) => track.stop()); return; }
      stream = next;
      if (!videoRef.current) return;
      videoRef.current.srcObject = next;
      await videoRef.current.play();
      setScannerMessage("請將網站顯示的 QR Code 對準相機。畫面只在本機辨識，不會上傳。");
      void scan();
    }).catch(() => { if (!cancelled) setScannerMessage("無法使用相機，請允許相機權限或改用複製配對碼。"); });
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [scannerOpen]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await api.pair({
        code: String(form.get("code") ?? "").trim(),
        deviceName: String(form.get("deviceName") ?? "").trim(),
      });
      formElement.reset();
      setCode("");
      onMessage("裝置配對完成；網站只會看到此裝置的公開金鑰與安全狀態");
      try { await onChanged(); }
      catch { onMessage("裝置配對完成，但暫時無法重新讀取狀態；請勿重複使用原配對碼"); }
    } catch {
      onMessage("配對失敗：請確認網路後，前往網站 /connections 重新產生五分鐘有效的配對碼");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStartAtLogin(enabled: boolean) {
    setBusy(true);
    try {
      await api.setStartAtLogin(enabled);
      onMessage(enabled ? "已開啟登入後啟動" : "已關閉登入後啟動");
      try { await onChanged(); }
      catch { onMessage(`${enabled ? "已開啟" : "已關閉"}登入後啟動，但暫時無法重新讀取狀態`); }
    } catch {
      onMessage("無法更新自動啟動設定");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="pairing-title">
      <div className="step-tag">步驟 1</div>
      <h2 id="pairing-title">配對 CryptoBot Labs 網站</h2>
      <p>前往網站的「連線管理 /connections」產生五分鐘有效的一次性配對碼。配對只上傳裝置公開金鑰，不會上傳 WEEX 憑證。</p>
      <label>
        配對碼
        <input
          required
          name="code"
          minLength={26}
          maxLength={26}
          pattern="CBL-[A-Za-z0-9_-]{22}"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="CBL-…"
          value={code}
          onChange={(event) => setCode(event.currentTarget.value)}
          disabled={disabled || busy || paired}
        />
      </label>
      <label>
        裝置名稱
        <input required name="deviceName" maxLength={80} defaultValue="我的交易電腦" disabled={disabled || busy || paired} />
      </label>
      <button className="scanner-button" disabled={disabled || busy || paired} onClick={() => { setScannerMessage(""); setScannerOpen((open) => !open); }} type="button">
        {scannerOpen ? "關閉 QR 掃描" : "用相機掃描 QR Code"}
      </button>
      {scannerOpen && <div className="qr-scanner"><video aria-label="QR Code 相機預覽" muted playsInline ref={videoRef} /></div>}
      {scannerMessage && <p className="scanner-message" role="status">{scannerMessage}</p>}
      <button disabled={disabled || busy || paired} type="submit">
        {paired ? "已完成配對" : busy ? "安全配對中…" : "配對裝置"}
      </button>
      <label className="toggle">
        <input
          type="checkbox"
          checked={startAtLogin}
          disabled={disabled || busy}
          onChange={(event) => void toggleStartAtLogin(event.currentTarget.checked)}
        />
        登入後啟動本機代理（選用）
      </label>
    </form>
  );
}
