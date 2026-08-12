import { isLocale } from "@/lib/i18n/locales";
import { renderOfficialStrategyPoster } from "@/lib/server/strategy-poster-images";

export const runtime = "nodejs";
export const revalidate = 3600;

const notFound = (message: string): Response => new Response(message, {
  headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  status: 404,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; locale: string }> },
): Promise<Response> {
  const { id, locale } = await params;
  if (!isLocale(locale)) return notFound("Strategy poster locale not found");
  return renderOfficialStrategyPoster(id, locale, request.headers)
    ?? notFound("Strategy poster not found");
}
