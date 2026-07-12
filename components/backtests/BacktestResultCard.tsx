import { BacktestProvenance } from "./BacktestProvenance";

export type HistoricalBacktestStatus = "queued" | "fetching-data" | "running" | "succeeded" | "failed";
export interface HistoricalRequest {
  strategyVersionId: string; market: "spot" | "futures"; symbol: string; interval: string;
  startTime: number; endTime: number; initialCapital: string; feeRate: string; slippageRate: string;
  leverage: string; fundingMode: "none" | "historical"; gapPolicy: "fail" | "disclose";
}
export interface HistoricalBacktestRecord {
  id: string; strategyVersionId: string; status: HistoricalBacktestStatus; evidenceLevel: "historical";
  request?: HistoricalRequest; requestJson?: string;
  error?: { code: string; message?: string | null } | null; errorCode?: string | null;
  createdAt: number; startedAt: number | null; completedAt: number | null;
  dataset?: { id: string; market: "spot" | "futures"; symbol: string; interval: string; source: string;
    requestedStartAt: number; requestedEndAt: number; actualStartAt: number | null; actualEndAt: number | null;
    complete: boolean; gaps: unknown[]; checksum: string } | null;
  result?: { id: string; funding: Record<string, unknown>;
    metrics: { totalReturn: string; annualizedReturn: string; maxDrawdown: string; winRate: string;
      profitFactor: string | null; sharpe: string; trades: number };
    provenance: { provider: string; dataSource: string; sourceKind: "public-api";
      requestedRange: { startTime?: number; endTime?: number }; fetchedRange: { startTime: number; endTime: number };
      gaps: unknown[]; gapCount: number; duplicateCount: number; incompleteCount: number; complete: boolean;
      feeRate: string; slippageRate: string;
      fundingTreatment: { suppliedEvents: number; appliedEvents: number; netFunding: string; convention: string };
      market: "spot" | "futures"; symbol: string; interval: string; engineVersion: string;
      configHash: string; strategyHash: string; datasetDigest: string;
      executionConvention: { signalEvaluation: string; signalExecution: string; riskTrigger: string };
      liquidationModel: { maintenanceMarginRate: string; maximumSupportedLeverage: string; check: string;
        orderingAssumption: string; model: string } };
    equityCurve: Array<{ timestamp: number; equity: string }>;
    engineVersion: string; configurationHash: string; strategyHash: string; scriptHash: string | null } | null;
}

export function requestOf(record: HistoricalBacktestRecord): HistoricalRequest | null {
  if (record.request) return record.request;
  if (!record.requestJson || record.requestJson.length > 32_768) return null;
  try {
    const parsed = JSON.parse(record.requestJson) as HistoricalRequest;
    return parsed && typeof parsed.symbol === "string" && typeof parsed.interval === "string" ? parsed : null;
  } catch { return null; }
}

const percent = (value: string): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${(parsed * 100).toFixed(2)}%` : "—";
};

export function BacktestResultCard({ backtest }: { backtest: HistoricalBacktestRecord }) {
  const result = backtest.result;
  if (!result || backtest.status !== "succeeded") return null;
  const { metrics, equityCurve } = result;
  const values = equityCurve.map((point) => Number(point.equity)).filter(Number.isFinite);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const spread = Math.max(high - low, 1);

  return (
    <article className="historical-result glass-panel" aria-labelledby={`result-${backtest.id}`}>
      <header>
        <div><p className="eyebrow">VERIFIED EVIDENCE</p><h2 id={`result-${backtest.id}`}>歷史回測</h2></div>
        <div className="evidence-badges" aria-label="績效證據層級">
          <span>WEEX 公開行情</span><strong>不是實盤績效</strong>
        </div>
      </header>
      <dl className="historical-metrics">
        <div><dt>總報酬</dt><dd>{percent(metrics.totalReturn)}</dd></div>
        <div><dt>年化報酬</dt><dd>{percent(metrics.annualizedReturn)}</dd></div>
        <div><dt>最大回撤</dt><dd>{percent(metrics.maxDrawdown)}</dd></div>
        <div><dt>勝率</dt><dd>{percent(metrics.winRate)}</dd></div>
        <div><dt>Profit Factor</dt><dd>{metrics.profitFactor ?? "—"}</dd></div>
        <div><dt>Sharpe</dt><dd>{metrics.sharpe}</dd></div>
        <div><dt>交易次數</dt><dd>{metrics.trades}</dd></div>
      </dl>
      <div className="historical-curve" role="img" aria-label={`權益曲線，共 ${equityCurve.length} 個資料點`}>
        {values.map((value, index) => <i aria-hidden="true" key={`${index}-${value}`} style={{ height: `${12 + ((value - low) / spread) * 88}%` }} />)}
      </div>
      <BacktestProvenance backtest={backtest} />
      <p className="historical-disclaimer" role="note">歷史回測依指定區間、成本與簡化執行模型計算，只供研究，不是實盤績效，也不保證未來結果。</p>
    </article>
  );
}
