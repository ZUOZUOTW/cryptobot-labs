const CANONICAL_WEEX_SYMBOL = /^[A-Z0-9]{4,32}$/;

/**
 * Maps the equivalent symbols used by WEEX public and contract APIs to the
 * single product identity persisted by CryptoBot Labs.
 */
export function canonicalizeWeexSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/^CMT_/, "").replace(/[\/_-]/g, "");
  return CANONICAL_WEEX_SYMBOL.test(normalized) ? normalized : null;
}
