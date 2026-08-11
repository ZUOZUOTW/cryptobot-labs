import { ImageResponse } from "next/og";
import { headers } from "next/headers";
import { StrategyPosterCard, STRATEGY_POSTER_HEADERS, STRATEGY_POSTER_SIZE } from "@/components/StrategyPosterCard";
import { loadPublicStrategyPublication } from "@/lib/server/public-strategy-loader";
import {
  buildMemberStrategyPosterMetrics,
  formatIsoHistoricalPeriod,
} from "@/lib/strategy-sharing";
import { env } from "@/lib/server/platform-env";
import { resolveStrategyPosterAssetOrigin } from "@/lib/server/strategy-poster-origin";

export const alt = "CryptoBot Labs 公開策略績效預覽";
export const size = STRATEGY_POSTER_SIZE;
export const contentType = "image/png";
export const runtime = "nodejs";
export const revalidate = 3600;

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, requestHeaders] = await Promise.all([params, headers()]);
  const assetOrigin = resolveStrategyPosterAssetOrigin({
    nodeEnv: process.env.NODE_ENV,
    publicOrigin: env.PUBLIC_ORIGIN,
    requestHeaders,
  });
  let publication: Awaited<ReturnType<typeof loadPublicStrategyPublication>> = null;
  try {
    publication = await loadPublicStrategyPublication(slug);
  } catch (error) {
    console.error("[strategy-poster] publication backend unavailable", {
      name: error instanceof Error ? error.name : "Error",
      slug,
    });
    return new Response("Strategy poster temporarily unavailable", {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "60",
        "X-Robots-Tag": "noindex, nofollow",
      },
      status: 503,
    });
  }
  if (!publication) {
    return new Response("Strategy poster not found", {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
      },
      status: 404,
    });
  }

  const name = publication.name;
  const market = publication.market === "futures" ? "WEEX USDT-M 合約" : "WEEX 現貨";
  const publisher = publication.publisherName;
  const context = `${market} · ${publication.symbol} · ${publication.timeframe.toUpperCase()}`;
  const metrics = buildMemberStrategyPosterMetrics(publication.metrics);
  const historicalPeriod = formatIsoHistoricalPeriod(publication.actualStartAt, publication.actualEndAt);

  return new ImageResponse(
    <StrategyPosterCard
      badge="VERIFIED HISTORICAL BACKTEST"
      context={context}
      disclosure={`${historicalPeriod ? `歷史區間 ${historicalPeriod} · ` : ""}固定版本歷史證據 · 歷史回測不代表未來績效`}
      mascotSrc={new URL("/mascots/ai-builder.png", assetOrigin).toString()}
      metrics={metrics}
      name={name}
      publisher={publisher}
    />,
    { ...size, headers: STRATEGY_POSTER_HEADERS },
  );
}
