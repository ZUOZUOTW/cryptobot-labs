import type { StrategyPublicationCursor, StrategyPublicationRecord } from "../../db/repositories";
import type { BotConfig } from "../types";
import type {
  PublicStrategyEquityPoint,
  PublicStrategyMetrics,
  PublicStrategyPublication,
} from "../strategy-publications";
import { validateConfig } from "../strategy-validation";
import { resolvedTradeDirection } from "../trade-direction";
import {
  validatePublicPublicationDescription,
  validatePublicPublisherName,
} from "../publication-moderation";
import { HttpProblem, errorResponse } from "./http";

export const publicStrategyFreshnessHeaders = Object.freeze({
  "cache-control": "no-store, max-age=0",
  "netlify-cdn-cache-control": "no-store",
});

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{7,79}$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CURSOR = /^[A-Za-z0-9_-]{16,384}$/;
const INTEGER = /^(?:0|[1-9]\d*)$/;

export const PUBLICATION_LIST_DEFAULT_LIMIT = 12;
export const PUBLICATION_LIST_MAX_LIMIT = 24;
export const PUBLICATION_LIST_MAX_EQUITY_POINTS = 120;
export const PUBLICATION_LIST_MAX_SCAN_PAGES = 5;
export const PUBLIC_STRATEGY_CACHE_VERSION = "v2";

export class InvalidPublicStrategyTrustMetadataError extends Error {
  constructor() {
    super("published strategy trust metadata is invalid");
    this.name = "InvalidPublicStrategyTrustMetadataError";
  }
}

export function publicStrategyPublicationCacheTag(slug: string): string {
  if (!SLUG.test(slug)) throw new Error("publication slug is invalid");
  return `public-strategy-publication:${PUBLIC_STRATEGY_CACHE_VERSION}:${slug}`;
}

const plainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
);

const base64UrlEncode = (value: string): string => btoa(value)
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");

const base64UrlDecode = (value: string): string => atob(value
  .replace(/-/g, "+")
  .replace(/_/g, "/")
  .padEnd(Math.ceil(value.length / 4) * 4, "="));

export function encodePublicationCursor(cursor: StrategyPublicationCursor): string {
  if (!Number.isSafeInteger(cursor.publishedAt) || cursor.publishedAt < 0 || !ID.test(cursor.id)) {
    throw new Error("publication cursor is invalid");
  }
  return base64UrlEncode(JSON.stringify({ v: 1, publishedAt: cursor.publishedAt, id: cursor.id }));
}

export function decodePublicationCursor(value: string): StrategyPublicationCursor {
  if (!CURSOR.test(value)) throw new HttpProblem(400, "invalid_request");
  let decoded: unknown;
  try { decoded = JSON.parse(base64UrlDecode(value)) as unknown; }
  catch { throw new HttpProblem(400, "invalid_request"); }
  if (!plainObject(decoded) || Object.keys(decoded).sort().join(",") !== "id,publishedAt,v"
    || decoded.v !== 1 || !Number.isSafeInteger(decoded.publishedAt) || Number(decoded.publishedAt) < 0
    || typeof decoded.id !== "string" || !ID.test(decoded.id)) {
    throw new HttpProblem(400, "invalid_request");
  }
  return { publishedAt: decoded.publishedAt as number, id: decoded.id };
}

export function parsePublicationListRequest(request: Request): {
  limit: number;
  cursor?: StrategyPublicationCursor;
} {
  const url = new URL(request.url);
  const allowed = new Set(["limit", "cursor"]);
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!allowed.has(key) || seen.has(key)) throw new HttpProblem(400, "invalid_request");
    seen.add(key);
  }
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit !== null && !INTEGER.test(rawLimit)) throw new HttpProblem(400, "invalid_request");
  const limit = rawLimit === null ? PUBLICATION_LIST_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PUBLICATION_LIST_MAX_LIMIT) {
    throw new HttpProblem(400, "invalid_request");
  }
  const rawCursor = url.searchParams.get("cursor");
  return {
    limit,
    ...(rawCursor === null ? {} : { cursor: decodePublicationCursor(rawCursor) }),
  };
}

const parseJson = (value: unknown, maximumLength: number): unknown => {
  if (typeof value === "string") {
    if (value.length > maximumLength) throw new Error("published strategy JSON is too large");
    return JSON.parse(value) as unknown;
  }
  return value;
};

const metricString = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 64 || !DECIMAL.test(value) || !Number.isFinite(Number(value))) {
    throw new Error("published strategy metrics are invalid");
  }
  return value;
};

const metricsOf = (value: unknown): PublicStrategyMetrics => {
  const candidate = parseJson(value, 32_768);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("published strategy metrics are invalid");
  }
  const metrics = candidate as Record<string, unknown>;
  const profitFactor = metrics.profitFactor === null ? null : metricString(metrics.profitFactor);
  if (!Number.isSafeInteger(metrics.trades) || Number(metrics.trades) < 0) {
    throw new Error("published strategy metrics are invalid");
  }
  return {
    totalReturn: metricString(metrics.totalReturn),
    annualizedReturn: metricString(metrics.annualizedReturn),
    maxDrawdown: metricString(metrics.maxDrawdown),
    winRate: metricString(metrics.winRate),
    profitFactor,
    sharpe: metricString(metrics.sharpe),
    trades: metrics.trades as number,
  };
};

const equityOf = (value: unknown): PublicStrategyEquityPoint[] => {
  const candidate = parseJson(value, 262_144);
  if (!Array.isArray(candidate) || candidate.length < 2 || candidate.length > 2_000) {
    throw new Error("published strategy equity curve is invalid");
  }
  return candidate.map((point) => {
    if (!point || typeof point !== "object" || Array.isArray(point)) {
      throw new Error("published strategy equity curve is invalid");
    }
    const row = point as Record<string, unknown>;
    if (!Number.isSafeInteger(row.timestamp) || Number(row.timestamp) < 0) {
      throw new Error("published strategy equity curve is invalid");
    }
    return { timestamp: row.timestamp as number, equity: metricString(row.equity) };
  });
};

const configOf = (value: unknown): BotConfig => {
  const candidate = parseJson(value, 262_144);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("published strategy configuration is invalid");
  }
  const config = candidate as BotConfig;
  if (!validateConfig(config).valid) throw new Error("published strategy configuration is invalid");
  return config;
};

export function parseWeexReferralUrl(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 2_048) {
    throw new HttpProblem(422, "invalid_weex_referral_url");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpProblem(422, "invalid_weex_referral_url"); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || (url.port !== "" && url.port !== "443")
    || !(hostname === "weex.com" || hostname.endsWith(".weex.com"))) {
    throw new HttpProblem(422, "invalid_weex_referral_url");
  }
  return url.toString();
}

export function parseWeexReferralUpdateInput(value: unknown): { weexReferralUrl: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new HttpProblem(400, "invalid_request");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).join(",") !== "weexReferralUrl") throw new HttpProblem(400, "invalid_request");
  return { weexReferralUrl: parseWeexReferralUrl(record.weexReferralUrl) };
}

export function parsePublicationInput(value: unknown): {
  strategyVersionId: string;
  backtestJobId: string;
  description: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new HttpProblem(400, "invalid_request");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "backtestJobId,description,strategyVersionId"
    || typeof record.strategyVersionId !== "string" || !ID.test(record.strategyVersionId)
    || typeof record.backtestJobId !== "string" || !ID.test(record.backtestJobId)
    || typeof record.description !== "string") throw new HttpProblem(400, "invalid_request");
  const description = validatePublicPublicationDescription(record.description);
  if (!description.valid) {
    throw new HttpProblem(422, "invalid_publication_description");
  }
  return {
    strategyVersionId: record.strategyVersionId,
    backtestJobId: record.backtestJobId,
    description: description.value,
  };
}

export function publicationSlug(id: string): string {
  const suffix = id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-20);
  const slug = `strategy-${suffix}`;
  if (!SLUG.test(slug)) throw new Error("publication id cannot produce a safe slug");
  return slug;
}

export function toPublicStrategyPublication(record: StrategyPublicationRecord, options: {
  maxEquityPoints?: number;
} = {}): PublicStrategyPublication {
  const config = configOf(record.configJson);
  const description = validatePublicPublicationDescription(record.description);
  const publisherName = validatePublicPublisherName(record.publisherName);
  if (!description.valid || !publisherName.valid) {
    throw new InvalidPublicStrategyTrustMetadataError();
  }
  if (config.name !== record.name || config.market !== record.market || config.symbol !== record.symbol) {
    throw new Error("published strategy identity mismatch");
  }
  const equityCurve = equityOf(record.equityCurveJson);
  const maximum = options.maxEquityPoints;
  if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 2 || maximum > 2_000)) {
    throw new Error("published strategy equity point limit is invalid");
  }
  const sampledEquityCurve = maximum !== undefined && equityCurve.length > maximum
    ? Array.from({ length: maximum }, (_, index) => (
        equityCurve[Math.round(index * (equityCurve.length - 1) / (maximum - 1))]!
      ))
    : equityCurve;
  return {
    slug: record.slug,
    name: record.name,
    description: description.value,
    publisherName: publisherName.value,
    weexReferralUrl: record.weexReferralUrl === null ? null : parseWeexReferralUrl(record.weexReferralUrl),
    market: config.market,
    symbol: config.symbol,
    timeframe: config.timeframe,
    leverage: config.leverage,
    logicMode: config.logicMode,
    tradeDirection: resolvedTradeDirection(config),
    hasPrivateSource: config.source !== undefined,
    blocks: config.blocks.map((block) => ({
      ...block,
      parameters: block.parameters.map((parameter) => ({ ...parameter })),
    })),
    metrics: metricsOf(record.metricsJson),
    equityCurve: sampledEquityCurve,
    actualStartAt: record.actualStartAt,
    actualEndAt: record.actualEndAt,
    publishedAt: record.publishedAt,
    updatedAt: record.updatedAt,
  };
}

type PublicPublicationListRepository = {
  listPage(options: { limit: number; cursor?: StrategyPublicationCursor }): Promise<{
    items: StrategyPublicationRecord[];
    nextCursor: StrategyPublicationCursor | null;
  }>;
};

const cursorOfRecord = (record: StrategyPublicationRecord): StrategyPublicationCursor => {
  const cursor = { publishedAt: record.publishedAt, id: record.id };
  encodePublicationCursor(cursor);
  return cursor;
};

const cursorKey = (cursor: StrategyPublicationCursor): string => `${cursor.publishedAt}:${cursor.id}`;

const isStrictlyLaterInPublicationOrder = (
  candidate: StrategyPublicationCursor,
  previous: StrategyPublicationCursor,
): boolean => (
  candidate.publishedAt < previous.publishedAt
  || (candidate.publishedAt === previous.publishedAt && candidate.id < previous.id)
);

const sameCursor = (left: StrategyPublicationCursor, right: StrategyPublicationCursor): boolean => (
  left.publishedAt === right.publishedAt && left.id === right.id
);

const publicationListResponse = (
  publications: PublicStrategyPublication[],
  nextCursor: StrategyPublicationCursor | null,
): Response => Response.json({
  publications,
  nextCursor: nextCursor === null ? null : encodePublicationCursor(nextCursor),
}, { status: 200, headers: publicStrategyFreshnessHeaders });

export async function servePublicStrategyPublicationList(
  request: Request,
  repository: PublicPublicationListRepository,
): Promise<Response> {
  try {
    const options = parsePublicationListRequest(request);
    const publications: PublicStrategyPublication[] = [];
    let cursor = options.cursor;
    const visited = new Set(cursor === undefined ? [] : [cursorKey(cursor)]);
    for (let scan = 0; scan < PUBLICATION_LIST_MAX_SCAN_PAGES; scan += 1) {
      const page = await repository.listPage({ limit: options.limit, ...(cursor === undefined ? {} : { cursor }) });
      if (page.items.length > options.limit
        || (page.nextCursor !== null && page.items.length !== options.limit)) {
        throw new Error("publication repository returned an invalid page");
      }
      const itemCursors = page.items.map(cursorOfRecord);
      let previous = cursor;
      for (const itemCursor of itemCursors) {
        if (previous !== undefined && !isStrictlyLaterInPublicationOrder(itemCursor, previous)) {
          throw new Error("publication repository order did not advance");
        }
        previous = itemCursor;
      }
      const lastCursor = itemCursors.at(-1);
      if (page.nextCursor !== null && (lastCursor === undefined || !sameCursor(page.nextCursor, lastCursor))) {
        throw new Error("publication repository cursor does not match its page");
      }

      for (const [index, record] of page.items.entries()) {
        try {
          publications.push(toPublicStrategyPublication(record, {
            maxEquityPoints: PUBLICATION_LIST_MAX_EQUITY_POINTS,
          }));
        } catch (error) {
          console.error("[strategy-publications] skipped invalid public record", {
            slug: record.slug,
            name: error instanceof Error ? error.name : "Error",
          });
        }
        if (publications.length === options.limit) {
          const nextCursor = index < page.items.length - 1 ? itemCursors[index]! : page.nextCursor;
          return publicationListResponse(publications, nextCursor);
        }
      }

      if (page.nextCursor === null) return publicationListResponse(publications, null);
      const nextKey = cursorKey(page.nextCursor);
      if (visited.has(nextKey)) throw new Error("publication repository cursor did not advance");
      visited.add(nextKey);
      cursor = page.nextCursor;
    }
    return publicationListResponse(publications, cursor ?? null);
  } catch (error) {
    if (error instanceof HttpProblem) return errorResponse(error, { status: error.status, code: error.code });
    console.error("[strategy-publications] list failed", { name: error instanceof Error ? error.name : "Error" });
    return Response.json({ error: "publication_service_unavailable" }, {
      status: 503,
      headers: publicStrategyFreshnessHeaders,
    });
  }
}
