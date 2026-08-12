"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { HistoricalBacktestRecord } from "../backtests/BacktestResultCard";
import type { BotConfig } from "../../lib/types";
import { RiskPolicyForm, isCompleteRiskPolicy, type RiskPolicyDraft } from "./RiskPolicyForm";

const defaultRisk = (config: BotConfig): RiskPolicyDraft => ({ allowedSymbols: [config.symbol],
  maxOrderNotional: "100", maxPositionNotional: "500", maxTotalExposure: "1000",
  maxSimultaneousPositions: 2, maxDailyLoss: "50", maxLeverage: String(config.market === "spot" ? 1 : config.leverage),
  maxSlippageBps: 30, minSignalCooldownMs: 60_000, maxConsecutiveFailures: 3,
  operationMode: "automatic" });
const key = () => `run-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export function CreateRunPanel({ backtest, config }: { backtest: HistoricalBacktestRecord; config: BotConfig }) {
  const [open, setOpen] = useState(false); const [risk, setRisk] = useState(() => defaultRisk(config));
  const [state, setState] = useState<"idle" | "ready" | "submitting" | "error" | "unauthorized" | "done">("idle");
  const [message, setMessage] = useState(""); const [runId, setRunId] = useState<string | null>(null);
  const attempt = useRef<string | null>(null);
  const configurationHash = backtest.result?.configurationHash;
  const isSubmitting = state === "submitting";
  const canCreate = (state === "ready" || state === "error") && risk.operationMode === "automatic" && isCompleteRiskPolicy(risk)
    && typeof configurationHash === "string" && /^[a-f0-9]{64}$/.test(configurationHash);

  const load = () => { setOpen(true); setState("ready"); setMessage(""); };
  const create = async () => {
    if (!canCreate || !configurationHash) return;
    setState("submitting"); setMessage(""); attempt.current ??= key();
    try {
      const response = await fetch("/api/cloud-runs", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current },
        body: JSON.stringify({ strategyVersionId: backtest.strategyVersionId, botName: config.name,
          configurationHash, mode: "futures-demo", riskPolicy: risk }) });
      if (response.status === 401) { setState("unauthorized"); return; }
      const body: unknown = await response.json(); const run = body && typeof body === "object"
        ? (body as { run?: unknown }).run : null;
      const id = run && typeof run === "object" ? (run as { id?: unknown }).id : null;
      if (!response.ok || typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
        throw new Error("run_failed");
      }
      setRunId(id); setState("done"); setMessage("WEEX Futures Demo 雲端運行已啟動；關閉瀏覽器後仍會持續執行。");
    } catch { setState("error"); setMessage("無法建立雲端運行；請先在連線頁綁定有效的 WEEX API。"); }
  };

  if (!backtest.result || backtest.status !== "succeeded" || config.market !== "futures" || config.source !== undefined) return null;
  return <section className="create-run-panel glass-panel" aria-labelledby={`create-run-${backtest.id}`}>
    <div><p className="eyebrow">DEPLOY TO 24/7 CLOUD</p><h2 id={`create-run-${backtest.id}`}>建立雲端交易機器人</h2>
      <p>設定完整風險上限後，由固定 IP 的 AWS Executor 全天候執行。第一階段固定使用 WEEX Futures Demo。</p></div>
    {!open && <button className="button button--primary" onClick={load} type="button">設定風控並啟動雲端策略</button>}
    {open && <>
      {state === "unauthorized" && <p>請先登入才能建立運行。</p>}
      {state !== "done" && <>
        <RiskPolicyForm
          description="所有欄位都必須完整；AWS Executor 會在每次評估與送單前重新套用風控。"
          disabled={state === "submitting"}
          legend="自動交易風險上限"
          onChange={(next) => { setRisk(next); attempt.current = null; if (state === "error") setState("ready"); }}
          value={risk}
        />
        <p className="create-run-panel__mode">必須選擇「在上限內自動」。目前只會向 WEEX Futures Demo 送單；Live 資金交易仍由後端閘門關閉。</p>
        <button className="button button--primary" disabled={!canCreate || isSubmitting}
          onClick={() => void create()} type="button">{isSubmitting ? "啟動雲端執行中…" : "啟動 24/7 雲端策略"}</button>
      </>}
    </>}
    {message && <p className="control-feedback" role={state === "error" ? "alert" : "status"}>{message}</p>}
    {state === "done" && runId && <Link className="button button--primary" href="/runs">前往雲端運行控制中心</Link>}
  </section>;
}
