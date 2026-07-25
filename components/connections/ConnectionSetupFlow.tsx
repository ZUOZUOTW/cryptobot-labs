"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { AgentDownloadCard } from "./AgentDownloadCard";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { PairingCodeCard } from "./PairingCodeCard";
import type { ConnectionDevice } from "./types";

type StepState = "waiting" | "current" | "complete";
const STEP_LABELS = ["安裝 Agent", "掃描 QR Code", "連接 WEEX", "開始模擬運行"] as const;

export function ConnectionSetupFlow() {
  const [downloadStarted, setDownloadStarted] = useState(() => {
    try { return sessionStorage.getItem("cryptobot-labs:agent-download-started") === "1"; }
    catch { return false; }
  });
  const [pairingIssued, setPairingIssued] = useState(false);
  const [devices, setDevices] = useState<ConnectionDevice[]>([]);
  const paired = devices.length > 0;
  const verified = devices.some(({ connection }) => connection?.status === "verified" && connection.hasLocalCredential);

  const markDownload = () => {
    setDownloadStarted(true);
    try { sessionStorage.setItem("cryptobot-labs:agent-download-started", "1"); }
    catch { /* A blocked session store must not block the download. */ }
  };
  const onSnapshot = useCallback((next: ConnectionDevice[]) => setDevices(next), []);
  const states = useMemo<StepState[]>(() => [
    paired || downloadStarted ? "complete" : "current",
    paired ? "complete" : downloadStarted || pairingIssued ? "current" : "waiting",
    verified ? "complete" : paired ? "current" : "waiting",
    verified ? "current" : "waiting",
  ], [downloadStarted, paired, pairingIssued, verified]);

  return (
    <div className="connection-onboarding">
      <nav aria-label="Agent 設定進度" className="connection-progress">
        <ol>
          {STEP_LABELS.map((label, index) => <li data-state={states[index]} key={label}>
            <a href={`#connection-step-${index + 1}`}>
              <span>{states[index] === "complete" ? "完成" : `0${index + 1}`}</span>
              <strong>{label}</strong>
              <small>{states[index] === "complete" ? "已完成" : states[index] === "current" ? "現在進行" : "等待前一步"}</small>
            </a>
          </li>)}
        </ol>
      </nav>

      <div className="connections-setup">
        <div id="connection-step-1"><AgentDownloadCard onDownloadStarted={markDownload} /></div>
        <div id="connection-step-2"><PairingCodeCard onPairingIssued={() => setPairingIssued(true)} /></div>
      </div>

      <section className="connection-stage" id="connection-step-3" aria-labelledby="weex-connect-title">
        <div className="connection-stage__heading">
          <span className="connection-step">03</span>
          <div><p className="eyebrow">LOCAL CREDENTIAL VAULT</p><h2 id="weex-connect-title">在 Agent 連接 WEEX</h2>
            <p>回到桌面 Agent 輸入 API Key、Secret Key 與 Passphrase，再按「驗證權限」。網站永遠不會要求你在瀏覽器貼上憑證。</p></div>
        </div>
        <ol className="connection-checklist">
          <li data-complete={paired}><span>{paired ? "完成" : "1"}</span>Agent 已配對</li>
          <li data-complete={verified}><span>{verified ? "完成" : "2"}</span>WEEX API 已驗證</li>
          <li data-complete={verified}><span>{verified ? "完成" : "3"}</span>提領權限已關閉</li>
        </ol>
        <ConnectionsPanel onSnapshot={onSnapshot} />
      </section>

      <section className={`connection-stage simulation-launch${verified ? " is-ready" : ""}`} id="connection-step-4" aria-labelledby="simulation-start-title">
        <div className="connection-stage__heading">
          <span className="connection-step">04</span>
          <div><p className="eyebrow">SIMULATION FIRST</p><h2 id="simulation-start-title">開始模擬運行</h2>
            <p>{verified ? "連線已通過安全檢查。選擇策略、設定風險上限後，第一個運行固定使用模擬模式。" : "完成配對與 WEEX 權限驗證後，才會解鎖快速模擬運行入口。"}</p></div>
        </div>
        <div className="simulation-launch__guardrails" aria-label="模擬運行安全規則">
          <span>預設模擬模式</span><span>不送出真實訂單</span><span>實盤需再次同意風險</span>
        </div>
        <div className="button-row">
          {verified ? <Link className="button button--primary" href="/workshop?bot=orbit-dca&onboarding=paper">選擇穩健策略並開始模擬</Link>
            : <button className="button button--primary" disabled type="button">等待 WEEX 驗證</button>}
          <Link className="button button--ghost" href="/bots">先瀏覽所有策略</Link>
        </div>
      </section>
    </div>
  );
}
