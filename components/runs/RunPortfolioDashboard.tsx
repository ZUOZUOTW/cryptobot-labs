"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  FiActivity,
  FiAlertTriangle,
  FiCheckCircle,
  FiClock,
  FiCloud,
  FiEye,
  FiPauseCircle,
  FiPlayCircle,
  FiRefreshCw,
  FiShield,
  FiTrendingUp,
} from "react-icons/fi";
import { SiBitcoin, SiEthereum, SiSolana } from "react-icons/si";
import { useI18n } from "@/components/I18nProvider";
import { CLOUD_RUNS_REFRESH_EVENT } from "./events";
import { useAdaptiveRefresh } from "./useAdaptiveRefresh";

type LoadState = "loading" | "ready" | "error" | "unauthorized";
type RunState = "running" | "paused" | "stopped" | "error";
type RunFilter = "all" | "running" | "attention";

interface CloudBalance {
  asset: string;
  total: string;
  available: string;
  frozen: string;
  unrealizedPnl: string;
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

interface CloudRun {
  id: string;
  name: string;
  state: RunState;
  allowedSymbols: string[];
  evaluationCount: number;
  signalCount: number;
  lastEvaluatedAt: number | null;
  lastSignalJson: Record<string, unknown> | null;
  consecutiveFailures: number;
  maxTotalExposure: string | null;
  maxDailyLoss: string | null;
}

interface CloudAccount {
  connectionStatus: "active" | "pending" | "processing" | "reauthorization_required" | "revoked" | "error";
  syncStatus: "pending" | "ready" | "error" | null;
  accountUid: string | null;
  observedAt: number | null;
  balances: CloudBalance[];
  positions: CloudPosition[];
  accountEquity: string | null;
  availableEquity: string | null;
  unrealizedPnl: string | null;
  lastErrorCode: string | null;
}

interface RealizedPnlPoint {
  observedAt: number;
  netPnl: string;
  cumulativeNetPnl: string;
  tradeCount: number;
}

export interface DashboardPayload {
  generatedAt: number;
  runs: CloudRun[];
  account: CloudAccount | null;
  realizedPnl: {
    asset: string;
    total: string;
    tradeCount: number;
    points: RealizedPnlPoint[];
  };
}

interface RunPortfolioDashboardProps {
  initialPayload?: DashboardPayload;
  autoRefresh?: boolean;
}

const EMPTY_PAYLOAD: DashboardPayload = {
  generatedAt: 0,
  runs: [],
  account: null,
  realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
};
const COLORS = ["#ffad31", "#4f8cff", "#8c6df5", "#52d7d0", "#53e0a1", "#ff758f"];

const finite = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

const validPosition = (value: unknown): value is CloudPosition => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.symbol === "string" && (row.side === "long" || row.side === "short")
    && typeof row.leverage === "string" && typeof row.size === "string"
    && typeof row.openValue === "string" && typeof row.unrealizedPnl === "string"
    && Number.isSafeInteger(row.updatedAt);
};

const validBalance = (value: unknown): value is CloudBalance => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.asset === "string" && typeof row.total === "string"
    && typeof row.available === "string" && typeof row.frozen === "string"
    && typeof row.unrealizedPnl === "string";
};

const parseDashboard = (value: unknown): DashboardPayload | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.runs) || !root.realizedPnl || typeof root.realizedPnl !== "object"
    || Array.isArray(root.realizedPnl)) return null;
  const runs: CloudRun[] = [];
  for (const candidate of root.runs) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const run = candidate as Record<string, unknown>;
    const rawSignal = typeof run.lastSignalJson === "string"
      ? (() => { try { return JSON.parse(run.lastSignalJson) as unknown; } catch { return null; } })()
      : run.lastSignalJson;
    if (typeof run.id !== "string" || typeof run.name !== "string"
      || !["running", "paused", "stopped", "error"].includes(String(run.state))
      || !Array.isArray(run.allowedSymbols) || run.allowedSymbols.some((symbol) => typeof symbol !== "string")
      || !Number.isSafeInteger(run.evaluationCount) || !Number.isSafeInteger(run.signalCount)
      || !Number.isSafeInteger(run.consecutiveFailures)) return null;
    runs.push({
      id: run.id,
      name: run.name,
      state: run.state as RunState,
      allowedSymbols: run.allowedSymbols as string[],
      evaluationCount: run.evaluationCount as number,
      signalCount: run.signalCount as number,
      lastEvaluatedAt: Number.isSafeInteger(run.lastEvaluatedAt) ? run.lastEvaluatedAt as number : null,
      lastSignalJson: rawSignal && typeof rawSignal === "object" && !Array.isArray(rawSignal)
        ? rawSignal as Record<string, unknown> : null,
      consecutiveFailures: run.consecutiveFailures as number,
      maxTotalExposure: typeof run.maxTotalExposure === "string" ? run.maxTotalExposure : null,
      maxDailyLoss: typeof run.maxDailyLoss === "string" ? run.maxDailyLoss : null,
    });
  }
  let account: CloudAccount | null = null;
  if (root.account !== null) {
    if (!root.account || typeof root.account !== "object" || Array.isArray(root.account)) return null;
    const row = root.account as Record<string, unknown>;
    const balances = jsonArray(row.balancesJson);
    const positions = jsonArray(row.positionsJson);
    if (!["active", "pending", "processing", "reauthorization_required", "revoked", "error"]
      .includes(String(row.connectionStatus))
      || !(row.syncStatus === null || ["pending", "ready", "error"].includes(String(row.syncStatus)))
      || !balances || !balances.every(validBalance) || !positions || !positions.every(validPosition)) return null;
    account = {
      connectionStatus: row.connectionStatus as CloudAccount["connectionStatus"],
      syncStatus: row.syncStatus as CloudAccount["syncStatus"],
      accountUid: typeof row.accountUid === "string" ? row.accountUid : null,
      observedAt: Number.isSafeInteger(row.observedAt) ? row.observedAt as number : null,
      balances,
      positions,
      accountEquity: typeof row.accountEquity === "string" ? row.accountEquity : null,
      availableEquity: typeof row.availableEquity === "string" ? row.availableEquity : null,
      unrealizedPnl: typeof row.unrealizedPnl === "string" ? row.unrealizedPnl : null,
      lastErrorCode: typeof row.lastErrorCode === "string" ? row.lastErrorCode : null,
    };
  }
  const pnl = root.realizedPnl as Record<string, unknown>;
  if (typeof pnl.asset !== "string" || typeof pnl.total !== "string"
    || !Number.isSafeInteger(pnl.tradeCount) || !Array.isArray(pnl.points)) return null;
  const points: RealizedPnlPoint[] = [];
  for (const candidate of pnl.points) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const point = candidate as Record<string, unknown>;
    if (!Number.isSafeInteger(point.observedAt) || typeof point.netPnl !== "string"
      || typeof point.cumulativeNetPnl !== "string" || !Number.isSafeInteger(point.tradeCount)) return null;
    points.push(point as unknown as RealizedPnlPoint);
  }
  return {
    generatedAt: Number.isSafeInteger(root.generatedAt)
      ? root.generatedAt as number
      : account?.observedAt ?? points.at(-1)?.observedAt ?? 0,
    runs,
    account,
    realizedPnl: {
      asset: pnl.asset,
      total: pnl.total,
      tradeCount: pnl.tradeCount as number,
      points,
    },
  };
};

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const pad = (value: number): string => String(value).padStart(2, "0");
const taipeiParts = (value: number) => {
  const date = new Date(value + TAIPEI_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: pad(date.getUTCMonth() + 1),
    day: pad(date.getUTCDate()),
    hour: pad(date.getUTCHours()),
    minute: pad(date.getUTCMinutes()),
    second: pad(date.getUTCSeconds()),
  };
};
const dayKey = (value: number): string => {
  const parts = taipeiParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const baseAsset = (symbol: string): string => symbol.replace(/[_-]?USDT$/i, "") || symbol;

function MarketIcon({ symbol }: { symbol: string }) {
  const asset = baseAsset(symbol).toUpperCase();
  const Icon = asset === "BTC" ? SiBitcoin : asset === "ETH" ? SiEthereum
    : asset === "SOL" ? SiSolana : FiActivity;
  return <span aria-hidden="true" className="control-market-icon" data-asset={asset}><Icon /></span>;
}

export function RunPortfolioDashboard({
  initialPayload,
  autoRefresh = initialPayload === undefined,
}: RunPortfolioDashboardProps = {}) {
  const { locale } = useI18n();
  const [payload, setPayload] = useState<DashboardPayload>(initialPayload ?? EMPTY_PAYLOAD);
  const [state, setState] = useState<LoadState>(initialPayload ? "ready" : "loading");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(
    initialPayload?.account?.observedAt ?? null,
  );
  const [filter, setFilter] = useState<RunFilter>("all");

  const load = useCallback(async (showLoading = true): Promise<boolean> => {
    if (showLoading) setState("loading");
    try {
      const response = await fetch("/api/cloud-runs", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {
        setState("unauthorized");
        return false;
      }
      const parsed = parseDashboard(await response.json());
      if (!response.ok || !parsed) throw new Error("invalid_cloud_portfolio");
      setPayload(parsed);
      setLastRefreshedAt(Date.now());
      setState("ready");
      return true;
    } catch {
      if (showLoading) setState("error");
      return false;
    }
  }, []);

  useAdaptiveRefresh({
    enabled: autoRefresh,
    eventName: CLOUD_RUNS_REFRESH_EVENT,
    refresh: (initial) => load(initial),
  });

  const dashboard = useMemo(() => {
    const positions = payload.account?.positions ?? [];
    const allocations = (payload.account?.balances ?? [])
      .map((balance) => ({ balance, value: finite(balance.total) ?? 0 }))
      .filter(({ value }) => value > 0);
    const allocationTotal = allocations.reduce((sum, { value }) => sum + value, 0);
    const boundaries = allocations.reduce<number[]>((values, { value }) =>
      [...values, (values.at(-1) ?? 0) + (allocationTotal > 0 ? value / allocationTotal * 100 : 0)], [0]);
    const gradient = allocations.map((_allocation, index) => {
      const start = boundaries[index] ?? 0;
      const end = boundaries[index + 1] ?? start;
      return `${COLORS[index % COLORS.length]} ${start.toFixed(3)}% ${end.toFixed(3)}%`;
    }).join(", ");
    const todayPoint = [...payload.realizedPnl.points].reverse()
      .find((point) => dayKey(point.observedAt) === dayKey(payload.generatedAt));
    const rows = payload.runs.map((run) => {
      const runPositions = positions.filter((position) => run.allowedSymbols.includes(position.symbol));
      const exposure = runPositions.reduce((sum, position) => sum + (finite(position.openValue) ?? 0), 0);
      const unrealizedPnl = runPositions.reduce((sum, position) => sum + (finite(position.unrealizedPnl) ?? 0), 0);
      const maximumExposure = finite(run.maxTotalExposure);
      const riskUsage = maximumExposure && maximumExposure > 0
        ? Math.min(100, Math.max(0, exposure / maximumExposure * 100))
        : null;
      const attention = run.state === "error" || run.consecutiveFailures > 0
        || (riskUsage !== null && riskUsage >= 80);
      return { run, runPositions, exposure, unrealizedPnl, riskUsage, attention };
    });
    const attentionRows = rows.filter(({ attention }) => attention);
    const alerts = [
      ...(payload.account?.lastErrorCode ? [{
        id: "account-sync",
        tone: "warning" as const,
        title: "帳戶同步需要注意",
        body: "Executor 暫時無法取得最新帳戶快照，已保留上一筆可信資料。",
        safe: "系統不會在帳戶狀態不明時擴大曝險。",
        href: "/connections",
        action: "檢查連線",
      }] : []),
      ...attentionRows.map(({ run, riskUsage }) => ({
        id: run.id,
        tone: run.state === "error" || run.consecutiveFailures > 0 ? "danger" as const : "warning" as const,
        title: run.state === "error" ? `${run.name} 需要處理`
          : riskUsage !== null && riskUsage >= 80 ? `${run.name} 曝險接近上限`
            : `${run.name} 出現執行失敗`,
        body: run.state === "error"
          ? "策略已進入安全停止狀態，等待你確認執行證據。"
          : riskUsage !== null && riskUsage >= 80
            ? `目前已使用 ${riskUsage.toFixed(0)}% 的策略曝險額度。`
            : `Executor 已記錄 ${run.consecutiveFailures} 次連續失敗。`,
        safe: run.state === "error" ? "已停止新增交易，現有部位仍受既定風控管理。"
          : "風控守門仍在每次評估與送單前生效。",
        href: `/runs/${encodeURIComponent(run.id)}`,
        action: "查看詳情",
      })),
    ].slice(0, 2);
    return {
      positions,
      allocations,
      allocationTotal,
      donutStyle: gradient ? { background: `conic-gradient(${gradient})` } as CSSProperties : undefined,
      todayRealized: todayPoint?.netPnl ?? "0",
      todayTradeCount: todayPoint?.tradeCount ?? 0,
      runningCount: payload.runs.filter((run) => run.state === "running").length,
      rows,
      attentionRows,
      alerts,
      recentRuns: [...payload.runs]
        .sort((left, right) => (right.lastEvaluatedAt ?? 0) - (left.lastEvaluatedAt ?? 0))
        .slice(0, 3),
    };
  }, [payload]);

  const amount = (value: string | number | null, options?: { signed?: boolean; asset?: string }) => {
    const parsed = finite(value);
    if (parsed === null) return "等待快照";
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(parsed);
    return `${options?.signed && parsed >= 0 ? "+" : ""}${formatted} ${options?.asset ?? "USDT"}`;
  };
  const dateOnly = (value: number) => {
    const parts = taipeiParts(value);
    return `${parts.year}/${parts.month}/${parts.day}`;
  };
  const timeOnly = (value: number) => {
    const parts = taipeiParts(value);
    return `${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const dateTime = (value: number) => `${dateOnly(value)} ${timeOnly(value)}`;
  const connected = payload.account?.connectionStatus === "active";
  const synchronized = connected && payload.account?.syncStatus === "ready"
    && payload.account.observedAt !== null;
  const systemNeedsAttention = dashboard.attentionRows.length > 0 || Boolean(payload.account?.lastErrorCode);
  const visibleRows = dashboard.rows.filter(({ run, attention }) =>
    filter === "all" || (filter === "running" && run.state === "running")
      || (filter === "attention" && attention));

  if (state === "unauthorized") {
    return <section className="control-center-gate glass-panel" aria-labelledby="control-center-auth-title">
      <FiShield aria-hidden="true" />
      <div><p className="eyebrow">SECURE ACCOUNT ACCESS</p><h2 id="control-center-auth-title">登入後查看你的交易控制中心</h2>
        <p>登入後可查看 WEEX 帳戶權益、運行策略、持倉與異常處理；登入前不顯示真倉操作表單。</p></div>
      <Link className="button button--primary" href="/auth?return_to=%2Fruns">登入控制中心</Link>
    </section>;
  }

  if (state === "loading") {
    return <section className="control-center-loading glass-panel" aria-live="polite">
      <FiRefreshCw aria-hidden="true" />
      <div><strong>正在建立安全快照</strong><span>同步 WEEX 帳戶與 AWS Executor 執行證據…</span></div>
    </section>;
  }

  if (state === "error") {
    return <section className="control-center-gate glass-panel" role="alert">
      <FiAlertTriangle aria-hidden="true" />
      <div><p className="eyebrow">SYNC INTERRUPTED</p><h2>目前無法載入控制中心</h2>
        <p>沒有任何資料被覆寫。請重新嘗試同步最新帳戶與策略狀態。</p></div>
      <button className="button button--secondary" onClick={() => void load()} type="button">重新同步</button>
    </section>;
  }

  return <section className="control-center-dashboard" aria-label="WEEX 策略控制中心">
    <div className="control-center-health glass-panel" aria-label="系統健康狀態">
      <div data-tone={connected ? "healthy" : "warning"}>
        {connected ? <FiCheckCircle aria-hidden="true" /> : <FiAlertTriangle aria-hidden="true" />}
        <span><strong>{connected ? "WEEX 已連線" : "WEEX 尚未連線"}</strong>
          <small>{connected ? "交易權限已驗證" : "完成綁定後同步帳戶"}</small></span>
      </div>
      <div data-tone={synchronized ? "healthy" : "warning"}>
        <FiCloud aria-hidden="true" />
        <span><strong>{synchronized ? "AWS Executor 正常" : "AWS Executor 同步中"}</strong>
          <small>{synchronized ? "帳戶快照持續更新" : "等待最新帳戶快照"}</small></span>
      </div>
      <div data-tone={systemNeedsAttention ? "warning" : "healthy"}>
        <FiShield aria-hidden="true" />
        <span><strong>{systemNeedsAttention ? "風控有待處理項目" : "風控守門啟用"}</strong>
          <small>{systemNeedsAttention ? `${dashboard.attentionRows.length} 個策略需留意` : "送單前自動複核"}</small></span>
      </div>
      <div data-tone="neutral">
        <FiClock aria-hidden="true" />
        <span><strong>最後同步</strong><small>{payload.account?.observedAt
          ? timeOnly(payload.account.observedAt) : lastRefreshedAt ? timeOnly(lastRefreshedAt) : "等待首次同步"}</small></span>
        {autoRefresh && <button aria-label="立即更新控制中心" onClick={() => void load(false)} type="button">
          <FiRefreshCw aria-hidden="true" />
        </button>}
      </div>
    </div>

    {!connected && <div className="control-center-connection glass-panel">
      <div><FiShield aria-hidden="true" /><span><strong>先完成 WEEX 安全連線</strong>
        <small>控制中心會在連線後自動顯示帳戶權益、持倉與策略執行證據。</small></span></div>
      <Link className="button button--primary button--small" href="/connections">連接 WEEX API</Link>
    </div>}

    <dl className="control-center-kpis glass-panel" aria-label="帳戶與策略摘要">
      <div><dt>總權益</dt><dd data-tone={synchronized ? undefined : "muted"}>
        {amount(payload.account?.accountEquity ?? null)}</dd><small>WEEX 最新帳戶快照</small></div>
      <div><dt>今日已實現</dt><dd data-tone={(finite(dashboard.todayRealized) ?? 0) >= 0 ? "positive" : "negative"}>
        {amount(dashboard.todayRealized, { signed: true, asset: payload.realizedPnl.asset })}</dd>
        <small>{dashboard.todayTradeCount ? `${dashboard.todayTradeCount} 筆今日成交` : "今日尚無已實現成交"}</small></div>
      <div><dt>未實現損益</dt><dd data-tone={(finite(payload.account?.unrealizedPnl) ?? 0) >= 0 ? "positive" : "negative"}>
        {amount(payload.account?.unrealizedPnl ?? null, { signed: true })}</dd>
        <small>{dashboard.positions.length} 個帳戶持倉</small></div>
      <div><dt>運行中策略</dt><dd>{dashboard.runningCount}<span> / {payload.runs.length}</span></dd>
        <small>{dashboard.attentionRows.length ? `${dashboard.attentionRows.length} 個需注意` : "全部狀態正常"}</small></div>
    </dl>

    <div className="control-center-main">
      <section className="control-center-runs glass-panel" aria-labelledby="control-center-runs-title">
        <header>
          <div><FiActivity aria-hidden="true" /><h2 id="control-center-runs-title">運行中的策略</h2></div>
          <div className="control-center-filters" aria-label="篩選策略">
            {([
              ["all", "全部"],
              ["running", "運行中"],
              ["attention", "需注意"],
            ] as const).map(([value, label]) => <button aria-pressed={filter === value}
              key={value} onClick={() => setFilter(value)} type="button">{label}</button>)}
          </div>
        </header>
        {visibleRows.length === 0 ? <div className="control-center-empty">
          <FiTrendingUp aria-hidden="true" />
          <div><strong>{payload.runs.length ? "沒有符合目前篩選的策略" : "還沒有運行中的策略"}</strong>
            <span>{payload.runs.length ? "切換篩選即可查看其他策略。" : "選擇已驗證策略並設定風控後，即可開始第一個運行。"}</span></div>
          {!payload.runs.length && <Link href="/runs/new">啟動新策略</Link>}
        </div> : <div className="control-center-table-shell">
          <table>
            <thead><tr><th>策略名稱</th><th>市場</th><th>狀態</th><th>未實現損益</th><th>目前持倉</th>
              <th>最近訊號</th><th>最後評估</th><th>曝險使用率</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>{visibleRows.map(({ run, runPositions, unrealizedPnl, riskUsage }) => {
              const action = typeof run.lastSignalJson?.action === "string" ? run.lastSignalJson.action : "等待訊號";
              const primarySymbol = run.allowedSymbols[0] ?? "尚未設定";
              const stateLabel = run.state === "running" ? "運行中" : run.state === "paused" ? "已暫停"
                : run.state === "error" ? "需處理" : "已停止";
              return <tr key={run.id}>
                <th scope="row"><div className="control-run-name"><MarketIcon symbol={primarySymbol} /><span>
                  <Link href={`/runs/${encodeURIComponent(run.id)}`}>{run.name}</Link>
                  <small>{run.evaluationCount} 次評估 · {run.signalCount} 次訊號</small></span></div></th>
                <td data-label="市場"><strong>{primarySymbol}</strong><small>WEEX / USDT</small></td>
                <td data-label="狀態"><span className="control-run-state" data-state={run.state}>
                  {run.state === "running" ? <FiPlayCircle aria-hidden="true" /> : run.state === "paused"
                    ? <FiPauseCircle aria-hidden="true" /> : <FiAlertTriangle aria-hidden="true" />}{stateLabel}</span>
                  {run.consecutiveFailures > 0 && <small>{run.consecutiveFailures} 次失敗</small>}</td>
                <td data-label="未實現損益" data-tone={unrealizedPnl >= 0 ? "positive" : "negative"}>
                  <strong>{runPositions.length ? amount(unrealizedPnl, { signed: true }) : "—"}</strong>
                  <small>{runPositions.length ? "帳戶快照" : "目前無持倉"}</small></td>
                <td data-label="目前持倉"><strong>{runPositions.length === 1
                  ? `${runPositions[0]!.size} ${baseAsset(runPositions[0]!.symbol)}`
                  : runPositions.length ? `${runPositions.length} 個部位` : "無持倉"}</strong>
                  <small>{runPositions[0] ? `${runPositions[0].side === "long" ? "做多" : "做空"} · ${runPositions[0].leverage}×` : "等待下一次訊號"}</small></td>
                <td data-label="最近訊號"><strong>{action}</strong><small>{run.lastEvaluatedAt
                  ? timeOnly(run.lastEvaluatedAt) : "尚未首次評估"}</small></td>
                <td data-label="最後評估"><strong>{run.lastEvaluatedAt ? timeOnly(run.lastEvaluatedAt) : "—"}</strong>
                  <small>{run.lastEvaluatedAt ? dateOnly(run.lastEvaluatedAt) : "等待中"}</small></td>
                <td data-label="曝險使用率">{riskUsage === null ? <span className="risk-usage-empty">等待上限</span>
                  : <><strong>{riskUsage.toFixed(0)}%</strong><meter high={80} max={100} min={0}
                    optimum={35} value={riskUsage}>{riskUsage.toFixed(0)}%</meter></>}</td>
                <td data-label="操作"><Link aria-label={`查看 ${run.name}`} className="control-run-link"
                  href={`/runs/${encodeURIComponent(run.id)}`}><FiEye aria-hidden="true" /><span>查看</span></Link></td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        {payload.runs.length > 0 && <footer><Link href="/runs/history">查看全部運行紀錄</Link></footer>}
      </section>

      <aside className="control-center-alerts glass-panel" aria-labelledby="control-center-alerts-title">
        <header><div><FiAlertTriangle aria-hidden="true" /><h2 id="control-center-alerts-title">需要處理</h2></div>
          <span>{dashboard.alerts.length}</span></header>
        {dashboard.alerts.length ? <ol>{dashboard.alerts.map((alert) => <li data-tone={alert.tone} key={alert.id}>
          <div><span>{alert.tone === "danger" ? <FiAlertTriangle aria-hidden="true" /> : <FiShield aria-hidden="true" />}</span>
            <strong>{alert.title}</strong></div>
          <p>{alert.body}</p><small>{alert.safe}</small>
          <Link href={alert.href}>{alert.action}</Link>
        </li>)}</ol> : <div className="control-center-alerts__clear">
          <FiCheckCircle aria-hidden="true" /><strong>目前無需處理</strong>
          <span>連線、風控與運行策略皆未回報異常。</span>
        </div>}
      </aside>
    </div>

    <div className="control-center-support">
      <section className="control-center-allocation glass-panel" aria-labelledby="control-center-allocation-title">
        <header><h2 id="control-center-allocation-title">投資組合配置</h2><span>{dashboard.allocations.length} 項資產</span></header>
        {dashboard.allocations.length ? <div>
          <div className="asset-donut" data-has-data="true" style={dashboard.donutStyle} role="img"
            aria-label={dashboard.allocations.map(({ balance, value }) =>
              `${balance.asset} ${(value / dashboard.allocationTotal * 100).toFixed(1)}%`).join("、")}>
            <div><strong>{amount(payload.account?.accountEquity ?? null).replace(" USDT", "")}</strong><span>總權益</span></div>
          </div>
          <dl>{dashboard.allocations.slice(0, 5).map(({ balance, value }, index) => <div key={balance.asset}>
            <dt><i aria-hidden="true" style={{ background: COLORS[index % COLORS.length] }} />{balance.asset}</dt>
            <dd>{amount(balance.total, { asset: balance.asset })}<small>
              {(value / dashboard.allocationTotal * 100).toFixed(1)}%</small></dd>
          </div>)}</dl>
        </div> : <div className="control-center-inline-empty">等待 Executor 回傳資產配置。</div>}
      </section>

      <section className="control-center-executions glass-panel" aria-labelledby="control-center-executions-title">
        <header><h2 id="control-center-executions-title">最近執行證據</h2><Link href="/activity">查看完整紀錄</Link></header>
        {dashboard.recentRuns.length ? <ol>{dashboard.recentRuns.map((run) => {
          const action = typeof run.lastSignalJson?.action === "string" ? run.lastSignalJson.action : "完成策略評估";
          return <li key={run.id}><MarketIcon symbol={run.allowedSymbols[0] ?? ""} /><div><strong>{run.name}</strong>
            <span>{action} · {run.allowedSymbols.join("、") || "等待交易市場"}</span></div>
            <time dateTime={run.lastEvaluatedAt ? new Date(run.lastEvaluatedAt).toISOString() : undefined}>
              {run.lastEvaluatedAt ? timeOnly(run.lastEvaluatedAt) : "等待首次評估"}</time>
            <span data-state={run.state}>{run.state === "running" ? "已評估" : run.state === "paused" ? "已暫停" : "需注意"}</span></li>;
        })}</ol> : <div className="control-center-inline-empty">啟動策略後，評估與訊號證據會顯示在這裡。</div>}
      </section>
    </div>

    <footer className="control-center-source"><span>資料來源：固定 IP AWS Executor 的 WEEX 私有帳戶查詢；頁面不含 API 密鑰。</span>
      <span>{payload.account?.observedAt ? `最後可信快照 ${dateTime(payload.account.observedAt)}`
        : "等待 Executor 首次帳戶快照"}</span></footer>
  </section>;
}
