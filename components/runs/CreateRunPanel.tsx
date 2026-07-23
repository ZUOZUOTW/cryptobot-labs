"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { HistoricalBacktestRecord } from "../backtests/BacktestResultCard";
import type { BotConfig } from "../../lib/types";
import { RiskPolicyForm, isCompleteRiskPolicy, type RiskPolicyDraft } from "./RiskPolicyForm";

interface DeviceOption { id: string; name: string; platform: "macos" | "windows"; connected: boolean }

const devicesOf = (value: unknown): DeviceOption[] | null => {
  if (!value || typeof value !== "object" || !Array.isArray((value as { connections?: unknown }).connections)) return null;
  const result: DeviceOption[] = [];
  for (const item of (value as { connections: unknown[] }).connections) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const device = item as Record<string, unknown>;
    if (typeof device.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(device.id)
      || typeof device.name !== "string" || device.name.length < 1 || device.name.length > 100
      || (device.platform !== "macos" && device.platform !== "windows") || device.deviceStatus !== "active") return null;
    const connection = device.connection;
    const connected = Boolean(connection && typeof connection === "object"
      && (connection as { status?: unknown }).status === "verified"
      && (connection as { hasLocalCredential?: unknown }).hasLocalCredential === true);
    result.push({ id: device.id, name: device.name, platform: device.platform, connected });
  }
  return result;
};

const defaultRisk = (config: BotConfig): RiskPolicyDraft => ({ allowedSymbols: [config.symbol],
  maxOrderNotional: "100", maxPositionNotional: "500", maxTotalExposure: "1000",
  maxSimultaneousPositions: 2, maxDailyLoss: "50", maxLeverage: String(config.market === "spot" ? 1 : config.leverage),
  maxSlippageBps: 30, minSignalCooldownMs: 60_000, maxConsecutiveFailures: 3,
  operationMode: "approval-required" });
const key = () => `run-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export function CreateRunPanel({ backtest, config }: { backtest: HistoricalBacktestRecord; config: BotConfig }) {
  const [open, setOpen] = useState(false); const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [deviceId, setDeviceId] = useState(""); const [risk, setRisk] = useState(() => defaultRisk(config));
  const [state, setState] = useState<"idle" | "loading" | "ready" | "submitting" | "error" | "unauthorized" | "done">("idle");
  const [message, setMessage] = useState(""); const [runId, setRunId] = useState<string | null>(null);
  const attempt = useRef<string | null>(null);
  const configurationHash = backtest.result?.configurationHash;
  const isSubmitting = state === "submitting";
  const canCreate = (state === "ready" || state === "error") && deviceId.length > 0 && isCompleteRiskPolicy(risk)
    && typeof configurationHash === "string" && /^[a-f0-9]{64}$/.test(configurationHash);

  const load = async () => {
    setOpen(true); setState("loading"); setMessage("");
    try {
      const response = await fetch("/api/connections", { cache: "no-store", headers: { Accept: "application/json" } });
      if (response.status === 401) { setState("unauthorized"); return; }
      const parsed = devicesOf(await response.json());
      if (!response.ok || parsed === null) throw new Error("devices_failed");
      setDevices(parsed); setDeviceId(parsed[0]?.id ?? ""); setState("ready");
    } catch { setState("error"); setMessage("無法載入已配對裝置，請稍後重試。"); }
  };
  const create = async () => {
    if (!canCreate || !configurationHash) return;
    setState("submitting"); setMessage(""); attempt.current ??= key();
    try {
      const response = await fetch("/api/runs", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current },
        body: JSON.stringify({ deviceId, strategyVersionId: backtest.strategyVersionId, botName: config.name,
          configurationHash, riskPolicy: risk }) });
      if (response.status === 401) { setState("unauthorized"); return; }
      const body: unknown = await response.json(); const run = body && typeof body === "object"
        ? (body as { run?: unknown }).run : null;
      const id = run && typeof run === "object" ? (run as { id?: unknown }).id : null;
      if (!response.ok || typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
        throw new Error("run_failed");
      }
      setRunId(id); setState("done"); setMessage("模擬運行已建立並送至本機代理；不會直接啟用實盤交易。");
    } catch { setState("error"); setMessage("無法建立運行；裝置或策略版本可能已更新，請重試。"); }
  };

  if (!backtest.result || backtest.status !== "succeeded") return null;
  return <section className="create-run-panel glass-panel" aria-labelledby={`create-run-${backtest.id}`}>
    <div><p className="eyebrow">DEPLOY TO LOCAL AGENT</p><h2 id={`create-run-${backtest.id}`}>建立交易機器人運行</h2>
      <p>選擇已配對電腦並設定完整風險上限。新運行固定從模擬模式開始，不會直接送出真實訂單。</p></div>
    {!open && <button className="button button--primary" onClick={() => void load()} type="button">選擇裝置並建立模擬運行</button>}
    {open && <>
      {state === "loading" && <p role="status">正在載入已配對裝置…</p>}
      {state === "unauthorized" && <p>請先登入才能建立運行。 <Link href="/auth?return_to=%2Fworkshop">重新登入</Link></p>}
      {(state === "ready" || state === "submitting" || state === "error") && devices.length === 0 && <p>尚無已配對裝置。 <Link href="/connections">前往安裝及配對 Agent</Link></p>}
      {devices.length > 0 && state !== "done" && <>
        <label className="create-run-panel__device"><span>執行裝置</span><select disabled={state === "submitting"}
          onChange={(event) => { setDeviceId(event.target.value); attempt.current = null;
            if (state === "error") setState("ready"); }} value={deviceId}>{devices.map((device) =>
            <option key={device.id} value={device.id}>{device.name} · {device.platform === "macos" ? "macOS" : "Windows"}{device.connected ? " · WEEX 已驗證" : " · 尚未驗證 WEEX"}</option>)}</select></label>
        <RiskPolicyForm disabled={state === "submitting"} onChange={(next) => { setRisk(next); attempt.current = null;
          if (state === "error") setState("ready"); }} value={risk} />
        <p className="create-run-panel__mode">執行方式選擇「在上限內自動」後，未來通過獨立實盤解鎖時才允許自動下單；目前階段只會模擬。</p>
        <button className="button button--primary" disabled={!canCreate || isSubmitting}
          onClick={() => void create()} type="button">{isSubmitting ? "建立並排隊中…" : "建立模擬運行"}</button>
      </>}
    </>}
    {message && <p className="control-feedback" role={state === "error" ? "alert" : "status"}>{message}</p>}
    {state === "done" && runId && <Link className="button button--primary" href={`/runs/${runId}`}>前往運行控制中心</Link>}
  </section>;
}
