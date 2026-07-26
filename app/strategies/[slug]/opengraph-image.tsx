import { ImageResponse } from "next/og";
import { loadPublicStrategyPublication } from "@/lib/server/public-strategy-loader";

export const alt = "CryptoBot Labs 公開策略績效預覽";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";
export const revalidate = 3600;

const percent = (value: string): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed >= 0 ? "+" : ""}${(parsed * 100).toFixed(1)}%` : "—";
};

const MascotBadge = () => (
  <div
    aria-hidden="true"
    style={{
      alignItems: "center",
      display: "flex",
      height: 260,
      justifyContent: "center",
      position: "relative",
      width: 288,
    }}
  >
    <div style={{
      border: "2px solid rgba(112, 233, 255, .42)",
      borderRadius: 999,
      display: "flex",
      height: 242,
      position: "absolute",
      transform: "rotate(-14deg)",
      width: 242,
    }} />
    <div style={{
      background: "radial-gradient(circle at 50% 38%, #8df1ff 0%, #2bbbd7 46%, #0b526b 100%)",
      border: "6px solid rgba(211, 251, 255, .92)",
      borderRadius: 999,
      boxShadow: "0 20px 54px rgba(58, 219, 255, .34)",
      display: "flex",
      height: 190,
      width: 190,
    }}>
      <div style={{
        alignItems: "center",
        background: "rgba(4, 25, 39, .84)",
        border: "2px solid rgba(222, 252, 255, .72)",
        borderRadius: 42,
        display: "flex",
        flexDirection: "column",
        height: 118,
        justifyContent: "center",
        margin: "30px 22px",
        width: 134,
      }}>
        <div style={{ display: "flex", gap: 26 }}>
          <span style={{ background: "#b8f8ff", borderRadius: 999, display: "flex", height: 18, width: 18 }} />
          <span style={{ background: "#b8f8ff", borderRadius: 999, display: "flex", height: 18, width: 18 }} />
        </div>
        <div style={{
          background: "linear-gradient(90deg, #5de6ff, #b8f8ff)",
          borderRadius: 999,
          display: "flex",
          height: 7,
          marginTop: 22,
          width: 66,
        }} />
      </div>
    </div>
    <div style={{
      background: "#e7fdff",
      border: "5px solid #1f9fbd",
      borderRadius: 999,
      boxShadow: "0 0 22px rgba(113, 238, 255, .75)",
      display: "flex",
      height: 24,
      position: "absolute",
      right: 18,
      top: 38,
      width: 24,
    }} />
  </div>
);

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const publication = await loadPublicStrategyPublication(slug);

  const name = publication?.name ?? "CryptoBot Labs 公開策略";
  const market = publication?.market === "futures" ? "USDT-M 合約" : "現貨";
  const publisher = publication?.publisherName ?? "CryptoBot Labs";
  const metrics = publication ? [
    ["TOTAL RETURN", percent(publication.metrics.totalReturn)],
    ["MAX DRAWDOWN", percent(publication.metrics.maxDrawdown)],
    ["WIN RATE", percent(publication.metrics.winRate)],
    ["TRADES", String(publication.metrics.trades)],
  ] : [
    ["EVIDENCE", "VERIFIED"],
    ["MARKET", "WEEX"],
    ["VERSION", "FIXED"],
    ["ACCESS", "PUBLIC"],
  ];

  return new ImageResponse(
    (
      <div style={{
        alignItems: "stretch",
        background: "linear-gradient(135deg, #07111c 0%, #0a2331 55%, #10283a 100%)",
        color: "#f3fbff",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Arial, sans-serif",
        height: "100%",
        justifyContent: "space-between",
        overflow: "hidden",
        padding: "56px 64px",
        position: "relative",
        width: "100%",
      }}>
        <div style={{
          background: "radial-gradient(circle, rgba(68,232,255,.34) 0%, rgba(68,232,255,0) 70%)",
          display: "flex",
          height: 520,
          position: "absolute",
          right: -80,
          top: -80,
          width: 520,
        }} />
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
          <div style={{ alignItems: "baseline", display: "flex", fontSize: 28, fontWeight: 800, letterSpacing: "-1px" }}>
            <span style={{ color: "#ffffff" }}>CryptoBot</span>
            <span style={{ color: "#64e7ff", marginLeft: 8 }}>Labs</span>
          </div>
          <div style={{
            background: "rgba(104, 236, 255, .1)",
            border: "1px solid rgba(104, 236, 255, .62)",
            borderRadius: 999,
            color: "#9aeeff",
            display: "flex",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "1.8px",
            padding: "11px 18px",
          }}>VERIFIED HISTORICAL BACKTEST</div>
        </div>

        <div style={{ alignItems: "center", display: "flex", gap: 48 }}>
          <div style={{ display: "flex", flex: 1, flexDirection: "column", minWidth: 0 }}>
            <div style={{ color: "#8ca8bb", display: "flex", fontSize: 20, marginBottom: 16 }}>
              {publication ? `${market} · ${publication.symbol} · ${publication.timeframe.toUpperCase()}` : "PUBLIC STRATEGY · IMMUTABLE VERSION"}
            </div>
            <div style={{
              display: "flex",
              fontSize: name.length > 22 ? 52 : 64,
              fontWeight: 800,
              letterSpacing: "-2px",
              lineHeight: 1.08,
              maxWidth: 760,
            }}>{name}</div>
            <div style={{ color: "#c3d2dc", display: "flex", fontSize: 22, marginTop: 20 }}>
              由 {publisher} 發布 · 固定版本績效證據
            </div>
          </div>
          <MascotBadge />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", gap: 14 }}>
            {metrics.map(([label, value]) => (
              <div key={label} style={{
                background: "rgba(255,255,255,.055)",
                border: "1px solid rgba(151, 203, 225, .2)",
                borderRadius: 16,
                display: "flex",
                flex: 1,
                flexDirection: "column",
                padding: "16px 18px",
              }}>
                <span style={{ color: "#7f9aac", display: "flex", fontSize: 13, fontWeight: 700, letterSpacing: "1.2px" }}>{label}</span>
                <strong style={{ color: "#f4fcff", display: "flex", fontSize: 27, marginTop: 6 }}>{value}</strong>
              </div>
            ))}
          </div>
          <div style={{ alignItems: "center", color: "#9eb2bf", display: "flex", fontSize: 17, justifyContent: "space-between" }}>
            <span>歷史回測不代表未來績效</span>
            <span style={{ color: "#72e8ff", fontWeight: 700 }}>查看策略 · 透過發布者邀請連結註冊 WEEX →</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
