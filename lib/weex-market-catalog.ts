import type { Market } from "./types";

export interface WeexTradingPair {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  maxLeverage: number;
}

export interface WeexMarketCatalog {
  spot: WeexTradingPair[];
  futures: WeexTradingPair[];
  updatedAt: string;
  source: "WEEX" | "fallback";
}

const FUTURES_SYMBOLS = `
BTCUSDT 1000BONKUSDT CVXUSDT NEOUSDT VIRTUALUSDT ARUSDT JUPUSDT SPXUSDT BZUSDT ETHUSDT
1000PEPEUSDT DASHUSDT ONDOUSDT WIFUSDT BERAUSDT KAITOUSDT STRKUSDT INTCUSDT SOLUSDT 1000SHIBUSDT
DOTUSDT OPUSDT WLDUSDT BLURUSDT LINEAUSDT STXUSDT SPCXUSDT ADAUSDT AAVEUSDT DUSKUSDT
ORDIUSDT XLMUSDT BRETTUSDT MANTAUSDT XMRUSDT AMZNUSDT AVAXUSDT AEROUSDT ENSUSDT PENGUUSDT
YFIUSDT CAKEUSDT MINAUSDT ZKUSDT BCHUSDT AGLDUSDT ETCUSDT PUMPUSDT YGGUSDT CELOUSDT
MOODENGUSDT ZROUSDT BNBUSDT APEUSDT FARTCOINUSDT RENDERUSDT ZENUSDT DYDXUSDT MORPHOUSDT 1000FLOKIUSDT
DOGEUSDT APTUSDT HYPEUSDT SSVUSDT XAUTUSDT DYMUSDT MOVEUSDT ENAUSDT HBARUSDT ARKMUSDT
ICPUSDT TAOUSDT XAGUSDT EIGENUSDT PENDLEUSDT CHZUSDT LINKUSDT ATOMUSDT IPUSDT THETAUSDT
PAXGUSDT ETHFIUSDT PNUTUSDT ARBUSDT LTCUSDT AXSUSDT JELLYJELLYUSDT TIAUSDT TONUSDT FETUSDT
POLUSDT DRIFTUSDT SUIUSDT BANDUSDT JTOUSDT TRBUSDT SEIUSDT GMXUSDT POPCATUSDT XTZUSDT
TRXUSDT COMPUSDT KASUSDT TRUMPUSDT NEARUSDT GRASSUSDT PYTHUSDT FILUSDT XRPUSDT COWUSDT
LDOUSDT UNIUSDT JASMYUSDT IMXUSDT RUNEUSDT TURBOUSDT ZECUSDT CRVUSDT LYNUSDT VETUSDT
QNTUSDT INJUSDT SANDUSDT CLUSDT
`.trim().split(/\s+/);

const SPOT_SYMBOLS = `
BTCUSDT LINKUSDT NEARUSDT ETHUSDT LTCUSDT ICPUSDT XRPUSDT AVAXUSDT INJUSDT BNBUSDT
TONUSDT JUPUSDT USDCUSDT SUIUSDT FETUSDT SOLUSDT DOTUSDT TRXUSDT UNIUSDT DOGEUSDT
XLMUSDT BCHUSDT APTUSDT ADAUSDT HBARUSDT
`.trim().split(/\s+/);

const symbolAssets = (symbol: string): Pick<WeexTradingPair, "baseAsset" | "quoteAsset"> => {
  const quoteAsset = symbol.endsWith("USDT") ? "USDT" : "";
  return { baseAsset: quoteAsset ? symbol.slice(0, -quoteAsset.length) : symbol, quoteAsset };
};

const fallbackPair = (symbol: string, market: Market): WeexTradingPair => ({
  symbol,
  ...symbolAssets(symbol),
  // This value is only used while the public metadata endpoint is unavailable.
  // Live execution independently checks the instrument limit returned by WEEX.
  maxLeverage: market === "spot" ? 1 : symbol === "BTCUSDT" || symbol === "ETHUSDT" ? 400 : 100,
});

export const WEEX_HELP_ARTICLE_SYMBOLS: Readonly<Record<Market, readonly string[]>> = {
  spot: SPOT_SYMBOLS,
  futures: FUTURES_SYMBOLS,
};

export const FALLBACK_WEEX_MARKET_CATALOG: WeexMarketCatalog = {
  spot: SPOT_SYMBOLS.map((symbol) => fallbackPair(symbol, "spot")),
  futures: FUTURES_SYMBOLS.map((symbol) => fallbackPair(symbol, "futures")),
  updatedAt: "2026-07-13T00:00:00.000Z",
  source: "fallback",
};

const record = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const canonicalSymbol = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/^CMT_/, "").replace(/[\/_-]/g, "");
  return /^[A-Z0-9]{4,32}$/.test(normalized) ? normalized : null;
};

const uniquePairs = (pairs: WeexTradingPair[]): WeexTradingPair[] => (
  [...new Map(pairs.map((pair) => [pair.symbol, pair])).values()]
    .toSorted((a, b) => a.symbol.localeCompare(b.symbol))
);

export function parseWeexMarketCatalog(
  spotSymbolsBody: unknown,
  futuresExchangeInfoBody: unknown,
  now = new Date(),
): WeexMarketCatalog {
  const spotRows = Array.isArray(spotSymbolsBody) ? spotSymbolsBody : [];
  const futuresRoot = record(futuresExchangeInfoBody);
  const futuresRows = Array.isArray(futuresRoot?.symbols) ? futuresRoot.symbols : [];

  const spot = uniquePairs(spotRows.flatMap((value): WeexTradingPair[] => {
    const symbol = canonicalSymbol(value);
    return symbol ? [{ symbol, ...symbolAssets(symbol), maxLeverage: 1 }] : [];
  }));
  const futures = uniquePairs(futuresRows.flatMap((value): WeexTradingPair[] => {
    const item = record(value);
    const symbol = canonicalSymbol(item?.displaySymbol) ?? canonicalSymbol(item?.symbol);
    const maxLeverage = typeof item?.maxLeverage === "number" ? item.maxLeverage : Number(item?.maxLeverage);
    if (!symbol || !Number.isInteger(maxLeverage) || maxLeverage < 1 || maxLeverage > 1_000) return [];
    const baseAsset = canonicalSymbol(item?.baseAsset) ?? symbolAssets(symbol).baseAsset;
    const quoteAsset = canonicalSymbol(item?.quoteAsset) ?? symbolAssets(symbol).quoteAsset;
    return [{ symbol, baseAsset, quoteAsset, maxLeverage }];
  }));

  if (spot.length === 0 || futures.length === 0) throw new TypeError("WEEX market catalog is incomplete");
  return { spot, futures, updatedAt: now.toISOString(), source: "WEEX" };
}

export function isWeexMarketCatalog(value: unknown): value is WeexMarketCatalog {
  const root = record(value);
  if (!root || root.source !== "WEEX" || typeof root.updatedAt !== "string") return false;
  return (["spot", "futures"] as const).every((market) => Array.isArray(root[market]) && root[market].length > 0
    && root[market].every((candidate) => {
      const pair = record(candidate);
      return canonicalSymbol(pair?.symbol) === pair?.symbol
        && typeof pair?.baseAsset === "string"
        && typeof pair?.quoteAsset === "string"
        && Number.isInteger(pair?.maxLeverage)
        && Number(pair?.maxLeverage) >= 1
        && Number(pair?.maxLeverage) <= 1_000;
    }));
}
