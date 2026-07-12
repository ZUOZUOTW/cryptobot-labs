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
  const range = maximum - minimum || 1;
  const summary = describeTrend(points);
  const width = 600;
  const height = 180;
  const paddingX = 12;
  const paddingY = 18;
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length <= 1 ? width / 2 : paddingX + (index / (points.length - 1)) * (width - paddingX * 2),
    y: height - paddingY - ((point.value - minimum) / range) * (height - paddingY * 2),
  }));
  const result = points.length > 1 && points.at(-1)!.value < points[0].value ? "loss" : "profit";
  const areaPoints = coordinates.length > 0
    ? `${coordinates[0].x},${height - paddingY} ${coordinates.map((point) => `${point.x},${point.y}`).join(" ")} ${coordinates.at(-1)!.x},${height - paddingY}`
    : "";

  return (
    <figure
      aria-label={`${label}：${summary}`}
      className="performance-chart glass-panel"
      data-result={result}
      data-tone={tone}
    >
      <figcaption className="performance-chart__caption">
        <span>{label}</span>
        <strong>{summary}</strong>
      </figcaption>

      {points.length > 0 ? (
        <div className="performance-chart__plot" role="list" aria-label={`${label}資料點`}>
          <svg aria-hidden="true" className="performance-chart__svg" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
            {[0.25, 0.5, 0.75].map((ratio) => <line className="performance-chart__gridline" key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} />)}
            <polygon className="performance-chart__area" points={areaPoints} />
            {coordinates.slice(1).map((point, index) => {
              const previous = coordinates[index];
              const direction = point.value >= previous.value ? "profit" : "loss";
              return (
                <line
                  className="performance-chart__segment"
                  data-direction={direction}
                  key={`${point.label}-${index}`}
                  pathLength="1"
                  style={{ "--segment-index": index } as CSSProperties}
                  x1={previous.x}
                  x2={point.x}
                  y1={previous.y}
                  y2={point.y}
                />
              );
            })}
            {coordinates.map((point, index) => (
              <circle
                className="performance-chart__dot"
                data-direction={index === 0 || point.value >= coordinates[index - 1].value ? "profit" : "loss"}
                cx={point.x}
                cy={point.y}
                key={`${point.label}-dot`}
                r={index === coordinates.length - 1 ? 5 : 3}
              />
            ))}
          </svg>
          <ol className="sr-only">
            {points.map((point, index) => {
              const previous = points[index - 1]?.value ?? point.value;
              const direction = point.value > previous ? "上升" : point.value < previous ? "下降" : "持平";
              const accessibleLabel = `${point.label}：${point.value}，${direction}`;
              return <li aria-label={accessibleLabel} key={`${point.label}-accessible`}>{accessibleLabel}</li>;
            })}
          </ol>
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
