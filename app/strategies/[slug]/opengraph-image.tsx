import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createControlPlaneDatabase } from "@/db";
import { createStrategyPublicationRepository } from "@/db/repositories";
import { env } from "@/lib/server/platform-env";
import { toPublicStrategyPublication } from "@/lib/server/strategy-publications";

export const alt = "CryptoBot Labs 公開策略績效預覽";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

const percent = (value: string): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed >= 0 ? "+" : ""}${(parsed * 100).toFixed(1)}%` : "—";
};

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const record = await createStrategyPublicationRepository(
    createControlPlaneDatabase(env.DB),
  ).getBySlug(slug);
  let publication: ReturnType<typeof toPublicStrategyPublication> | null = null;
  try { publication = record ? toPublicStrategyPublication(record) : null; }
  catch { publication = null; }

  const mascot = await readFile(join(process.cwd(), "public", "mascots", "ai-builder.png"));
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
          <img
            alt=""
            height="260"
            src={mascot as unknown as string}
            style={{ filter: "drop-shadow(0 18px 34px rgba(58, 219, 255, .25))", objectFit: "contain" }}
            width="288"
          />
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
