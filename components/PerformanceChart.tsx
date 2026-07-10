import type { CSSProperties } from "react";
import type { EquityPoint } from "../lib/types";

type VisualTone = "violet" | "cyan" | "mint" | "danger";

interface PerformanceChartProps {
  points: EquityPoint[];
  label: string;
  tone: VisualTone;
}

function describeTrend(points: EquityPoint[]) {
  if (points.length === 0) return "尚無資料";

  const change = points.at(-1)!.value - points[0].value;
  if (change > 0) return `整體上升 ${change.toFixed(1)}`;
  if (change < 0) return `整體下降 ${Math.abs(change).toFixed(1)}`;
  return "整體持平";
}

export function PerformanceChart({ points, label, tone }: PerformanceChartProps) {
  const values = points.map((point) => point.value);
  const minimum = values.length > 0 ? Math.min(...values) : 0;
  const maximum = values.length > 0 ? Math.max(...values) : 0;
  const range = maximum - minimum;
  const summary = describeTrend(points);

  return (
    <figure
      aria-label={`${label}：${summary}`}
      className="performance-chart glass-panel"
      data-tone={tone}
    >
      <figcaption className="performance-chart__caption">
        <span>{label}</span>
        <strong>{summary}</strong>
      </figcaption>

      {points.length > 0 ? (
        <div className="performance-chart__plot" role="list" aria-label={`${label}資料點`}>
          {points.map((point, index) => {
            const previous = points[index - 1]?.value ?? point.value;
            const direction = point.value > previous ? "up" : point.value < previous ? "down" : "flat";
            const height = range === 0 ? 50 : 18 + ((point.value - minimum) / range) * 82;

            return (
              <span
                aria-label={`${point.label}：${point.value}，${direction === "up" ? "上升" : direction === "down" ? "下降" : "持平"}`}
                className="performance-chart__point"
                data-direction={direction}
                key={`${point.label}-${index}`}
                role="listitem"
                style={{ "--point-height": `${height}%` } as CSSProperties}
              >
                <span className="performance-chart__bar" aria-hidden="true" />
                <span className="performance-chart__marker" aria-hidden="true">
                  {direction === "up" ? "+" : direction === "down" ? "−" : "="}
                </span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="performance-chart__empty">尚無可顯示的績效資料</p>
      )}

      {points.length > 0 && (
        <dl className="sr-only">
          <div><dt>起始值</dt><dd>{points[0].value}</dd></div>
          <div><dt>結束值</dt><dd>{points.at(-1)!.value}</dd></div>
          <div><dt>最低值</dt><dd>{minimum}</dd></div>
          <div><dt>最高值</dt><dd>{maximum}</dd></div>
        </dl>
      )}
    </figure>
  );
}
