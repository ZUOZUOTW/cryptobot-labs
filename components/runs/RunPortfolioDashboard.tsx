"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/I18nProvider";

type LoadState = "loading" | "ready" | "error" | "unauthorized";
type RunState = "running" | "paused" | "stopped" | "error";

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
  accountAsset: string | null;
  accountObservedAt: number | null;
  accountEquity: string | null;
  availableEquity: string | null;
  unrealizedPnl: string | null;
  positionsJson: CloudPosition[];
  evaluationCount: number;
  signalCount: number;
  lastEvaluatedAt: number | null;
  lastSignalJson: Record<string, unknown> | null;
  consecutiveFailures: number;
}

const finite = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const validPosition = (value: unknown): value is CloudPosition => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.symbol === "string" && (row.side === "long" || row.side === "short")
    && typeof row.leverage === "string" && typeof row.size === "string"
    && typeof row.openValue === "string" && typeof row.unrealizedPnl === "string"
    && Number.isSafeInteger(row.updatedAt);
};
const parseRuns = (value: unknown): CloudRun[] | null => {
  if (!value || typeof value !== "object" || !Array.isArray((value as { runs?: unknown }).runs)) return null;
  const result: CloudRun[] = [];
  for (const candidate of (value as { runs: unknown[] }).runs) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const run = candidate as Record<string, unknown>;
    const rawPositions = typeof run.positionsJson === "string"
      ? (() => { try { return JSON.parse(run.positionsJson) as unknown; } catch { return null; } })()
      : run.positionsJson;
    const rawSignal = typeof run.lastSignalJson === "string"
      ? (() => { try { return JSON.parse(run.lastSignalJson) as unknown; } catch { return null; } })()
      : run.lastSignalJson;
    if (typeof run.id !== "string" || typeof run.name !== "string"
      || !["running", "paused", "stopped", "error"].includes(String(run.state))
      || !Array.isArray(run.allowedSymbols) || run.allowedSymbols.some((symbol) => typeof symbol !== "string")
      || !Array.isArray(rawPositions) || !rawPositions.every(validPosition)
      || !Number.isSafeInteger(run.evaluationCount) || !Number.isSafeInteger(run.signalCount)
      || !Number.isSafeInteger(run.consecutiveFailures)) return null;
    result.push({
      id: run.id,
      name: run.name,
      state: run.state as RunState,
      allowedSymbols: run.allowedSymbols as string[],
      accountAsset: typeof run.accountAsset === "string" ? run.accountAsset : null,
      accountObservedAt: Number.isSafeInteger(run.accountObservedAt) ? run.accountObservedAt as number : null,
      accountEquity: typeof run.accountEquity === "string" ? run.accountEquity : null,
      availableEquity: typeof run.availableEquity === "string" ? run.availableEquity : null,
      unrealizedPnl: typeof run.unrealizedPnl === "string" ? run.unrealizedPnl : null,
      positionsJson: rawPositions,
      evaluationCount: run.evaluationCount as number,
      signalCount: run.signalCount as number,
      lastEvaluatedAt: Number.isSafeInteger(run.lastEvaluatedAt) ? run.lastEvaluatedAt as number : null,
      lastSignalJson: rawSignal && typeof rawSignal === "object" && !Array.isArray(rawSignal)
        ? rawSignal as Record<string, unknown> : null,
      consecutiveFailures: run.consecutiveFailures as number,
    });
  }
  return result;
};

const assetLabel = (symbol: string) => symbol.replace(/[_-]?USDT$/i, " / USDT");

export function RunPortfolioDashboard() {
  const { locale } = useI18n();
  const [runs, setRuns] = useState<CloudRun[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/cloud-runs", { cache: "no-store", headers: { Accept: "application/json" } });
      if (response.status === 401) { setState("unauthorized"); return; }
      const parsed = parseRuns(await response.json());
      if (!response.ok || !parsed) throw new Error("invalid_cloud_portfolio");
      setRuns(parsed);
      setState("ready");
    } catch { setState("error"); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const dashboard = useMemo(() => {
    const snapshotRun = runs.filter((run) => run.accountObservedAt !== null)
      .sort((left, right) => (right.accountObservedAt ?? 0) - (left.accountObservedAt ?? 0))[0] ?? null;
    const assets = new Map<string, { names: Set<string>; running: boolean }>();
    runs.forEach((run) => run.allowedSymbols.forEach((symbol) => {
      const asset = assets.get(symbol) ?? { names: new Set<string>(), running: false };
      asset.names.add(run.name);
      asset.running ||= run.state === "running";
      assets.set(symbol, asset);
    }));
    const positions = snapshotRun?.positionsJson ?? [];
    return {
      snapshotRun,
      positions,
      assets: [...assets.entries()].sort(([left], [right]) => left.localeCompare(right)),
      runningCount: runs.filter((run) => run.state === "running").length,
      evaluations: runs.reduce((sum, run) => sum + run.evaluationCount, 0),
      signals: runs.reduce((sum, run) => sum + run.signalCount, 0),
    };
  }, [runs]);

  const amount = (value: string | null, signed = false) => {
    const number = finite(value);
    if (number === null) return "等待快照";
    const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(number);
    return `${signed && number >= 0 ? "+" : ""}${formatted} ${dashboard.snapshotRun?.accountAsset ?? "USDT"}`;
  };
  const dateTime = (value: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value);
  const unrealized = finite(dashboard.snapshotRun?.unrealizedPnl ?? null);

  return <section className="portfolio-dashboard glass-panel" aria-labelledby="portfolio-dashboard-title">
    <header className="portfolio-dashboard__header">
      <div><p className="eyebrow">ASSETS / CLOUD PERFORMANCE</p><h2 id="portfolio-dashboard-title">交易資產與策略績效</h2>
        <p>直接呈現 AWS Executor 從 WEEX 取得的最新帳戶快照與策略執行證據，不使用瀏覽器或本機代理資料。</p></div>
      {state === "ready" && <button className="button button--ghost button--small" onClick={() => void load()} type="button">重新整理</button>}
    </header>

    <div aria-live="polite">
      {state === "loading" && <p className="runs-empty">正在同步雲端交易資產與績效…</p>}
      {state === "error" && <div className="runs-empty"><p>目前無法載入雲端績效儀表盤。</p>
        <button className="button button--secondary button--small" onClick={() => void load()} type="button">重試載入</button></div>}
      {state === "unauthorized" && <p className="runs-empty">登入狀態已過期。 <Link href="/auth?return_to=%2Fruns">重新登入</Link></p>}
    </div>

    {state === "ready" && runs.length === 0 && <div className="portfolio-dashboard__empty">
      <div><strong>還沒有雲端策略運行</strong><p>綁定 WEEX API 並啟動第一個模擬策略後，真實帳戶快照與運行績效會顯示在這裡。</p></div>
      <Link className="button button--primary button--small" href="/workshop">建立策略</Link>
    </div>}

    {state === "ready" && runs.length > 0 && <>
      <dl className="portfolio-kpis" aria-label="雲端策略績效摘要">
        <div><dt>帳戶權益</dt><dd data-tone={dashboard.snapshotRun ? undefined : "muted"}>{amount(dashboard.snapshotRun?.accountEquity ?? null)}</dd>
          <small>WEEX 最新帳戶快照</small></div>
        <div><dt>可用餘額</dt><dd data-tone={dashboard.snapshotRun ? undefined : "muted"}>{amount(dashboard.snapshotRun?.availableEquity ?? null)}</dd>
          <small>可供策略風控計算</small></div>
        <div><dt>目前未實現</dt><dd data-tone={unrealized === null ? "muted" : unrealized >= 0 ? "positive" : "negative"}>
          {amount(dashboard.snapshotRun?.unrealizedPnl ?? null, true)}</dd><small>{dashboard.positions.length} 個帳戶持倉</small></div>
        <div><dt>運行 / 交易資產</dt><dd>{dashboard.runningCount} / {dashboard.assets.length}</dd>
          <small>{runs.length} 個雲端策略</small></div>
      </dl>

      <div className="portfolio-dashboard__grid">
        <section className="performance-breakdown" aria-labelledby="performance-breakdown-title">
          <header><div><p className="eyebrow">EXECUTION EVIDENCE</p><h3 id="performance-breakdown-title">策略運行績效</h3></div>
            <span>{dashboard.evaluations} 次評估 · {dashboard.signals} 次訊號</span></header>
          <ol>{runs.map((run) => {
            const action = typeof run.lastSignalJson?.action === "string" ? run.lastSignalJson.action : "等待訊號";
            return <li key={run.id} className="strategy-evidence-row">
              <div><strong>{run.name}</strong><span className="asset-state" data-running={run.state === "running"}>
                {run.state === "running" ? "運行中" : run.state === "paused" ? "已暫停" : run.state === "error" ? "需要處理" : "已停止"}</span></div>
              <small>{run.evaluationCount} 次評估 · {run.signalCount} 次交易訊號 · 最近 {action}
                {run.lastEvaluatedAt ? ` · ${dateTime(run.lastEvaluatedAt)}` : " · 尚未首次評估"}
                {run.consecutiveFailures ? ` · ${run.consecutiveFailures} 次連續錯誤` : ""}</small>
            </li>;
          })}</ol>
          <p className="portfolio-data-note">已實現損益需成交紀錄才能可靠歸因，目前不以帳戶餘額變化冒充單一策略報酬。</p>
        </section>

        <section className="trading-assets" aria-labelledby="trading-assets-title">
          <header><div><p className="eyebrow">TRADING UNIVERSE</p><h3 id="trading-assets-title">交易資產</h3></div>
            <span>{dashboard.assets.length} 個市場</span></header>
          <ul>{dashboard.assets.map(([symbol, asset]) => {
            const positions = dashboard.positions.filter((position) => position.symbol === symbol);
            const pnl = positions.reduce((sum, position) => sum + (finite(position.unrealizedPnl) ?? 0), 0);
            return <li key={symbol}><div><strong>{assetLabel(symbol)}</strong><small>{[...asset.names].join("、")}</small></div>
              <div><span className="asset-state" data-running={asset.running}>{asset.running ? "策略運行中" : "策略未運行"}</span>
                <small>{positions.length ? `${positions.length} 個持倉 · ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} USDT` : "目前無持倉"}</small></div></li>;
          })}</ul>
        </section>
      </div>

      {dashboard.positions.length > 0 && <section className="portfolio-positions" aria-labelledby="portfolio-positions-title">
        <header><div><p className="eyebrow">OPEN POSITIONS</p><h3 id="portfolio-positions-title">WEEX 目前持倉</h3></div>
          <span>{dashboard.positions.length} 個部位</span></header>
        <div className="portfolio-table-shell"><table><thead><tr><th>交易資產</th><th>方向</th><th>數量</th><th>持倉價值</th><th>槓桿</th><th>未實現損益</th></tr></thead>
          <tbody>{dashboard.positions.map((position) => <tr key={`${position.symbol}-${position.side}`}>
            <td data-label="交易資產"><strong>{assetLabel(position.symbol)}</strong></td>
            <td data-label="方向"><span className="position-side" data-side={position.side}>{position.side === "long" ? "做多" : "做空"}</span></td>
            <td data-label="數量">{position.size}</td><td data-label="持倉價值">{position.openValue}</td>
            <td data-label="槓桿">{position.leverage}×</td>
            <td data-label="未實現損益" data-tone={(finite(position.unrealizedPnl) ?? 0) >= 0 ? "positive" : "negative"}>
              {amount(position.unrealizedPnl, true)}</td>
          </tr>)}</tbody></table></div>
      </section>}

      <footer className="portfolio-dashboard__source"><span>資料來源：固定 IP AWS Executor 的 WEEX 私有帳戶查詢；不含 API 密鑰。</span>
        <span>{dashboard.snapshotRun?.accountObservedAt ? `最後快照 ${dateTime(dashboard.snapshotRun.accountObservedAt)}` : "等待 Executor 首次帳戶快照"}</span></footer>
    </>}
  </section>;
}
