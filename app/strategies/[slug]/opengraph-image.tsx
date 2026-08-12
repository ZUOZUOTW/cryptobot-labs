import { headers } from "next/headers";
import { STRATEGY_POSTER_SIZE } from "@/components/StrategyPosterCard";
import { renderMemberStrategyPoster } from "@/lib/server/strategy-poster-images";

export const alt = "CryptoBot Labs 公開策略績效預覽";
export const size = STRATEGY_POSTER_SIZE;
export const contentType = "image/png";
export const runtime = "nodejs";
export const revalidate = 3600;

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, requestHeaders] = await Promise.all([params, headers()]);
  return renderMemberStrategyPoster(slug, "zh-Hant", requestHeaders);
}
