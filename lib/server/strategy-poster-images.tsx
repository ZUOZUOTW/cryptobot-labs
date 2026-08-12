import { ImageResponse } from "next/og";
import { StrategyPosterCard, STRATEGY_POSTER_HEADERS, STRATEGY_POSTER_SIZE } from "@/components/StrategyPosterCard";
import { BOT_CATALOG } from "@/data/bots";
import type { Locale } from "@/lib/i18n/locales";
import { translateMessage } from "@/lib/i18n/messages";
import {
  buildMemberStrategyPosterMetrics,
  formatIsoHistoricalPeriod,
  strategyPosterLocaleCopy,
} from "@/lib/strategy-sharing";
import { loadPublicStrategyPublication } from "@/lib/server/public-strategy-loader";
import { env } from "@/lib/server/platform-env";
import { resolveStrategyPosterAssetOrigin } from "@/lib/server/strategy-poster-origin";

function assetOrigin(requestHeaders: Headers): URL {
  return resolveStrategyPosterAssetOrigin({
    nodeEnv: process.env.NODE_ENV,
    publicOrigin: env.PUBLIC_ORIGIN,
    requestHeaders,
  });
}

export function renderOfficialStrategyPoster(
  id: string,
  locale: Locale,
  requestHeaders: Headers,
): ImageResponse | null {
  const bot = BOT_CATALOG.find((candidate) => candidate.id === id);
  if (!bot) return null;
  const posterLocale: Locale = locale === "ar" ? "en" : locale;
  const copy = strategyPosterLocaleCopy(posterLocale);
  const mascotPath = bot.risk === "高"
    ? "/mascots/ai-guardian.png"
    : bot.market === "spot"
      ? "/mascots/ai-observer.png"
      : "/mascots/ai-builder.png";
  const publisher = copy.officialPublisher;

  return new ImageResponse(
    <StrategyPosterCard
      badge={copy.officialBadge}
      callToAction={copy.callToAction}
      context={`${bot.market === "spot" ? copy.spot : copy.futures} · ${bot.symbol} · ${bot.timeframe.toUpperCase()}`}
      disclosure={copy.officialDisclosure}
      mascotSrc={new URL(mascotPath, assetOrigin(requestHeaders)).toString()}
      metrics={[
        { label: copy.metricLabels.market, value: bot.market === "spot" ? copy.spot.replace(/^WEEX\s+/u, "") : "USDT-M" },
        { label: copy.metricLabels.timeframe, value: bot.timeframe.toUpperCase() },
        { label: copy.metricLabels.risk, value: copy.riskValues[bot.risk], accent: bot.risk === "高" },
        { label: copy.metricLabels.modules, value: copy.moduleCount(bot.blocks.length) },
      ]}
      name={translateMessage(posterLocale, bot.name)}
      publisher={publisher}
      publisherPrefix={copy.publisherPrefix}
      publisherSuffix={copy.publisherSuffix}
    />,
    { ...STRATEGY_POSTER_SIZE, headers: STRATEGY_POSTER_HEADERS },
  );
}

export async function renderMemberStrategyPoster(
  slug: string,
  locale: Locale,
  requestHeaders: Headers,
): Promise<Response> {
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

  const posterLocale: Locale = locale === "ar" ? "en" : locale;
  const copy = strategyPosterLocaleCopy(posterLocale);
  const context = `${publication.market === "futures" ? copy.futures : copy.spot} · ${publication.symbol} · ${publication.timeframe.toUpperCase()}`;
  const metrics = buildMemberStrategyPosterMetrics(publication.metrics, posterLocale);
  const historicalPeriod = formatIsoHistoricalPeriod(publication.actualStartAt, publication.actualEndAt);

  return new ImageResponse(
    <StrategyPosterCard
      badge={copy.verifiedBadge}
      callToAction={copy.callToAction}
      context={context}
      disclosure={copy.memberDisclosure(historicalPeriod)}
      mascotSrc={new URL("/mascots/ai-builder.png", assetOrigin(requestHeaders)).toString()}
      metrics={metrics}
      name={publication.name}
      publisher={publication.publisherName}
      publisherPrefix={copy.publisherPrefix}
      publisherSuffix={copy.publisherSuffix}
    />,
    { ...STRATEGY_POSTER_SIZE, headers: STRATEGY_POSTER_HEADERS },
  );
}
