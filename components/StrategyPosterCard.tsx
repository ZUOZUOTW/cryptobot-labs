/* eslint-disable @next/next/no-img-element -- ImageResponse renders this raw image into the generated PNG. */

import { sanitizeStrategyDisplayText } from "../lib/strategy-name";

export interface StrategyPosterMetric {
  label: string;
  value: string;
  accent?: boolean;
}

export interface StrategyPosterCardProps {
  name: string;
  context: string;
  publisher: string;
  badge: string;
  mascotSrc: string;
  metrics: StrategyPosterMetric[];
  disclosure: string;
  publisherPrefix?: string;
  publisherSuffix?: string;
  callToAction?: string;
}

export const STRATEGY_POSTER_SIZE = { width: 1200, height: 630 } as const;

export const STRATEGY_POSTER_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Netlify-CDN-Cache-Control": "public, durable, s-maxage=3600, stale-while-revalidate=86400",
} as const;

const WIDE_GRAPHEME = /[MWmw@%&#\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Extended_Pictographic}]/u;

const posterGraphemes = (value: string): string[] => (
  Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), ({ segment }) => segment)
);

export function fitStrategyPosterText(value: string, maxUnits: number): string {
  const normalized = sanitizeStrategyDisplayText(value);
  if (!normalized || !Number.isSafeInteger(maxUnits) || maxUnits < 2) return "—";
  const graphemes = posterGraphemes(normalized);
  let units = 0;
  let visible = "";
  for (const grapheme of graphemes) {
    const weight = WIDE_GRAPHEME.test(grapheme) ? 2 : 1;
    if (units + weight > maxUnits - 2) return `${visible}…`;
    visible += grapheme;
    units += weight;
  }
  return visible;
}

export function strategyPosterTextUnits(value: string): number {
  return posterGraphemes(value).reduce((total, grapheme) => total + (WIDE_GRAPHEME.test(grapheme) ? 2 : 1), 0);
}

export function StrategyPosterCard({
  name,
  context,
  publisher,
  badge,
  mascotSrc,
  metrics,
  disclosure,
  publisherPrefix = "由 ",
  publisherSuffix = " 發布 · 公開固定版本",
  callToAction = "查看策略與完整證據 →",
}: StrategyPosterCardProps) {
  const safeName = fitStrategyPosterText(name, 44);
  const safePublisher = fitStrategyPosterText(publisher, 36);
  const nameUnits = strategyPosterTextUnits(safeName);
  return (
    <div style={{
      alignItems: "stretch",
      background: "linear-gradient(132deg, #050911 0%, #071a27 48%, #10263a 100%)",
      color: "#f3fbff",
      display: "flex",
      flexDirection: "column",
      fontFamily: "Arial, sans-serif",
      height: "100%",
      justifyContent: "space-between",
      overflow: "hidden",
      padding: "50px 58px 42px",
      position: "relative",
      width: "100%",
    }}>
      <div style={{
        background: "radial-gradient(circle, rgba(62, 222, 255, .3) 0%, rgba(62, 222, 255, 0) 68%)",
        display: "flex",
        height: 560,
        position: "absolute",
        right: -92,
        top: -136,
        width: 560,
      }} />
      <div style={{
        border: "1px solid rgba(105, 229, 255, .13)",
        borderRadius: 999,
        display: "flex",
        height: 430,
        position: "absolute",
        right: -18,
        top: -54,
        transform: "rotate(-12deg)",
        width: 430,
      }} />

      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", position: "relative" }}>
        <div style={{ alignItems: "baseline", display: "flex", fontSize: 27, fontWeight: 800, letterSpacing: "-1px" }}>
          <span style={{ color: "#ffffff" }}>CryptoBot</span>
          <span style={{ color: "#62e5ff", marginLeft: 8 }}>Labs</span>
        </div>
        <div style={{
          background: "rgba(90, 229, 255, .1)",
          border: "1px solid rgba(103, 231, 255, .55)",
          borderRadius: 999,
          color: "#9af0ff",
          display: "flex",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "1.5px",
          padding: "10px 17px",
        }}>{badge}</div>
      </div>

      <div style={{ alignItems: "center", display: "flex", gap: 34, minHeight: 260, position: "relative" }}>
        <div style={{ display: "flex", flex: 1, flexDirection: "column", minWidth: 0 }}>
          <div style={{ color: "#82a2b6", display: "flex", fontSize: 19, fontWeight: 700, letterSpacing: ".4px", marginBottom: 14 }}>
            {context}
          </div>
          <div style={{
            alignItems: "center",
            display: "flex",
            fontSize: nameUnits > 34 ? 46 : nameUnits > 24 ? 52 : 62,
            fontWeight: 800,
            height: 112,
            letterSpacing: "-2px",
            lineHeight: 1.05,
            maxWidth: 748,
            overflow: "hidden",
            wordBreak: "break-all",
          }}>{safeName}</div>
          <div style={{ color: "#bdced9", display: "flex", fontSize: 19, marginTop: 12, maxWidth: 748, overflow: "hidden", whiteSpace: "nowrap" }}>
            {publisherPrefix}{safePublisher}{publisherSuffix}
          </div>
        </div>
        <div style={{
          alignItems: "center",
          display: "flex",
          height: 268,
          justifyContent: "center",
          position: "relative",
          width: 292,
        }}>
          <div style={{
            background: "radial-gradient(circle, rgba(83, 224, 255, .28) 0%, rgba(83, 224, 255, 0) 70%)",
            display: "flex",
            height: 292,
            position: "absolute",
            width: 292,
          }} />
          <img
            alt=""
            height={268}
            src={mascotSrc}
            style={{ objectFit: "contain", position: "relative", width: 292 }}
            width={292}
          />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18, position: "relative" }}>
        <div style={{ display: "flex", gap: 12 }}>
          {metrics.slice(0, 4).map((metric) => (
            <div key={metric.label} style={{
              background: metric.accent ? "rgba(89, 230, 255, .105)" : "rgba(255,255,255,.052)",
              border: metric.accent ? "1px solid rgba(102, 232, 255, .32)" : "1px solid rgba(151, 203, 225, .18)",
              borderRadius: 15,
              display: "flex",
              flex: 1,
              flexDirection: "column",
              padding: "14px 17px",
            }}>
              <span style={{ color: "#7895a8", display: "flex", fontSize: 12, fontWeight: 700, letterSpacing: "1.1px" }}>{metric.label}</span>
              <strong style={{ color: metric.accent ? "#8ff0ff" : "#f4fcff", display: "flex", fontSize: 25, marginTop: 5 }}>{metric.value}</strong>
            </div>
          ))}
        </div>
        <div style={{ alignItems: "center", color: "#8fa7b5", display: "flex", fontSize: 16, justifyContent: "space-between" }}>
          <span>{disclosure}</span>
          <span style={{ color: "#72e8ff", fontWeight: 700 }}>{callToAction}</span>
        </div>
      </div>
    </div>
  );
}
