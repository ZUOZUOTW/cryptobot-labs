import { summarizeStrategy } from "../../lib/strategy-summary";
import type { BotConfig } from "../../lib/types";
import type { ValidationResult } from "../../lib/strategy-validation";

interface StrategySummaryProps {
  config: BotConfig;
  validation: ValidationResult;
}

export function StrategySummary({ config, validation }: StrategySummaryProps) {
  const summary = summarizeStrategy(config);

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
      <ol>
        {summary.map((sentence, index) => <li key={`${index}-${sentence}`}>{sentence}</li>)}
      </ol>
      {!validation.valid && (
        <ul className="validation-errors" aria-label="設定問題">
          {validation.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
    </section>
  );
}
