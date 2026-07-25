import { useId } from "react";

type VisualTone = "violet" | "cyan" | "mint" | "danger";

interface MetricCardProps {
  label: string;
  value: string | number;
  hint: string;
  tone: VisualTone;
}

export function MetricCard({ label, value, hint, tone }: MetricCardProps) {
  const hintId = useId();

  return (
    <article className="metric-card glass-panel" data-tone={tone} aria-describedby={hintId}>
      <dl>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </dl>
      <p id={hintId}>{hint}</p>
    </article>
  );
}
