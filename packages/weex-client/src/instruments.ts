import type { InstrumentRules, Market } from "@cryptobot-labs/trading-core";

import { parseInstrumentRules } from "./schemas";
import type { HttpTransport } from "./transport";

const EXCHANGE_INFO = {
  spot: "https://api-spot.weex.com/api/v3/exchangeInfo",
  futures: "https://api-contract.weex.com/capi/v3/market/exchangeInfo",
} as const;

export async function fetchInstrumentRules(
  transport: HttpTransport,
  market: Market,
  symbol: string,
): Promise<InstrumentRules> {
  const response = await transport.send({ method: "GET", url: EXCHANGE_INFO[market], headers: { Accept: "application/json" } });
  return parseInstrumentRules(response.body, market, symbol);
}
