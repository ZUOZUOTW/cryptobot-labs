import { isLocale } from "@/lib/i18n/locales";
import { renderMemberStrategyPoster } from "@/lib/server/strategy-poster-images";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; locale: string }> },
): Promise<Response> {
  const { slug, locale } = await params;
  if (!isLocale(locale)) return new Response("Strategy poster locale not found", {
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
    status: 404,
  });
  return renderMemberStrategyPoster(slug, locale, request.headers);
}
