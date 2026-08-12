import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { STRATEGY_POSTER_SIZE } from "@/components/StrategyPosterCard";
import { BOT_CATALOG } from "@/data/bots";
import { renderOfficialStrategyPoster } from "@/lib/server/strategy-poster-images";

export const alt = "CryptoBot Labs 官方公開策略海報";
export const size = STRATEGY_POSTER_SIZE;
export const contentType = "image/png";
export const runtime = "nodejs";
export const revalidate = 3600;

export function generateStaticParams() {
  return BOT_CATALOG.map((bot) => ({ id: bot.id }));
}

export default async function OpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, requestHeaders] = await Promise.all([params, headers()]);
  const response = renderOfficialStrategyPoster(id, "zh-Hant", requestHeaders);
  if (!response) notFound();
  return response;
}
