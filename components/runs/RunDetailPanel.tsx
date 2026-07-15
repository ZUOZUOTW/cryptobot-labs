"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmergencyStopDialog, type EmergencyCommand } from "./EmergencyStopDialog";
import { LiveUnlockDialog, type LivePermissions } from "./LiveUnlockDialog";
import { parseRunView } from "./run-parser";
import { MODE_LABEL, type RunView } from "./types";

const key = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export const permissionsForDevice = (value: unknown, deviceId: string, market: "spot" | "futures"): LivePermissions | null => {
  if (!value || typeof value !== "object" || !Array.isArray((value as { connections?: unknown }).connections)) return null;
  const connection = (value as { connections: unknown[] }).connections.find((entry) => entry && typeof entry === "object" && (entry as { id?: unknown }).id === deviceId) as { connection?: unknown } | undefined;
  const detail = connection?.connection as { status?: unknown; hasLocalCredential?: unknown; permissions?: unknown } | undefined;
  const permissions = detail?.permissions as { read?: unknown; spotTrade?: unknown; futuresTrade?: unknown; withdrawal?: unknown } | undefined;
  if (!detail || detail.status !== "verified" || typeof detail.hasLocalCredential !== "boolean" || !permissions || permissions.read !== true || permissions.withdrawal !== false || typeof permissions.spotTrade !== "boolean" || typeof permissions.futuresTrade !== "boolean") return null;
  return { verified: true, hasLocalCredential: detail.hasLocalCredential, read: true, trade: market === "spot" ? permissions.spotTrade : permissions.futuresTrade, withdrawal: false };
};
const evidenceTime = (value: number) => new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(value);

export function RunDetailPanel({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunView | null>(null);
  const [permissions, setPermissions] = useState<LivePermissions | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unauthorized">("loading");
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const load = useCallback(async (silent = false) => {
    if (!silent) { setState("loading"); setFeedback(""); }
    try {
      const [runResponse, connectionsResponse] = await Promise.all([
        fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store", headers: { Accept: "application/json" } }),
        fetch("/api/connections", { cache: "no-store", headers: { Accept: "application/json" } }),
      ]);
      if (runResponse.status === 401) { setState("unauthorized"); return; }
      const body: unknown = await runResponse.json();
      const parsed = body && typeof body === "object" && Object.keys(body).length === 1 ? parseRunView((body as { run?: unknown }).run) : null;
      if (!runResponse.ok || !parsed) throw new Error("invalid_run_detail");
      setRun(parsed);
      if (connectionsResponse.ok) setPermissions(permissionsForDevice(await connectionsResponse.json(), parsed.device.id, parsed.market));
      else setPermissions(null);
      setState("ready");
    } catch { if (!silent) setState("error"); }
  }, [runId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => void load(true), 15_000);
    return () => { window.clearTimeout(timer); window.clearInterval(refresh); };
  }, [load]);

  const command = async (input: EmergencyCommand | { type: "resume-paper" | "resume-demo" | "resume-live"
    | "enable-futures-demo" | "pause"; reason: string }) => {
    if (!run) return;
    const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/commands`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key() }, body: JSON.stringify({ ...input, expectedVersion: run.version }) });
    if (!response.ok) { setLifecyclePending(false); setFeedback("控制命令未被接受，請重新整理運行證據後再試。"); return; }
    if (input.type === "resume-paper" || input.type === "resume-demo" || input.type === "resume-live"
      || input.type === "enable-futures-demo" || input.type === "pause") {
      setFeedback(input.type === "resume-paper" ? "Paper 開始命令已排隊，等待本機代理回報運行證據。"
        : input.type === "resume-demo" ? "WEEX Demo 啟動命令已排隊，等待本機代理完成安全檢查。"
        : input.type === "resume-live" ? "實盤啟動命令已排隊；本機代理通過即時安全檢查後才會啟動。"
        : input.type === "enable-futures-demo" ? "合約 Demo 啟用命令已排隊；代理確認後重新整理即可啟動。"
        : `${run.mode === "live" ? "實盤" : run.mode === "futures-demo" ? "WEEX Demo" : "Paper"} 暫停命令已排隊，等待本機代理回報暫停證據。`);
      return;
    }
    await load();
    setFeedback(input.type === "stop-new-orders" ? "已送出停止新訂單命令；現有掛單與部位不會被自動更動。" : input.type === "cancel-open-orders" ? "已送出取消掛單命令；現有部位不會被關閉。" : "已送出獨立的高風險平倉命令。");
  };

  if (state === "loading") return <p className="runs-empty">正在載入運行控制中心…</p>;
  if (state === "unauthorized") return <p className="runs-empty">登入狀態已過期。 <Link href={`/auth?return_to=${encodeURIComponent(`/runs/${runId}`)}`}>重新登入</Link></p>;
  if (state === "error" || !run) return <div className="runs-empty"><p>找不到此運行，或證據格式不完整。</p><button className="button button--secondary" onClick={() => void load()} type="button">重試載入</button></div>;

  const safePermissions = permissions ?? { verified: false, hasLocalCredential: false, read: false, trade: false, withdrawal: false as const };
  const livePermissionReady = safePermissions.verified && safePermissions.hasLocalCredential
    && safePermissions.read && safePermissions.trade && safePermissions.withdrawal === false;
  const demoPermissionReady = run.market === "futures" && safePermissions.verified
    && safePermissions.hasLocalCredential && safePermissions.read && safePermissions.trade;
  const lifecycleType = run.state === "running" ? "pause" : run.mode === "live" ? "resume-live"
    : run.mode === "futures-demo" ? "resume-demo" : "resume-paper";
  const lifecycleReason = run.mode === "live" ? "user-live-control"
    : run.mode === "futures-demo" ? "user-demo-control" : "user-paper-control";
  const lifecycleLabel = run.state === "running"
    ? run.mode === "live" ? "暫停實盤交易" : run.mode === "futures-demo" ? "暫停 WEEX Demo" : "暫停模擬運行"
    : run.mode === "live" ? "啟動實盤自動交易" : run.mode === "futures-demo" ? "啟動 WEEX Demo 自動交易" : "開始模擬運行";
  const performanceLabel = run.mode === "live" ? "實盤績效"
    : run.mode === "futures-demo" ? "WEEX 合約模擬績效" : "模擬運行績效";
  return (
    <div className="run-detail">
      <header className="run-detail__header glass-panel"><div><p className="eyebrow">CONTROLLED RUN / {run.id}</p><h1>{run.botName}</h1><p>{MODE_LABEL[run.mode]} · {run.state === "running" ? "運行中" : run.state === "paused" ? "已暫停" : run.state === "error" ? "需要處理" : "已停止"}</p></div><div className="run-detail__actions"><button className={`button ${run.state === "running" ? "button--secondary" : "button--primary"}`} disabled={lifecyclePending || run.state === "error"} onClick={() => { setLifecyclePending(true); void command({ type: lifecycleType, reason: lifecycleReason }); }} type="button">{lifecyclePending ? "等待代理回報" : lifecycleLabel}</button>{run.mode === "paper" && run.market === "futures" && <button className="button button--secondary" disabled={lifecyclePending || run.state === "running" || !demoPermissionReady || run.riskPolicy.operationMode !== "automatic"} onClick={() => { setLifecyclePending(true); void command({ type: "enable-futures-demo", reason: "user-demo-enable" }); }} type="button">{run.riskPolicy.operationMode !== "automatic" ? "Demo 需使用自動模式風控" : demoPermissionReady ? "啟用 WEEX 合約 Demo" : "Demo 權限未就緒"}</button>}<button className="button button--danger" disabled={run.mode === "live" || !livePermissionReady} onClick={() => setUnlockOpen(true)} type="button">{run.mode === "live" ? "已是實盤" : livePermissionReady ? "申請啟用實盤" : "實盤權限未就緒"}</button></div></header>
      <section className="run-evidence" aria-labelledby="evidence-title">
        <div className="section-heading"><p className="eyebrow">AGENT EVIDENCE</p><h2 id="evidence-title">{performanceLabel}</h2></div>
        <dl className="run-facts run-facts--detail">
          <div><dt>市場</dt><dd>{run.market === "spot" ? "現貨" : "合約"}</dd></div>
          <div><dt>代理健康</dt><dd>{run.health ?? "尚無目前版本回報"}</dd></div>
          <div><dt>今日總損益</dt><dd>{run.pnl === null ? "尚無可信證據" : `${run.pnl} USDT`}</dd></div>
          <div><dt>今日已實現</dt><dd>{run.realizedPnl === null ? "尚無可信證據" : `${run.realizedPnl} USDT`}</dd></div>
          <div><dt>目前未實現</dt><dd>{run.unrealizedPnl === null ? "尚無可信證據" : `${run.unrealizedPnl} USDT`}</dd></div>
          <div><dt>心跳來源</dt><dd>{run.evidence.heartbeatOccurredAt === null ? "尚無目前部署版本心跳" : `版本 ${run.evidence.heartbeatExpectedDeploymentVersion} · ${evidenceTime(run.evidence.heartbeatOccurredAt)}`}</dd></div>
          <div><dt>持倉數</dt><dd>{run.positions.length}</dd></div>
          <div><dt>掛單數</dt><dd>{run.openOrders.length}</dd></div>
          <div><dt>最後訊號</dt><dd>{run.lastSignal ? `${run.lastSignal.reason} · 版本 ${run.lastSignal.expectedDeploymentVersion} · ${evidenceTime(run.lastSignal.occurredAt)}` : "尚無訊號"}</dd></div>
          <div><dt>風險攔截</dt><dd>{run.riskBlocks.length ? `${run.riskBlocks.length} 筆 · 最近 ${evidenceTime(run.riskBlocks[0]!.occurredAt)}` : "無紀錄"}</dd></div>
        </dl>
      </section>
      <section className="run-positions" aria-labelledby="positions-title"><h2 id="positions-title">部位與掛單</h2>{run.positions.length === 0 && run.openOrders.length === 0 ? <p className="runs-empty">代理尚未回報任何持倉或掛單證據。</p> : <div className="table-shell glass-panel"><table><thead><tr><th>類型</th><th>交易對</th><th>方向</th><th>數量</th><th>狀態 / 未實現損益</th></tr></thead><tbody>{run.positions.map((position) => <tr key={`${position.symbol}-${position.side}`}><td>部位</td><td>{position.symbol}</td><td>{position.side}</td><td>{position.quantity}</td><td>{position.unrealizedPnl}</td></tr>)}{run.openOrders.map((order) => <tr key={order.id}><td>掛單</td><td>{order.symbol}</td><td>{order.side}</td><td>{order.quantity}</td><td>{order.state}</td></tr>)}</tbody></table></div>}</section>
      {feedback && <p className="control-feedback" role="status">{feedback}</p>}
      <EmergencyStopDialog mode={run.mode} onCommand={command} />
      {unlockOpen && <LiveUnlockDialog botName={run.botName} onCancel={() => setUnlockOpen(false)} onConfirm={async ({ typedBotName, riskAcknowledged, acceptedAt }) => { const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/live-unlock`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key() }, body: JSON.stringify({ expectedVersion: run.version, typedBotName, riskAcknowledged, acceptedAt }) }); if (!response.ok) throw new Error("live_unlock_rejected"); setUnlockOpen(false); await load(); setFeedback("實盤申請已送至本機代理，仍需由代理獨立重新驗證後才可能啟用。"); }} permissions={safePermissions} policy={run.riskPolicy} />}
    </div>
  );
}
