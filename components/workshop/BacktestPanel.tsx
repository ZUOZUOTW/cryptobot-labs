"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runBacktest } from "../../lib/backtest";
import { validateConfig, type ValidationResult } from "../../lib/strategy-validation";
import type { BacktestReport, BotConfig, BotMetrics } from "../../lib/types";
import { PerformanceChart } from "../PerformanceChart";

type BacktestState = "idle" | "validating" | "running" | "complete" | "error";

const METRICS: { key: keyof BotMetrics; label: string; format: (value: number) => string; hint: string }[] = [
  { key: "totalReturn", label: "總報酬", format: (value) => `${value >= 0 ? "+" : ""}${value}%`, hint: "完整模擬期間累積變化" },
  { key: "annualizedReturn", label: "年化報酬", format: (value) => `${value}%`, hint: "換算為年化後的報酬率" },
  { key: "maxDrawdown", label: "最大回撤", format: (value) => `${value}%`, hint: "高點至低點的最大跌幅" },
  { key: "winRate", label: "勝率", format: (value) => `${value}%`, hint: "正報酬週期占比" },
  { key: "profitFactor", label: "獲利因子", format: String, hint: "總獲利與總虧損比" },
  { key: "sharpe", label: "夏普值", format: String, hint: "風險調整後報酬" },
  { key: "trades", label: "交易次數", format: String, hint: "模擬成交筆數" },
  { key: "runningDays", label: "運行天數", format: (value) => `${value} 天`, hint: "回測涵蓋期間" },
  { key: "stability", label: "穩定度", format: (value) => `${value}`, hint: "0–100 的一致性指標" },
];

interface BacktestPanelProps {
  config: BotConfig;
  validation: ValidationResult;
}

export function BacktestPanel({ config, validation }: BacktestPanelProps) {
  const [state, setState] = useState<BacktestState>("idle");
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const previousConfig = useRef(config);
  const missingRequiredRule = validation.errors.some((error) => (
    error === "至少需要一個進場訊號" || error === "至少需要一個出場或風控規則"
  ));
  const reportKey = useMemo(() => report ? JSON.stringify(report) : "", [report]);

  useEffect(() => {
    if (previousConfig.current !== config) {
      previousConfig.current = config;
      setState("idle");
      setReport(null);
      setErrors([]);
    }
  }, [config]);

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
    const timer = window.setTimeout(() => {
      try {
        setReport(runBacktest(config));
        setState("complete");
      } catch (error) {
        setErrors([error instanceof Error ? error.message : "回測發生未知錯誤"]);
        setState("error");
      }
    }, 160);
    return () => window.clearTimeout(timer);
  }, [config, state]);

  const run = () => {
    setErrors([]);
    setReport(null);
    setState("validating");
  };

  const busy = state === "validating" || state === "running";

  return (
    <section className="workshop-panel backtest-panel glass-panel" aria-label="回測控制" data-state={state}>
      <div className="workshop-panel__heading">
        <div>
          <p className="eyebrow">03 / SIMULATION</p>
          <h2>模擬回測</h2>
        </div>
        <span className="backtest-state">{state}</span>
      </div>

      <p className="backtest-panel__lead">使用固定種子模擬 36 個月策略表現；相同設定每次都會得到相同結果。</p>

      <button
        className="button button--primary backtest-run"
        disabled={missingRequiredRule || busy}
        onClick={run}
        type="button"
      >
        {state === "complete" ? "再次執行模擬回測" : state === "validating" ? "驗證設定中…" : state === "running" ? "回測運行中…" : "執行模擬回測"}
      </button>

      {state === "running" && (
        <div className="signal-flow" role="status">
          <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
          訊號流模擬中
        </div>
      )}

      {errors.length > 0 && (
        <div className="backtest-errors" role="alert">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}

      {report && state === "complete" && (
        <section className="backtest-result" aria-label="回測結果" data-report-key={reportKey}>
          <PerformanceChart label="模擬資產曲線" points={report.equityCurve} tone="cyan" />
          <div className="backtest-metrics">
            {METRICS.map((metric, index) => (
              <article
                aria-label={`${metric.label}回測指標`}
                className="metric-card glass-panel"
                data-tone={index % 3 === 0 ? "violet" : index % 3 === 1 ? "cyan" : "mint"}
                key={metric.key}
              >
                <dl><dt>{metric.label}</dt><dd>{metric.format(report.metrics[metric.key])}</dd></dl>
                <p>{metric.hint}</p>
              </article>
            ))}
          </div>
          <p className="simulation-disclosure" role="note">{report.disclaimer}</p>
          <p className="backtest-seed">REPRODUCIBLE SEED / {report.seed}</p>
        </section>
      )}
    </section>
  );
}
