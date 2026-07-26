"use client";

import { useState } from "react";
import { backtestConfigFingerprint } from "../../lib/backtest";
import { summarizeStrategy } from "../../lib/strategy-summary";
import type { BotConfig } from "../../lib/types";
import type { ValidationResult } from "../../lib/strategy-validation";
import { tradeDirectionLabel } from "../../lib/trade-direction";

interface StrategySummaryProps {
  config: BotConfig;
  onFlowCheck?: (state: SignalFlowCheckState) => void;
  validation: ValidationResult;
}

export type SignalFlowCheckState = "untested" | "failed" | "passed";

export function StrategySummary({ config, onFlowCheck, validation }: StrategySummaryProps) {
  const summary = summarizeStrategy(config);
  const configFingerprint = backtestConfigFingerprint(config);
  const [checkedFlow, setCheckedFlow] = useState<{ fingerprint: string; state: "passed" | "failed" } | null>(null);
  const flowCheck = checkedFlow?.fingerprint === configFingerprint ? checkedFlow.state : "idle";
  const positionBlock = config.blocks.find((block) => block.group === "position");
  const riskBlocks = config.blocks.filter((block) => block.group === "risk");

  const testSignalFlow = () => {
    const state = validation.valid && config.blocks.length > 0 ? "passed" : "failed";
    setCheckedFlow({ fingerprint: configFingerprint, state });
    onFlowCheck?.(state);
  };

  return (
    <section className="workshop-panel strategy-summary glass-panel" aria-label="策略摘要">
      <div className="workshop-panel__heading">
        <div>
          <p className="eyebrow">LIVE STRATEGY SUMMARY</p>
          <h2>策略摘要</h2>
        </div>
        <span className={`validation-badge ${validation.valid ? "is-valid" : "is-invalid"}`}>
          {validation.valid ? "設定可回測" : "需要調整"}
        </span>
      </div>
      <div className="strategy-policy-grid" aria-label="交易政策摘要" role="region">
        <article data-policy="direction">
          <span>方向</span>
          <strong>{tradeDirectionLabel(config)}</strong>
        </article>
        <article data-policy="leverage">
          <span>槓桿</span>
          <strong>{config.leverage}×</strong>
        </article>
        <article data-policy="position">
          <span>倉位</span>
          <strong>{positionBlock?.name ?? "未設定"}</strong>
        </article>
        <article data-policy="risk">
          <span>風控</span>
          <strong>{riskBlocks.length > 0 ? riskBlocks.map((block) => block.name).join("、") : "未設定"}</strong>
        </article>
      </div>
      <ol>
        {summary.map((sentence, index) => <li key={`${index}-${sentence}`}>{sentence}</li>)}
      </ol>
      {!validation.valid && (
        <ul className="validation-errors" aria-label="設定問題">
          {validation.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
      <div className="strategy-flow-check" data-state={flowCheck}>
        <div className="strategy-flow-check__track" aria-hidden="true">
          {(["entry", "confirm", "exit", "position", "risk"] as const).map((group) => (
            <span data-active={config.blocks.some((block) => block.group === group)} key={group} />
          ))}
        </div>
        <button className="button button--secondary" onClick={testSignalFlow} type="button">快速測試訊號流程</button>
        <p aria-live="polite" role={flowCheck === "idle" ? undefined : "status"}>
          {flowCheck === "passed"
            ? `流程測試通過：${config.blocks.length} 個模組的連接、順序與參數皆可執行。`
            : flowCheck === "failed"
              ? `流程尚未就緒：${validation.errors[0] ?? "請先加入策略模組"}`
              : "手動檢查模組連接、順序與參數；不呼叫行情 API。"}
        </p>
      </div>
    </section>
  );
}
