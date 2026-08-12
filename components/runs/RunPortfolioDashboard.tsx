"use client";

import type { CSSProperties, TouchEvent as ReactTouchEvent } from "react";
import Link from "next/link";
import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import {
  FiActivity,
  FiAlertTriangle,
  FiBarChart2,
  FiBookOpen,
  FiCheckCircle,
  FiClock,
  FiCloud,
  FiCode,
  FiEdit3,
  FiEye,
  FiLink,
  FiList,
  FiPauseCircle,
  FiPlayCircle,
  FiPlusCircle,
  FiRefreshCw,
  FiSearch,
  FiShield,
  FiTrendingUp,
} from "react-icons/fi";
import { SiBitcoin, SiEthereum, SiSolana } from "react-icons/si";
import { useI18n } from "@/components/I18nProvider";
import { ControlCenterJourney } from "./ControlCenterJourney";
import { attributeCloudPositions } from "./cloudPositionAttribution";
import { exactDecimalSign, exactPercent, formatExactDecimal, sumExactDecimals } from "./exactDecimal";
import { CLOUD_RUNS_REFRESH_EVENT } from "./events";
import { useAdaptiveRefresh } from "./useAdaptiveRefresh";

type LoadState = "loading" | "ready" | "error" | "unauthorized";
type RunState = "running" | "paused" | "stopped" | "error";
type RunFilter = "all" | "running" | "attention";
type RunSort = "attention" | "recent" | "name" | "exposure";
type RunViewMode = "guided" | "professional" | "quant";

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
  mode: "futures-demo" | "live";
  state: RunState;
  market: "spot" | "futures";
  symbol: string;
  allowedSymbols: string[];
  evaluationCount: number;
  signalCount: number;
  lastEvaluatedAt: number | null;
  lastSignalJson: Record<string, unknown> | null;
  lastErrorCode: string | null;
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
  positionSnapshotAvailable?: boolean;
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
const CLOUD_SYMBOL = /^[A-Z0-9_]{3,32}$/;
const RUN_FILTERS: readonly { label: string; value: RunFilter }[] = [
  { value: "all", label: "全部" },
  { value: "running", label: "運行中" },
  { value: "attention", label: "需注意" },
];

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

export const parseDashboard = (value: unknown): DashboardPayload | null => {
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
      || (run.mode !== "futures-demo" && run.mode !== "live")
      || !["running", "paused", "stopped", "error"].includes(String(run.state))
      || (run.market !== "spot" && run.market !== "futures")
      || typeof run.symbol !== "string" || !CLOUD_SYMBOL.test(run.symbol)
      || !Array.isArray(run.allowedSymbols) || run.allowedSymbols.some((symbol) => typeof symbol !== "string")
      || !Number.isSafeInteger(run.evaluationCount) || !Number.isSafeInteger(run.signalCount)
      || !(run.lastErrorCode === null || typeof run.lastErrorCode === "string")
      || !Number.isSafeInteger(run.consecutiveFailures)) return null;
    runs.push({
      id: run.id,
      name: run.name,
      mode: run.mode,
      state: run.state as RunState,
      market: run.market,
      symbol: run.symbol,
      allowedSymbols: run.allowedSymbols as string[],
      evaluationCount: run.evaluationCount as number,
      signalCount: run.signalCount as number,
      lastEvaluatedAt: Number.isSafeInteger(run.lastEvaluatedAt) ? run.lastEvaluatedAt as number : null,
      lastSignalJson: rawSignal && typeof rawSignal === "object" && !Array.isArray(rawSignal)
        ? rawSignal as Record<string, unknown> : null,
      lastErrorCode: run.lastErrorCode,
      consecutiveFailures: run.consecutiveFailures as number,
      maxTotalExposure: typeof run.maxTotalExposure === "string" ? run.maxTotalExposure : null,
      maxDailyLoss: typeof run.maxDailyLoss === "string" ? run.maxDailyLoss : null,
    });
  }
  let account: CloudAccount | null = null;
  if (root.account !== null) {
    if (!root.account || typeof root.account !== "object" || Array.isArray(root.account)) return null;
    const row = root.account as Record<string, unknown>;
    const snapshotMissing = row.balancesJson === null || row.positionsJson === null;
    const balances = row.balancesJson === null ? [] : jsonArray(row.balancesJson);
    const positions = row.positionsJson === null ? [] : jsonArray(row.positionsJson);
    if (!["active", "pending", "processing", "reauthorization_required", "revoked", "error"]
      .includes(String(row.connectionStatus))
      || !(row.syncStatus === null || ["pending", "ready", "error"].includes(String(row.syncStatus)))
      || (row.syncStatus === "ready" && snapshotMissing)
      || !balances || !balances.every(validBalance) || !positions || !positions.every(validPosition)) return null;
    account = {
      connectionStatus: row.connectionStatus as CloudAccount["connectionStatus"],
      syncStatus: row.syncStatus as CloudAccount["syncStatus"],
      accountUid: typeof row.accountUid === "string" ? row.accountUid : null,
      observedAt: Number.isSafeInteger(row.observedAt) ? row.observedAt as number : null,
      balances,
      positions,
      positionSnapshotAvailable: row.positionsJson !== null,
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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<RunSort>("attention");
  const [viewMode, setViewMode] = useState<RunViewMode>("professional");
  const [gestureAnnouncement, setGestureAnnouncement] = useState("");
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const gestureStart = useRef<{ x: number; y: number } | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase(locale));

  const startFilterSwipe = (event: ReactTouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1
      || (event.target as HTMLElement).closest("a, button, input, select, textarea, summary")) {
      gestureStart.current = null;
      return;
    }
    const touch = event.touches[0];
    gestureStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const finishFilterSwipe = (event: ReactTouchEvent<HTMLElement>) => {
    const start = gestureStart.current;
    gestureStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const horizontal = touch.clientX - start.x;
    const vertical = touch.clientY - start.y;
    if (Math.abs(horizontal) < 56 || Math.abs(horizontal) <= Math.abs(vertical) * 1.35) return;
    const current = RUN_FILTERS.findIndex(({ value }) => value === filter);
    const direction = horizontal < 0 ? 1 : -1;
    const next = RUN_FILTERS[(current + direction + RUN_FILTERS.length) % RUN_FILTERS.length]!;
    setFilter(next.value);
    setGestureAnnouncement(`已切換為${next.label}策略`);
  };

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
    const hasPositionSnapshot = payload.account !== null
      && payload.account.positionSnapshotAvailable !== false;
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
    const ambiguousSymbols = new Set(payload.runs.filter((run) => run.mode === "live"
      && run.state !== "stopped" && run.market === "futures"
      && attributeCloudPositions(payload.runs, run, positions).attribution === "ambiguous")
      .map((run) => run.symbol));
    const rows = payload.runs.map((run) => {
      const attributed = attributeCloudPositions(payload.runs, run, positions);
      const positionAttribution = attributed.attribution;
      const runPositions = attributed.positions;
      const exposure = positionAttribution !== "unique" || !hasPositionSnapshot ? null
        : sumExactDecimals(runPositions.map((position) => position.openValue));
      const unrealizedPnl = positionAttribution !== "unique" || !hasPositionSnapshot ? null
        : sumExactDecimals(runPositions.map((position) => position.unrealizedPnl));
      const riskUsage = exposure !== null && run.maxTotalExposure !== null
        ? exactPercent(exposure, run.maxTotalExposure) : null;
      const exposureEvidenceInvalid = positionAttribution === "unique" && hasPositionSnapshot
        && exposure === null;
      const attention = run.state === "error" || run.consecutiveFailures > 0
        || positionAttribution === "unmanaged" || positionAttribution === "ambiguous"
        || (riskUsage !== null && riskUsage >= 80);
      return { run, runPositions, exposure, unrealizedPnl, riskUsage, attention,
        positionAttribution, exposureEvidenceInvalid };
    });
    const attentionRows = rows.filter(({ attention }) => attention);
    const allAlerts = [
      ...(payload.account?.lastErrorCode ? [{
        id: "account-sync",
        tone: "warning" as const,
        title: "帳戶同步需要注意",
        body: "Executor 暫時無法取得最新帳戶快照，已保留上一筆可信資料。",
        safe: "系統不會在帳戶狀態不明時擴大曝險。",
        href: "/connections",
        action: "檢查連線",
      }] : []),
      ...(ambiguousSymbols.size ? [{
        id: "shared-market-attribution",
        tone: "warning" as const,
        title: "重複交易目標無法安全對應",
        body: `${ambiguousSymbols.size} 個合約交易目標同時對應多個未停止運行；即使目前空倉，控制台仍維持不可歸屬。`,
        safe: "帳戶總權益與帳戶未實現損益仍使用 WEEX 快照；個別運行欄位維持不可歸屬。",
        href: "/activity",
        action: "核對執行紀錄",
      }] : []),
      ...attentionRows.map(({ run, riskUsage, positionAttribution }) => ({
        id: run.id,
        tone: run.state === "error" || run.consecutiveFailures > 0 ? "danger" as const : "warning" as const,
        title: positionAttribution === "ambiguous" ? `${run.name} 交易目標重複`
          : positionAttribution === "unmanaged" ? `${run.name} 部位需要人工核對`
          : run.state === "error" ? `${run.name} 需要處理`
          : riskUsage !== null && riskUsage >= 80 ? `${run.name} 曝險接近上限`
            : `${run.name} 出現執行失敗`,
        body: positionAttribution === "ambiguous"
          ? "同一合約交易目標存在多個未停止運行，帳戶部位與損益不可安全對應。"
          : positionAttribution === "unmanaged"
          ? "Executor 偵測到啟動前或手動部位，未將帳戶部位與損益歸屬到此運行。"
          : run.state === "error"
          ? "策略已進入安全停止狀態，等待你確認執行證據。"
          : riskUsage !== null && riskUsage >= 80
            ? `目前已使用 ${riskUsage.toFixed(0)}% 的策略曝險額度。`
            : `Executor 已記錄 ${run.consecutiveFailures} 次連續失敗。`,
        safe: positionAttribution === "ambiguous" ? "請停止重複運行並核對執行紀錄。"
          : positionAttribution === "unmanaged" ? "請先核對交易所部位與執行紀錄，再決定後續處置。"
          : run.state === "error" ? "已停止新增交易，現有部位仍受既定風控管理。"
          : "風控守門仍在每次評估與送單前生效。",
        href: `/runs/${encodeURIComponent(run.id)}`,
        action: "查看詳情",
      })),
    ];
    const alerts = allAlerts.toSorted((left, right) => (
      left.tone === right.tone ? 0 : left.tone === "danger" ? -1 : 1
    ));
    return {
      positions,
      allocations,
      allocationTotal,
      donutStyle: gradient ? { background: `conic-gradient(${gradient})` } as CSSProperties : undefined,
      todayRealized: todayPoint?.netPnl ?? null,
      todayTradeCount: todayPoint?.tradeCount ?? 0,
      runningCount: payload.runs.filter((run) => run.state === "running").length,
      hasPositionSnapshot,
      ambiguousTargetCount: ambiguousSymbols.size,
      rows,
      attentionRows,
      alerts,
      totalAlertCount: allAlerts.length,
      recentRuns: [...payload.runs]
        .sort((left, right) => (right.lastEvaluatedAt ?? 0) - (left.lastEvaluatedAt ?? 0))
        .slice(0, 3),
    };
  }, [payload]);

  const amount = (value: string | null, options?: { signed?: boolean; asset?: string }) => {
    if (value === null) return "等待快照";
    const formatted = formatExactDecimal(value, locale, { signed: options?.signed });
    return formatted === null ? "尚無可信證據" : `${formatted} ${options?.asset ?? "USDT"}`;
  };
  const todayRealizedSign = exactDecimalSign(dashboard.todayRealized);
  const accountUnrealizedSign = exactDecimalSign(payload.account?.unrealizedPnl ?? null);
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
  const connectionCopy = (() => {
    switch (payload.account?.connectionStatus) {
      case "active": return { title: "WEEX 已連線", detail: "交易權限已驗證" };
      case "pending":
      case "processing": return { title: "WEEX 連線驗證中", detail: "尚未取得可用交易權限" };
      case "reauthorization_required": return { title: "WEEX 需要重新授權", detail: "重新驗證後才能同步交易" };
      case "revoked": return { title: "WEEX 授權已撤銷", detail: "目前不會建立新交易" };
      case "error": return { title: "WEEX 連線異常", detail: "請檢查 API 權限與白名單" };
      default: return { title: "WEEX 尚未連線", detail: "完成綁定後同步帳戶" };
    }
  })();
  const syncCopy = synchronized
    ? { title: "AWS Executor 正常", detail: "帳戶快照持續更新" }
    : payload.account?.syncStatus === "error"
      ? { title: "AWS Executor 同步失敗", detail: "保留上一筆可信帳戶快照" }
      : { title: "AWS Executor 同步中", detail: "等待最新帳戶快照" };
  const systemNeedsAttention = dashboard.attentionRows.length > 0 || dashboard.ambiguousTargetCount > 0
    || Boolean(payload.account?.lastErrorCode);
  const visibleRows = dashboard.rows
    .filter(({ run, attention }) => (
      filter === "all" || (filter === "running" && run.state === "running")
        || (filter === "attention" && attention)
    ) && (!deferredQuery || `${run.name} ${run.market} ${run.symbol} ${run.allowedSymbols.join(" ")} ${run.state}`
      .toLocaleLowerCase(locale).includes(deferredQuery)))
    .sort((left, right) => {
      if (sort === "name") return left.run.name.localeCompare(right.run.name, locale);
      if (sort === "recent") return (right.run.lastEvaluatedAt ?? 0) - (left.run.lastEvaluatedAt ?? 0);
      if (sort === "exposure") {
        if (left.riskUsage === null) return right.riskUsage === null ? 0 : 1;
        if (right.riskUsage === null) return -1;
        return right.riskUsage - left.riskUsage;
      }
      return Number(right.attention) - Number(left.attention)
        || (right.run.lastEvaluatedAt ?? 0) - (left.run.lastEvaluatedAt ?? 0);
    });
  const viewModeDescription = viewMode === "guided"
    ? "以白話狀態與下一步為主，進階執行欄位暫時收起。"
    : viewMode === "quant"
      ? "顯示評估、訊號、失敗次數與曝險證據，方便核對程序行為。"
      : "同時顯示帳戶損益、持倉、最近訊號與風控使用率。";
  const visibleAlerts = showAllAlerts ? dashboard.alerts : dashboard.alerts.slice(0, 2);

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
    <section className="control-center-commandbar glass-panel" aria-labelledby="control-center-view-title">
      <div className="control-center-view-selector">
        <div><span className="eyebrow">閱讀層次</span><h2 id="control-center-view-title">選擇你的監控層次</h2></div>
        <div aria-describedby="control-center-view-description" aria-label="監控層次" role="group">
          {([
            ["guided", "新手導覽", FiBookOpen],
            ["professional", "專業監控", FiBarChart2],
            ["quant", "量化證據", FiCode],
          ] as const).map(([value, label, Icon]) => <button aria-pressed={viewMode === value}
            className="button button--ghost button--small" key={value} onClick={() => setViewMode(value)} type="button">
            <Icon aria-hidden="true" />{label}
          </button>)}
        </div>
        <p id="control-center-view-description">{viewModeDescription}</p>
      </div>
      <nav aria-label="控制中心快速操作" className="control-center-quick-actions">
        <Link className="button button--ghost button--small" href="/workshop"><FiEdit3 aria-hidden="true" />組裝策略</Link>
        <Link className="button button--ghost button--small" href="/runs/new"><FiPlusCircle aria-hidden="true" />啟動策略</Link>
        <Link className="button button--ghost button--small" href="/activity"><FiList aria-hidden="true" />執行紀錄</Link>
        <Link className="button button--ghost button--small" href="/connections"><FiLink aria-hidden="true" />連線設定</Link>
      </nav>
    </section>

    <div className="control-center-health glass-panel" aria-label="系統健康狀態">
      <div data-tone={connected ? "healthy" : "warning"}>
        {connected ? <FiCheckCircle aria-hidden="true" /> : <FiAlertTriangle aria-hidden="true" />}
        <span><strong>{connectionCopy.title}</strong><small>{connectionCopy.detail}</small></span>
      </div>
      <div data-tone={synchronized ? "healthy" : "warning"}>
        <FiCloud aria-hidden="true" />
        <span><strong>{syncCopy.title}</strong><small>{syncCopy.detail}</small></span>
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
        {autoRefresh && <button aria-label="立即更新控制中心" onClick={() => void load(false)}
          style={{ minHeight: "2.75rem", minWidth: "2.75rem" }} type="button">
          <FiRefreshCw aria-hidden="true" />
        </button>}
      </div>
    </div>

    {!connected && <div className="control-center-connection glass-panel">
      <div><FiShield aria-hidden="true" /><span><strong>先完成 WEEX 安全連線</strong>
        <small>控制中心會在連線後自動顯示帳戶權益、持倉與策略執行證據。</small></span></div>
      <Link className="button button--primary button--small" href="/connections">
        {payload.account ? "檢查 WEEX 連線" : "連接 WEEX API"}
      </Link>
    </div>}

    {payload.runs.length === 0 && <ControlCenterJourney connected={connected}
      connectionStatus={payload.account?.connectionStatus ?? null}
      loadOwnedPublications={autoRefresh} runCount={payload.runs.length} synchronized={synchronized} />}

    <dl className="control-center-kpis glass-panel" aria-label="帳戶與策略摘要">
      <div><dt>總權益</dt><dd data-tone={synchronized ? undefined : "muted"}>
        {amount(payload.account?.accountEquity ?? null)}</dd><small>WEEX 最新帳戶快照</small></div>
      <div><dt>今日已實現</dt><dd data-tone={todayRealizedSign === null ? "muted"
        : todayRealizedSign >= 0 ? "positive" : "negative"}>
        {amount(dashboard.todayRealized, { signed: true, asset: payload.realizedPnl.asset })}</dd>
        <small>{dashboard.todayRealized === null ? "尚無可信今日成交快照"
          : dashboard.todayTradeCount ? `${dashboard.todayTradeCount} 筆今日成交` : "今日尚無已實現成交"}</small></div>
      <div><dt>未實現損益</dt><dd data-tone={accountUnrealizedSign === null
        ? "muted" : accountUnrealizedSign >= 0 ? "positive" : "negative"}>
        {amount(payload.account?.unrealizedPnl ?? null, { signed: true })}</dd>
        <small>{dashboard.hasPositionSnapshot ? `${dashboard.positions.length} 個帳戶持倉` : "等待帳戶部位快照"}</small></div>
      <div><dt>運行中策略</dt><dd>{dashboard.runningCount}<span> / {payload.runs.length}</span></dd>
        <small>{payload.runs.length === 0 ? "尚未啟動策略" : dashboard.attentionRows.length
          ? `${dashboard.attentionRows.length} 個需注意` : "全部狀態正常"}</small></div>
    </dl>

    <div className="control-center-main">
      <section aria-describedby="control-center-gesture-hint control-center-gesture-status"
        className="control-center-runs glass-panel" aria-labelledby="control-center-runs-title">
        <p className="sr-only" id="control-center-gesture-hint">觸控裝置可在策略監控標題列左右滑動，快速切換策略篩選；表格仍可水平與垂直捲動。</p>
        <p aria-live="polite" className="sr-only" id="control-center-gesture-status">{gestureAnnouncement}</p>
        <header aria-label="滑動切換策略篩選" onTouchEnd={finishFilterSwipe}
          onTouchStart={startFilterSwipe} role="group" style={{ minHeight: "2.75rem", touchAction: "pan-y" }}>
          <div><FiActivity aria-hidden="true" /><h2 id="control-center-runs-title">策略監控</h2></div>
          <div className="control-center-filters" aria-label="篩選策略">
            {RUN_FILTERS.map(({ value, label }) => <button aria-pressed={filter === value}
              key={value} onClick={() => setFilter(value)} style={{ minHeight: "2.75rem" }} type="button">{label}</button>)}
          </div>
        </header>
        {payload.runs.length > 0 && <div className="control-center-run-tools">
          <label className="control-center-run-search">
            <FiSearch aria-hidden="true" />
            <span className="sr-only">搜尋策略名稱或市場</span>
            <input autoComplete="off" onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋策略或市場" style={{ minHeight: "2.75rem" }} type="search" value={query} />
          </label>
          <label className="control-center-run-sort"><span>排序</span>
            <select onChange={(event) => setSort(event.target.value as RunSort)}
              style={{ minHeight: "2.75rem" }} value={sort}>
              <option value="attention">需注意優先</option>
              <option value="recent">最近評估</option>
              <option value="exposure">曝險使用率</option>
              <option value="name">名稱 A–Z</option>
            </select>
          </label>
          <span aria-live="polite" className="control-center-run-result">顯示 {visibleRows.length} / {payload.runs.length} 個策略</span>
        </div>}
        {visibleRows.length === 0 ? <div className="control-center-empty">
          <FiTrendingUp aria-hidden="true" />
          <div><strong>{payload.runs.length ? "沒有符合搜尋或篩選的策略" : "還沒有運行中的策略"}</strong>
            <span>{payload.runs.length ? "清除搜尋或切換篩選，即可查看其他策略。" : "上方引導會依連線與同步狀態顯示安全的下一步。"}</span></div>
          {!payload.runs.length && <Link className="button button--ghost button--small" href="/runs/new">啟動新策略</Link>}
        </div> : <div className="control-center-table-shell">
          <table>
            <thead><tr><th>策略名稱</th>{viewMode !== "guided" && <th>市場</th>}<th>狀態</th><th>目標部位損益</th>
              {viewMode !== "guided" && <th>目標部位</th>}{viewMode !== "guided" && <th>最近訊號</th>}
              {viewMode === "professional" && <th>最後評估</th>}
              {viewMode === "quant" && <><th>評估 / 訊號</th><th>連續失敗</th><th>最後評估</th></>}
              <th>曝險使用率</th>{viewMode === "guided" && <th>建議下一步</th>}
              <th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>{visibleRows.map(({ run, runPositions, unrealizedPnl, riskUsage,
              positionAttribution, exposureEvidenceInvalid }) => {
              const action = typeof run.lastSignalJson?.action === "string" ? run.lastSignalJson.action : "等待訊號";
              const unrealizedPnlSign = exactDecimalSign(unrealizedPnl);
              const primarySymbol = run.symbol;
              const stateLabel = run.state === "running" ? "運行中" : run.state === "paused" ? "已暫停"
                : run.state === "error" ? "需處理" : "已停止";
              const attributionDetail = positionAttribution === "ambiguous" ? "多個運行共用相同合約交易目標"
                : positionAttribution === "unmanaged" ? "帳戶部位狀態未受此運行管理"
                  : run.mode !== "live" ? "模擬運行不歸屬實盤帳戶部位"
                : run.state === "stopped" ? "已停止，不歸屬目前合約部位"
                  : run.market === "spot" ? "現貨策略不歸屬合約部位"
                    : !dashboard.hasPositionSnapshot ? "等待帳戶部位快照" : "目前無持倉";
              const nextAction = run.state === "error" || run.consecutiveFailures > 0 ? "先查看異常與執行證據"
                : riskUsage !== null && riskUsage >= 80 ? "檢查曝險並評估是否降倉"
                  : run.state === "paused" ? "確認市場與風控後再恢復" : run.state === "stopped"
                    ? "查看歷史或建立新版本" : "持續監控，目前無需操作";
              return <tr key={run.id}>
                <th scope="row"><div className="control-run-name"><MarketIcon symbol={primarySymbol} /><span>
                  <Link href={`/runs/${encodeURIComponent(run.id)}`}
                    style={{ alignItems: "center", display: "inline-flex", minHeight: "2.75rem" }}>{run.name}</Link>
                  <small>{viewMode === "guided" ? `${run.symbol} · ${run.market === "spot" ? "現貨" : "合約"}`
                    : `${run.evaluationCount} 次評估 · ${run.signalCount} 次訊號`}</small></span></div></th>
                {viewMode !== "guided" && <td data-label="市場"><strong>{primarySymbol}</strong>
                  <small>WEEX / {run.market === "spot" ? "現貨" : "合約"}</small></td>}
                <td data-label="狀態"><span className="control-run-state" data-state={run.state}>
                  {run.state === "running" ? <FiPlayCircle aria-hidden="true" /> : run.state === "paused"
                    ? <FiPauseCircle aria-hidden="true" /> : <FiAlertTriangle aria-hidden="true" />}{stateLabel}</span>
                  <small>{run.consecutiveFailures > 0 ? `${run.consecutiveFailures} 次失敗`
                    : viewMode === "guided" ? nextAction : "風控持續生效"}</small></td>
                <td data-label="目標部位損益" data-tone={unrealizedPnlSign === null ? "muted"
                  : unrealizedPnlSign >= 0 ? "positive" : "negative"}>
                  <strong>{positionAttribution === "ambiguous" || positionAttribution === "unmanaged" ? "不可歸屬"
                    : runPositions.length ? unrealizedPnl === null ? "尚無可信證據"
                      : amount(unrealizedPnl, { signed: true }) : "—"}</strong>
                  <small>{runPositions.length ? "帳戶聚合，非 run_id 成交歸屬" : attributionDetail}</small></td>
                {viewMode !== "guided" && <td data-label="目標部位"><strong>{positionAttribution === "ambiguous"
                  || positionAttribution === "unmanaged" ? "不可歸屬"
                  : runPositions.length === 1
                  ? `${runPositions[0]!.size} ${baseAsset(runPositions[0]!.symbol)}`
                  : runPositions.length ? `${runPositions.length} 個部位`
                    : dashboard.hasPositionSnapshot ? "無持倉" : "等待快照"}</strong>
                  <small>{positionAttribution !== "unique" ? attributionDetail
                    : runPositions[0] ? `${runPositions[0].side === "long" ? "做多" : "做空"} · ${runPositions[0].leverage}× · 帳戶聚合`
                      : "帳戶快照無此目標部位"}</small></td>}
                {viewMode !== "guided" && <td data-label="最近訊號"><strong>{action}</strong><small>{run.lastEvaluatedAt
                  ? timeOnly(run.lastEvaluatedAt) : "尚未首次評估"}</small></td>}
                {viewMode === "quant" && <td data-label="評估 / 訊號"><strong>{run.evaluationCount} / {run.signalCount}</strong>
                  <small>Executor 累計證據</small></td>}
                {viewMode === "quant" && <td data-label="連續失敗" data-tone={run.consecutiveFailures > 0 ? "negative" : undefined}>
                  <strong>{run.consecutiveFailures}</strong><small>{run.consecutiveFailures > 0 ? "需核對錯誤" : "未記錄失敗"}</small></td>}
                {viewMode !== "guided" && <td data-label="最後評估"><strong>{run.lastEvaluatedAt ? timeOnly(run.lastEvaluatedAt) : "—"}</strong>
                  <small>{run.lastEvaluatedAt ? dateOnly(run.lastEvaluatedAt) : "等待中"}</small></td>}
                <td data-label="曝險使用率">{positionAttribution === "ambiguous" || positionAttribution === "unmanaged"
                  ? <span className="risk-usage-empty">不可歸屬</span>
                  : positionAttribution === "not-applicable"
                    ? <span className="risk-usage-empty">合約部位不適用</span>
                  : !dashboard.hasPositionSnapshot
                    ? <span className="risk-usage-empty">等待帳戶部位快照</span>
                  : exposureEvidenceInvalid
                    ? <span className="risk-usage-empty">尚無可信曝險證據</span>
                  : riskUsage === null ? <span className="risk-usage-empty">未取得策略上限</span>
                  : <><strong>{riskUsage.toFixed(0)}%</strong><meter high={80} max={100} min={0}
                    optimum={35} value={riskUsage}>{riskUsage.toFixed(0)}%</meter>
                    {viewMode === "quant" && <small>上限 {amount(run.maxTotalExposure)}</small>}</>}</td>
                {viewMode === "guided" && <td data-label="建議下一步"><strong>{nextAction}</strong></td>}
                <td data-label="操作"><Link aria-label={`查看 ${run.name}`} className="control-run-link"
                  href={`/runs/${encodeURIComponent(run.id)}`} style={{ minHeight: "2.75rem" }}>
                  <FiEye aria-hidden="true" /><span>查看</span></Link></td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        {payload.runs.length > 0 && <footer><Link className="button button--ghost button--small"
          href="/runs/history">查看全部運行紀錄</Link></footer>}
      </section>

      <aside className="control-center-alerts glass-panel" aria-labelledby="control-center-alerts-title">
        <header><div><FiAlertTriangle aria-hidden="true" /><h2 id="control-center-alerts-title">需要處理</h2></div>
          <span>{dashboard.totalAlertCount}</span></header>
        {dashboard.alerts.length ? <><ol>{visibleAlerts.map((alert) => <li data-tone={alert.tone} key={alert.id}>
          <div><span>{alert.tone === "danger" ? <FiAlertTriangle aria-hidden="true" /> : <FiShield aria-hidden="true" />}</span>
            <strong>{alert.title}</strong></div>
          <p>{alert.body}</p><small>{alert.safe}</small>
          <Link className="button button--ghost button--small" href={alert.href}>{alert.action}</Link>
        </li>)}</ol>{dashboard.alerts.length > 2 && <button aria-expanded={showAllAlerts}
          className="control-center-alerts__toggle" onClick={() => setShowAllAlerts((current) => !current)} type="button">
          {showAllAlerts ? "收合提醒" : "查看全部提醒"}
        </button>}</> : <div className="control-center-alerts__clear">
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
        <header><h2 id="control-center-executions-title">最近執行證據</h2>
          <Link className="button button--ghost button--small" href="/activity">查看完整紀錄</Link></header>
        {dashboard.recentRuns.length ? <ol>{dashboard.recentRuns.map((run) => {
          const action = typeof run.lastSignalJson?.action === "string" ? run.lastSignalJson.action : "完成策略評估";
          return <li key={run.id}><MarketIcon symbol={run.symbol} /><div><strong>{run.name}</strong>
            <span>{action} · {run.symbol} · {run.market === "spot" ? "現貨" : "合約"}</span></div>
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
