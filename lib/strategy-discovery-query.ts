import type { Market, RiskLevel } from "./types";

export const STRATEGY_DISCOVERY_SORTS = [
  "recommended", "return-desc", "drawdown-asc", "win-rate-desc", "stability-desc",
] as const;

export type StrategyDiscoverySort = (typeof STRATEGY_DISCOVERY_SORTS)[number];

export interface StrategyDiscoveryQuery {
  limit?: number;
  search?: string;
  market?: Market;
  timeframe?: string;
  risk?: RiskLevel;
  sort: StrategyDiscoverySort;
  cursor?: string;
  slugs?: string[];
}

export const normalizeDiscoverySearch = (value: string): string => value.trim().replace(/\s+/gu, " ").slice(0, 80);

export function strategyPublicationListPath(query: StrategyDiscoveryQuery): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const search = query.search === undefined ? "" : normalizeDiscoverySearch(query.search);
  if (search) params.set("q", search);
  if (query.market) params.set("market", query.market);
  if (query.timeframe) params.set("timeframe", query.timeframe);
  if (query.risk) params.set("risk", query.risk);
  params.set("sort", query.sort);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.slugs?.length) params.set("slugs", query.slugs.join(","));
  const queryString = params.toString();
  return queryString ? `/api/strategy-publications?${queryString}` : "/api/strategy-publications";
}
