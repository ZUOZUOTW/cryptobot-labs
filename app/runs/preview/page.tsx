import Link from "next/link";
import { notFound } from "next/navigation";
import {
  RunPortfolioDashboard,
  type DashboardPayload,
} from "../../../components/runs/RunPortfolioDashboard";

const at = (time: string) => new Date(`2026-07-26T${time}+08:00`).getTime();

const previewPayload: DashboardPayload = {
  generatedAt: at("14:32:18"),
  account: {
    connectionStatus: "active",
    syncStatus: "ready",
    accountUid: "CBL-582104",
    observedAt: at("14:32:18"),
    balances: [
      { asset: "BTC", total: "6423.18", available: "0", frozen: "0", unrealizedPnl: "43.12" },
      { asset: "ETH", total: "3832.14", available: "0", frozen: "0", unrealizedPnl: "21.03" },
      { asset: "SOL", total: "1951.41", available: "0", frozen: "0", unrealizedPnl: "10.03" },
      { asset: "USDT", total: "279.59", available: "279.59", frozen: "0", unrealizedPnl: "0" },
    ],
    positions: [
      { symbol: "BTCUSDT", side: "long", leverage: "1", size: "0.245", openValue: "6423.18", unrealizedPnl: "43.12", updatedAt: at("14:32:18") },
      { symbol: "ETHUSDT", side: "long", leverage: "2", size: "1.205", openValue: "3832.14", unrealizedPnl: "21.03", updatedAt: at("14:32:18") },
      { symbol: "SOLUSDT", side: "long", leverage: "1", size: "120", openValue: "1951.41", unrealizedPnl: "10.03", updatedAt: at("14:32:18") },
    ],
    accountEquity: "12486.32",
    availableEquity: "279.59",
    unrealizedPnl: "74.18",
    lastErrorCode: null,
  },
  runs: [
    {
      id: "preview-btc-orbit",
      name: "BTC 軌道定投",
      mode: "live",
      state: "running",
      market: "spot",
      symbol: "BTCUSDT",
      allowedSymbols: ["BTCUSDT"],
      evaluationCount: 142,
      signalCount: 28,
      lastEvaluatedAt: at("14:28:16"),
      lastSignalJson: { action: "買入區間" },
      lastErrorCode: null,
      consecutiveFailures: 0,
      maxTotalExposure: "7556.68",
      maxDailyLoss: "200",
    },
    {
      id: "preview-eth-breakout",
      name: "ETH 趨勢突破",
      mode: "live",
      state: "running",
      market: "futures",
      symbol: "ETHUSDT",
      allowedSymbols: ["ETHUSDT"],
      evaluationCount: 98,
      signalCount: 19,
      lastEvaluatedAt: at("14:27:09"),
      lastSignalJson: { action: "突破進多" },
      lastErrorCode: null,
      consecutiveFailures: 1,
      maxTotalExposure: "9124.14",
      maxDailyLoss: "160",
    },
    {
      id: "preview-sol-grid",
      name: "SOL 網格守望",
      mode: "live",
      state: "paused",
      market: "futures",
      symbol: "SOLUSDT",
      allowedSymbols: ["SOLUSDT"],
      evaluationCount: 76,
      signalCount: 15,
      lastEvaluatedAt: at("14:25:41"),
      lastSignalJson: { action: "區間震盪" },
      lastErrorCode: null,
      consecutiveFailures: 0,
      maxTotalExposure: "7227.44",
      maxDailyLoss: "120",
    },
  ],
  realizedPnl: {
    asset: "USDT",
    total: "932.44",
    tradeCount: 62,
    points: [
      { observedAt: at("00:00:00"), netPnl: "212.23", cumulativeNetPnl: "932.44", tradeCount: 9 },
    ],
  },
};

export default function RunControlCenterPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <div className="runs-page runs-page--control site-container">
    <header className="control-center-heading">
      <div><h1>控制中心</h1><span>最後同步　2026-07-26 14:32:18（UTC+8）</span></div>
      <Link className="button button--primary" href="/runs/new">啟動新策略</Link>
    </header>
    <RunPortfolioDashboard autoRefresh={false} initialPayload={previewPayload} />
  </div>;
}
