"use client";

import { useEffect, useMemo, useState } from "react";
import { backtestConfigFingerprint } from "../../lib/backtest";
import { validateConfig, type ValidationResult } from "../../lib/strategy-validation";
import type { BacktestReport, BotConfig, BotMetrics } from "../../lib/types";
import { runWeexHistoricalBacktest } from "../../lib/weex-historical-client";
import { PerformanceChart } from "../PerformanceChart";

type BacktestState = "idle" | "validating" | "running" | "complete" | "error";

const METRICS: { key: keyof BotMetrics; label: string; format: (value: number) => string; hint: string }[] = [
  { key: "totalReturn", label: "總報酬", format: (value) => `${value >= 0 ? "+" : ""}${value}%`, hint: "完整歷史回測期間累積變化" },
  { key: "annualizedReturn", label: "年化報酬", format: (value) => `${value}%`, hint: "換算為年化後的報酬率" },
  { key: "maxDrawdown", label: "最大回撤", format: (value) => `${value}%`, hint: "高點至低點的最大跌幅" },
  { key: "winRate", label: "勝率", format: (value) => `${value}%`, hint: "正報酬週期占比" },
  { key: "profitFactor", label: "獲利因子", format: String, hint: "總獲利與總虧損比" },
  { key: "sharpe", label: "夏普值", format: String, hint: "風險調整後報酬" },
  { key: "trades", label: "交易次數", format: String, hint: "歷史回測成交筆數" },
  { key: "runningDays", label: "運行天數", format: (value) => `${value} 天`, hint: "回測涵蓋期間" },
  { key: "stability", label: "穩定度", format: (value) => `${value}`, hint: "0–100 的一致性指標" },
];

type MetricTone = "positive" | "negative" | "warning" | "neutral" | "info";

function metricTone(key: keyof BotMetrics, value: number): MetricTone {
  if (key === "trades" || key === "runningDays") return "info";
  if (key === "profitFactor") return value > 1 ? "positive" : value < 1 ? "negative" : "neutral";
  if (key === "winRate") return value >= 50 ? "positive" : value >= 40 ? "warning" : "negative";
  if (key === "maxDrawdown") return value > -10 ? "positive" : value > -25 ? "warning" : "negative";
  if (key === "stability") return value >= 60 ? "positive" : value >= 30 ? "warning" : "negative";
  return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}

interface BacktestPanelProps {
  config: BotConfig;
  validation: ValidationResult;
  executeBacktest?: (config: BotConfig) => BacktestReport | Promise<BacktestReport>;
  restoredReport?: BacktestReport | null;
  onReport?: (report: BacktestReport) => void;
  onRun?: () => void;
}

const STATE_LABELS: Record<BacktestState, string> = {
  idle: "等待執行",
  validating: "驗證設定",
  running: "歷史行情計算中",
  complete: "回測完成",
  error: "回測錯誤",
};

interface AssociatedReport {
  configFingerprint: string;
  report: BacktestReport;
}

export function BacktestPanel({
  config,
  validation,
  executeBacktest = runWeexHistoricalBacktest,
  restoredReport = null,
  onReport,
  onRun,
}: BacktestPanelProps) {
  const configFingerprint = backtestConfigFingerprint(config);
  const sessionKey = `${configFingerprint}:${restoredReport ? JSON.stringify(restoredReport) : ""}`;

  return (
    <BacktestPanelSession
      config={config}
      configFingerprint={configFingerprint}
      executeBacktest={executeBacktest}
      key={sessionKey}
      onReport={onReport}
      onRun={onRun}
      restoredReport={restoredReport}
      validation={validation}
    />
  );
}

interface BacktestPanelSessionProps {
  config: BotConfig;
  configFingerprint: string;
  executeBacktest: (config: BotConfig) => BacktestReport | Promise<BacktestReport>;
  validation: ValidationResult;
  restoredReport: BacktestReport | null;
  onReport?: (report: BacktestReport) => void;
  onRun?: () => void;
}

function BacktestPanelSession({ config, configFingerprint, validation, executeBacktest, restoredReport, onReport, onRun }: BacktestPanelSessionProps) {
  const [state, setState] = useState<BacktestState>(restoredReport ? "complete" : "idle");
  const [completedReport, setCompletedReport] = useState<AssociatedReport | null>(restoredReport ? {
    configFingerprint,
    report: restoredReport,
  } : null);
  const [errors, setErrors] = useState<string[]>([]);
  const report = completedReport?.configFingerprint === configFingerprint ? completedReport.report : null;
  const reportKey = useMemo(() => report ? JSON.stringify(report) : "", [report]);

  useEffect(() => {
    if (state !== "validating") return;
    const timer = window.setTimeout(() => {
      const result = validateConfig(config);
      if (!result.valid) {
        setErrors(result.errors);
        setState("idle");
        return;
      }
      setState("running");
    }, 30);
    return () => window.clearTimeout(timer);
  }, [config, state]);

  useEffect(() => {
    if (state !== "running") return;
    let cancelled = false;
    void Promise.resolve().then(() => executeBacktest(config)).then((nextReport) => {
      if (!cancelled) {
        setCompletedReport({ configFingerprint, report: nextReport });
        onReport?.(nextReport);
        setState("complete");
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setErrors([error instanceof Error ? error.message : "回測發生未知錯誤"]);
        setState("error");
      }
    });
    return () => { cancelled = true; };
  }, [config, configFingerprint, executeBacktest, onReport, state]);

  const run = () => {
    onRun?.();
    setErrors([]);
    setCompletedReport(null);
    setState("validating");
  };

  const busy = state === "validating" || state === "running";

  return (
    <section className="workshop-panel backtest-panel glass-panel" aria-label="回測控制" data-state={state}>
      <div className="workshop-panel__heading">
        <div>
          <p className="eyebrow">03 / WEEX HISTORICAL</p>
          <h2>WEEX 行情回測</h2>
        </div>
        <span className="backtest-state">{STATE_LABELS[state]}</span>
      </div>

      <p className="backtest-panel__lead">取得 WEEX 公開歷史 K 線後，以目前策略、槓桿、手續費與滑價假設計算最近 30 天績效；不需要 API Key，也不會送出訂單。</p>

      <button
        className="button button--primary backtest-run"
        disabled={!validation.valid || busy}
        onClick={run}
        type="button"
      >
        {state === "complete" ? "再次執行 WEEX 行情回測" : state === "validating" ? "驗證設定中…" : state === "running" ? "取得 WEEX 行情並回測中…" : "執行 WEEX 行情回測"}
      </button>

      {state === "running" && (
        <div className="signal-flow" role="status">
          <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
          WEEX 歷史行情計算中
        </div>
      )}

      {errors.length > 0 && (
        <div className="backtest-errors" role="alert">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}

      {report && state === "complete" && (
        <section className="backtest-result" aria-label="回測結果" data-report-key={reportKey}>
          {!report.evidence && <p className="simulation-disclosure" role="note"><strong>DEMO_MODE：</strong>使用固定合成行情完成快速預覽，不呼叫 WEEX API，也不代表未來績效。</p>}
          <PerformanceChart label="WEEX 歷史行情資產曲線" points={report.equityCurve} tone="cyan" variant="smooth" />
          <div className="backtest-metrics">
            {METRICS.map((metric) => (
              <article
                aria-label={`${metric.label}回測指標`}
                className="metric-card glass-panel"
                data-tone={metricTone(metric.key, report.metrics[metric.key])}
                key={metric.key}
              >
                <dl><dt>{metric.label}</dt><dd>{metric.format(report.metrics[metric.key])}</dd></dl>
                <p>{metric.hint}</p>
              </article>
            ))}
          </div>
          <p className="simulation-disclosure" role="note">{report.disclaimer}</p>
          {report.evidence && (
            <p className="backtest-seed">
              WEEX / {report.evidence.symbol} / {report.evidence.interval} / {report.evidence.candleCount} KLINES / {new Date(report.evidence.startTime).toLocaleDateString("zh-TW")}–{new Date(report.evidence.endTime).toLocaleDateString("zh-TW")}
              {report.evidence.fundingIncluded ? " / FUNDING INCLUDED" : " / FUNDING NOT INCLUDED"}
            </p>
          )}
        </section>
      )}
    </section>
  );
}
