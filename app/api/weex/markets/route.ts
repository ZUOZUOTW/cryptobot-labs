import { parseWeexMarketCatalog } from "../../../../lib/weex-market-catalog";

const SPOT_API_SYMBOLS = "https://api-spot.weex.com/api/v3/apiTradingSymbols";
const FUTURES_EXCHANGE_INFO = "https://api-contract.weex.com/capi/v3/market/exchangeInfo";

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
  ...init,
  headers: { "Content-Type": "application/json; charset=utf-8", ...init?.headers },
});

export async function GET(): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const [spotResponse, futuresResponse] = await Promise.all([
      fetch(SPOT_API_SYMBOLS, { headers: { Accept: "application/json" }, signal: controller.signal }),
      fetch(FUTURES_EXCHANGE_INFO, { headers: { Accept: "application/json" }, signal: controller.signal }),
    ]);
    if (!spotResponse.ok || !futuresResponse.ok) throw new Error("WEEX market metadata request failed");
    const catalog = parseWeexMarketCatalog(await spotResponse.json(), await futuresResponse.json());
    return json(catalog, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400" },
    });
  } catch {
    return json({ error: { code: "weex_market_metadata_unavailable" } }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  } finally {
    clearTimeout(timeout);
  }
}
