import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { StrategyPosterCard, STRATEGY_POSTER_HEADERS, STRATEGY_POSTER_SIZE } from "@/components/StrategyPosterCard";
import { BOT_CATALOG } from "@/data/bots";
import { env } from "@/lib/server/platform-env";
import { resolveStrategyPosterAssetOrigin } from "@/lib/server/strategy-poster-origin";

export const alt = "CryptoBot Labs 官方公開策略海報";
export const size = STRATEGY_POSTER_SIZE;
export const contentType = "image/png";
export const runtime = "nodejs";
export const revalidate = 3600;

export function generateStaticParams() {
  return BOT_CATALOG.map((bot) => ({ id: bot.id }));
}

const marketLabel = (market: "spot" | "futures") => market === "spot" ? "WEEX 現貨" : "WEEX USDT-M 合約";

export default async function OpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, requestHeaders] = await Promise.all([params, headers()]);
  const bot = BOT_CATALOG.find((candidate) => candidate.id === id);
  if (!bot) notFound();
  const assetOrigin = resolveStrategyPosterAssetOrigin({
    nodeEnv: process.env.NODE_ENV,
    publicOrigin: env.PUBLIC_ORIGIN,
    requestHeaders,
  });

  const mascotPath = bot.risk === "高"
    ? "/mascots/ai-guardian.png"
    : bot.market === "spot"
      ? "/mascots/ai-observer.png"
      : "/mascots/ai-builder.png";

  return new ImageResponse(
    <StrategyPosterCard
      badge="OFFICIAL STRATEGY"
      context={`${marketLabel(bot.market)} · ${bot.symbol} · ${bot.timeframe.toUpperCase()}`}
      disclosure="策略規格預覽 · 回測不代表未來績效"
      mascotSrc={new URL(mascotPath, assetOrigin).toString()}
      metrics={[
        { label: "MARKET", value: bot.market === "spot" ? "現貨" : "USDT-M" },
        { label: "TIMEFRAME", value: bot.timeframe.toUpperCase() },
        { label: "RISK", value: `${bot.risk}風險`, accent: bot.risk === "高" },
        { label: "MODULES", value: `${bot.blocks.length} 個` },
      ]}
      name={bot.name}
      publisher="CryptoBot Labs 研究團隊"
    />,
    { ...size, headers: STRATEGY_POSTER_HEADERS },
  );
}
