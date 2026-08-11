"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { cloudRunFailureMessage } from "./CloudRunsPanel";
import { attributeCloudPositions, type PositionAttribution } from "./cloudPositionAttribution";
import { formatExactDecimal, sumExactDecimals } from "./exactDecimal";
import { CLOUD_RUNS_REFRESH_EVENT } from "./events";
import { useAdaptiveRefresh } from "./useAdaptiveRefresh";

type RunState = "running" | "paused" | "stopped" | "error";

interface CloudRun {
  id: string;
  name: string;
  mode: "futures-demo" | "live";
  state: RunState;
  market: "spot" | "futures";
  symbol: string;
  version: number;
  lastCandleAt: number | null;
  lastEvaluatedAt: number | null;
  lastSignalJson: Record<string, unknown> | null;
  lastErrorCode: string | null;
  consecutiveFailures: number;
  updatedAt: number;
  allowedSymbols: string[];
  accountObservedAt: number | null;
  accountEquity: string | null;
  availableEquity: string | null;
  unrealizedPnl: string | null;
  evaluationCount: number;
  signalCount: number;
  maxTotalExposure: string | null;
  maxDailyLoss: string | null;
}

interface CloudPosition {
  symbol: string;
  side: "long" | "short";
  leverage: string;
  size: string;
  openValue: string;
  unrealizedPnl: string;
  updatedAt: number;
}

interface CloudAccount {
  observedAt: number | null;
  accountEquity: string | null;
  availableEquity: string | null;
  unrealizedPnl: string | null;
  positions: CloudPosition[] | null;
}

const CLOUD_SYMBOL = /^[A-Z0-9_]{3,32}$/;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const integer = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const nullableInteger = (value: unknown): number | null | undefined =>
  value === null ? null : integer(value) ?? undefined;
const nullableText = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === "string" ? value : undefined;
const jsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === "string") {
    try { return record(JSON.parse(value) as unknown); } catch { return null; }
  }
  return record(value);
};
const jsonArray = (value: unknown): unknown[] | null => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const parsePosition = (value: unknown): CloudPosition | null => {
  const item = record(value);
  if (!item || typeof item.symbol !== "string"
    || (item.side !== "long" && item.side !== "short")
    || typeof item.leverage !== "string" || typeof item.size !== "string"
    || typeof item.openValue !== "string" || typeof item.unrealizedPnl !== "string") return null;
  const updatedAt = integer(item.updatedAt);
  return updatedAt === null ? null : {
    symbol: item.symbol, side: item.side, leverage: item.leverage, size: item.size,
    openValue: item.openValue, unrealizedPnl: item.unrealizedPnl, updatedAt,
  };
};

const parseRun = (value: unknown): CloudRun | null => {
  const item = record(value);
  if (!item || typeof item.id !== "string" || typeof item.name !== "string"
    || (item.mode !== "futures-demo" && item.mode !== "live")
    || !["running", "paused", "stopped", "error"].includes(String(item.state))
    || (item.market !== "spot" && item.market !== "futures")
    || typeof item.symbol !== "string" || !CLOUD_SYMBOL.test(item.symbol)
    || !Array.isArray(item.allowedSymbols)
    || item.allowedSymbols.some((symbol) => typeof symbol !== "string")) return null;
  const version = integer(item.version);
  const lastCandleAt = nullableInteger(item.lastCandleAt);
  const lastEvaluatedAt = nullableInteger(item.lastEvaluatedAt);
  const consecutiveFailures = integer(item.consecutiveFailures);
  const updatedAt = integer(item.updatedAt);
  const accountObservedAt = nullableInteger(item.accountObservedAt);
  const evaluationCount = integer(item.evaluationCount);
  const signalCount = integer(item.signalCount);
  const lastErrorCode = nullableText(item.lastErrorCode);
  const accountEquity = nullableText(item.accountEquity);
  const availableEquity = nullableText(item.availableEquity);
  const unrealizedPnl = nullableText(item.unrealizedPnl);
  const maxTotalExposure = nullableText(item.maxTotalExposure);
  const maxDailyLoss = nullableText(item.maxDailyLoss);
  if (version === null || version < 1 || lastCandleAt === undefined
    || lastEvaluatedAt === undefined || consecutiveFailures === null || updatedAt === null
    || accountObservedAt === undefined || evaluationCount === null || signalCount === null
    || lastErrorCode === undefined || accountEquity === undefined || availableEquity === undefined
    || unrealizedPnl === undefined || maxTotalExposure === undefined || maxDailyLoss === undefined) return null;
  return {
    id: item.id, name: item.name, mode: item.mode, state: item.state as RunState, version,
    market: item.market, symbol: item.symbol,
    lastCandleAt, lastEvaluatedAt, lastSignalJson: item.lastSignalJson === null
      ? null : jsonRecord(item.lastSignalJson), lastErrorCode, consecutiveFailures, updatedAt,
    allowedSymbols: item.allowedSymbols as string[], accountObservedAt, accountEquity,
    availableEquity, unrealizedPnl, evaluationCount, signalCount, maxTotalExposure, maxDailyLoss,
  };
};

const parsePayload = (value: unknown, runId: string): {
  run: CloudRun | null;
  runs: CloudRun[];
  account: CloudAccount | null;
} | null => {
  const item = record(value);
  if (!item || !Array.isArray(item.runs)) return null;
  const runs = item.runs.map(parseRun);
  if (runs.some((run) => run === null)) return null;
  let account: CloudAccount | null = null;
  if (item.account !== null) {
    const raw = record(item.account);
    const positionSnapshotMissing = raw?.positionsJson === null;
    const positions = positionSnapshotMissing ? null : raw && jsonArray(raw.positionsJson);
    const observedAt = raw && nullableInteger(raw.observedAt);
    const accountEquity = raw && nullableText(raw.accountEquity);
    const availableEquity = raw && nullableText(raw.availableEquity);
    const unrealizedPnl = raw && nullableText(raw.unrealizedPnl);
    const parsedPositions = positions?.map(parsePosition) ?? null;
    if (!raw || (!positionSnapshotMissing && !positions)
      || observedAt === undefined || accountEquity === undefined
      || availableEquity === undefined || unrealizedPnl === undefined
      || (parsedPositions !== null && parsedPositions.some((position) => position === null))) return null;
    account = {
      observedAt, accountEquity, availableEquity, unrealizedPnl,
      positions: parsedPositions as CloudPosition[] | null,
    };
  }
  const parsedRuns = runs as CloudRun[];
  return { run: parsedRuns.find((run) => run.id === runId) ?? null, runs: parsedRuns, account };
};

const stateLabel: Record<RunState, string> = {
  running: "運行中",
  paused: "已暫停",
  stopped: "已停止",
  error: "需要處理",
};

export function CloudRunDetailPanel({ runId }: { runId: string }) {
  const { locale } = useI18n();
  const [run, setRun] = useState<CloudRun | null>(null);
  const [runs, setRuns] = useState<CloudRun[]>([]);
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error" | "unauthorized">("loading");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async (silent = false): Promise<boolean> => {
    if (!silent) { setState("loading"); setFeedback(""); }
    try {
      const response = await fetch("/api/cloud-runs", {
        cache: "no-store", headers: { Accept: "application/json" },
      });
      if (response.status === 401) { setState("unauthorized"); return false; }
      const parsed = parsePayload(await response.json(), runId);
      if (!response.ok || !parsed) throw new Error("invalid_cloud_run_detail");
      if (!parsed.run) { setState("missing"); return false; }
      setRun(parsed.run);
      setRuns(parsed.runs);
      setAccount(parsed.account);
      setState("ready");
      return true;
    } catch {
      if (!silent) setState("error");
      return false;
    }
  }, [runId]);

  useAdaptiveRefresh({
    eventName: CLOUD_RUNS_REFRESH_EVENT,
    refresh: (initial) => load(!initial),
  });

  const positionEvidence = useMemo<{
    attribution: PositionAttribution;
    positions: CloudPosition[];
  }>(() => run ? attributeCloudPositions(runs, run, account?.positions ?? [])
    : { attribution: "not-applicable", positions: [] }, [account, run, runs]);
  const hasPositionSnapshot = account?.positions !== null && account?.positions !== undefined;
  const positions = positionEvidence.positions;
  const targetPositionUnrealizedPnl = useMemo(() => {
    if (positionEvidence.attribution !== "unique" || !hasPositionSnapshot) return null;
    return sumExactDecimals(positions.map((position) => position.unrealizedPnl));
  }, [hasPositionSnapshot, positionEvidence.attribution, positions]);
  const lastAction = typeof run?.lastSignalJson?.action === "string"
    ? run.lastSignalJson.action : null;
  const time = (value: number | null) => value === null ? "尚無可信證據"
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(value);
  const amount = (value: string | null) => {
    if (value === null) return "尚無可信證據";
    const formatted = formatExactDecimal(value, locale, { maximumFractionDigits: 8 });
    return formatted === null ? "尚無可信證據" : `${formatted} USDT`;
  };
  const targetPositionPnlLabel = positionEvidence.attribution === "ambiguous" ? "不可歸屬"
    : positionEvidence.attribution === "unmanaged" ? "不可歸屬"
      : positionEvidence.attribution === "not-applicable" ? "不適用"
        : hasPositionSnapshot ? amount(targetPositionUnrealizedPnl) : "尚無可信證據";
  const positionCountLabel = positionEvidence.attribution === "ambiguous" ? "不可歸屬"
    : positionEvidence.attribution === "unmanaged" ? "不可歸屬"
      : positionEvidence.attribution === "not-applicable" ? "不適用"
        : hasPositionSnapshot ? String(positions.length) : "尚無可信證據";
  const emptyPositionCopy = positionEvidence.attribution === "ambiguous"
    ? "多個未停止策略共用相同合約交易目標，無法安全歸屬帳戶部位。"
    : positionEvidence.attribution === "unmanaged"
      ? "帳戶已有未受此運行管理的部位，無法安全歸屬部位與損益。"
      : run?.mode !== "live" ? "這是模擬運行；實盤帳戶部位不會歸屬到此運行。"
        : run?.state === "stopped" ? "此策略已停止，不歸屬目前帳戶合約部位。"
          : run?.market === "spot" ? "這是現貨策略；帳戶合約部位不會歸屬到此策略。"
            : !hasPositionSnapshot ? "尚無可用的帳戶部位快照，暫不顯示目標部位與損益。"
              : `最新帳戶快照沒有 ${run?.symbol ?? "此交易對"} 合約持倉。`;

  const transition = async (next: "running" | "paused" | "stopped") => {
    if (!run) return;
    setBusy(true); setFeedback("");
    try {
      const response = await fetch(`/api/cloud-runs/${encodeURIComponent(run.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next, expectedVersion: run.version }),
      });
      const body = await response.json() as { run?: unknown; error?: unknown };
      if (!response.ok && body.error === "cloud_run_target_conflict") {
        throw new Error("cloud_run_target_conflict");
      }
      const updated = parseRun(body.run);
      if (!response.ok || !updated) throw new Error("transition_failed");
      setRun(updated);
      setRuns((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
      setFeedback(next === "running" ? "恢復命令已接受；Executor 將先核對未完成訂單，再評估新行情。"
        : next === "paused" ? "策略已暫停，不會新增交易。" : "策略已停止，無法從此頁重新啟動。");
      window.dispatchEvent(new Event(CLOUD_RUNS_REFRESH_EVENT));
    } catch (error) {
      setFeedback(error instanceof Error && error.message === "cloud_run_target_conflict"
        ? "此 WEEX 帳戶的同一市場與交易對已有其他未停止策略；目前策略維持原狀，請先停止原策略再恢復。"
        : "控制命令未被接受；已保留原狀態，正在重新同步最新版本。");
      await load(true);
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") return <p className="runs-empty">正在載入 AWS Executor 運行證據…</p>;
  if (state === "unauthorized") return <p className="runs-empty">登入狀態已過期。 <Link href={`/auth?return_to=${encodeURIComponent(`/runs/${runId}`)}`}>重新登入</Link></p>;
  if (state === "missing") return <div className="runs-empty"><p>找不到這個雲端運行。</p><Link className="button button--secondary" href="/runs">返回控制台</Link></div>;
  if (state === "error" || !run) return <div className="runs-empty"><p>暫時無法讀取雲端運行證據；策略狀態沒有被更動。</p><button className="button button--secondary" onClick={() => void load()} type="button">重新同步</button></div>;

  return <div className="run-detail">
    <header className="run-detail__header glass-panel">
      <div><p className="eyebrow">AWS EXECUTOR / {run.id}</p><h1>{run.name}</h1>
        <p>{run.mode === "live" ? "WEEX 實盤運行" : "WEEX 合約模擬"} · {stateLabel[run.state]}</p></div>
      <div className="run-detail__actions">
        {run.state !== "stopped" && (run.state === "running"
          ? <button className="button button--secondary" disabled={busy}
            onClick={() => void transition("paused")} type="button">{busy ? "處理中…" : "暫停新增交易"}</button>
          : <button className="button button--primary" disabled={busy}
            onClick={() => void transition("running")} type="button">{busy ? "安全檢查中…" : "恢復策略"}</button>)}
        {run.state !== "stopped" && <button className="button button--ghost" disabled={busy}
          onClick={() => void transition("stopped")} type="button">停止策略</button>}
      </div>
    </header>

    {run.lastErrorCode && <p className="control-feedback" data-error-code={run.lastErrorCode} role="alert">
      Executor 暫停原因：{cloudRunFailureMessage(run.lastErrorCode)}
    </p>}
    {feedback && <p className="control-feedback" role="status">{feedback}</p>}

    <section className="run-evidence" aria-labelledby="cloud-evidence-title">
      <div className="section-heading"><p className="eyebrow">LIVE EXECUTION EVIDENCE</p>
        <h2 id="cloud-evidence-title">策略績效與執行證據</h2></div>
      <dl className="run-facts run-facts--detail">
        <div><dt>狀態</dt><dd>{stateLabel[run.state]}</dd></div>
        <div><dt>交易目標</dt><dd>{run.symbol} · {run.market === "futures" ? "合約" : "現貨"}</dd></div>
        <div><dt>帳戶權益</dt><dd>{amount(account?.accountEquity ?? run.accountEquity)}</dd></div>
        <div><dt>可用權益</dt><dd>{amount(account?.availableEquity ?? run.availableEquity)}</dd></div>
        <div><dt>交易目標部位未實現損益</dt><dd>{targetPositionPnlLabel}
          <small style={{ display: "block", marginTop: "0.2rem" }}>帳戶聚合，非 run_id 成交歸屬</small></dd></div>
        <div><dt>帳戶未實現損益</dt><dd>{amount(account?.unrealizedPnl ?? run.unrealizedPnl)}</dd></div>
        <div><dt>交易目標部位</dt><dd>{positionCountLabel}</dd></div>
        <div><dt>有效評估</dt><dd>{run.evaluationCount}</dd></div>
        <div><dt>交易訊號</dt><dd>{run.signalCount}</dd></div>
        <div><dt>最近訊號</dt><dd>{lastAction ?? "尚無訊號"}</dd></div>
        <div><dt>連續失敗</dt><dd>{run.consecutiveFailures}</dd></div>
        <div><dt>最後評估</dt><dd>{time(run.lastEvaluatedAt)}</dd></div>
        <div><dt>最後行情完成</dt><dd>{time(run.lastCandleAt)}</dd></div>
        <div><dt>帳戶快照</dt><dd>{time(account?.observedAt ?? run.accountObservedAt)}</dd></div>
        <div><dt>曝險上限</dt><dd>{run.maxTotalExposure ?? "尚未回報"} USDT</dd></div>
        <div><dt>每日虧損上限</dt><dd>{run.maxDailyLoss ?? "尚未回報"} USDT</dd></div>
        <div><dt>證據版本</dt><dd>v{run.version} · {time(run.updatedAt)}</dd></div>
      </dl>
    </section>

    <section className="run-positions" aria-labelledby="cloud-positions-title">
      <h2 id="cloud-positions-title">帳戶交易目標部位</h2>
      {positions.length === 0 ? <p className="runs-empty">{emptyPositionCopy}</p>
        : <div className="table-shell glass-panel"><table><thead><tr><th>交易對</th><th>方向</th>
          <th>數量</th><th>槓桿</th><th>曝險</th><th>未實現損益</th><th>更新時間</th></tr></thead>
        <tbody>{positions.map((position) => <tr key={`${position.symbol}-${position.side}`}>
          <td>{position.symbol}</td><td>{position.side === "long" ? "做多" : "做空"}</td>
          <td>{position.size}</td><td>{position.leverage}×</td><td>{position.openValue} USDT</td>
          <td>{position.unrealizedPnl} USDT</td><td>{time(position.updatedAt)}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
