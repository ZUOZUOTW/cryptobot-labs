import { useState } from "react";

export type DashboardMode = "paper" | "futures-demo" | "live";

export const DEFAULT_DASHBOARD_MODE: DashboardMode = "paper";

interface DashboardProps {
  botName: string;
  market: "spot" | "futures";
  liveUnlocked: boolean;
  busy?: boolean;
  onModeChange?(mode: DashboardMode): void;
  onEmergencyStop(): Promise<void> | void;
  onCancelOpenOrders(): Promise<void> | void;
  onClosePositions(): Promise<void> | void;
}

export function Dashboard({
  botName,
  market,
  liveUnlocked,
  busy = false,
  onModeChange,
  onEmergencyStop,
  onCancelOpenOrders,
  onClosePositions,
}: DashboardProps) {
  const [mode, setMode] = useState<DashboardMode>(DEFAULT_DASHBOARD_MODE);
  const [closePhrase, setClosePhrase] = useState("");
  const closeConfirmation = `平倉 ${botName}`;

  function selectMode(next: DashboardMode) {
    setMode(next);
    onModeChange?.(next);
  }

  function cancelOrders() {
    if (window.confirm("只撤銷目前掛單？這不會平倉，也不會重新啟動送單。")) void onCancelOpenOrders();
  }

  return (
    <section aria-labelledby="dashboard-title">
      <div className="step-tag">運行控制台</div>
      <h2 id="dashboard-title">{botName}</h2>
      <p>新部署固定從模擬交易開始。切換模式不會自動撤單或平倉。</p>
      <fieldset disabled={busy}>
        <legend>執行模式</legend>
        <label className="toggle"><input type="radio" name="mode" checked={mode === "paper"} onChange={() => selectMode("paper")} />CryptoBot Labs 模擬交易（預設）</label>
        {market === "futures" && <label className="toggle"><input type="radio" name="mode" checked={mode === "futures-demo"} onChange={() => selectMode("futures-demo")} />WEEX 合約 Demo</label>}
        <label className="toggle"><input type="radio" name="mode" checked={mode === "live"} disabled={!liveUnlocked} onChange={() => selectMode("live")} />WEEX {market === "spot" ? "現貨" : "合約"}實盤{!liveUnlocked && "（尚未解鎖）"}</label>
      </fieldset>
      {market === "spot" && <p className="inline-notice">現貨模擬由 CryptoBot Labs 執行，不是 WEEX Demo 或測試網。</p>}

      <div className="danger-zone">
        <div><h2>停止新訂單</h2><p>本機立即阻擋新單；不撤銷掛單、不平倉。</p></div>
        <button disabled={busy} type="button" onClick={() => void onEmergencyStop()}>緊急停止新單</button>
      </div>
      <div className="danger-zone">
        <div><h2>撤銷掛單</h2><p>僅撤銷尚未成交的訂單；現有持倉保持不變。</p></div>
        <button disabled={busy} type="button" onClick={cancelOrders}>確認後撤單</button>
      </div>
      <div className="danger-zone">
        <div>
          <h2>平倉</h2><p>這是獨立的高風險操作，不會因停止或撤單自動執行。</p>
          <label>輸入「{closeConfirmation}」<input disabled={busy} value={closePhrase} onChange={(event) => setClosePhrase(event.currentTarget.value)} /></label>
        </div>
        <button disabled={busy || closePhrase !== closeConfirmation} type="button" onClick={() => void onClosePositions()}>確認平倉</button>
      </div>
    </section>
  );
}
