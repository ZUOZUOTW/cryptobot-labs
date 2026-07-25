import type { StrategyPublicationRecord } from "../../db/repositories";
import type { BotConfig } from "../types";
import type {
  PublicStrategyEquityPoint,
  PublicStrategyMetrics,
  PublicStrategyPublication,
} from "../strategy-publications";
import { validateConfig } from "../strategy-validation";
import { HttpProblem } from "./http";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{7,79}$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

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

export function parsePublicationInput(value: unknown): {
  strategyVersionId: string;
  backtestJobId: string;
  description: string;
  weexReferralUrl: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new HttpProblem(400, "invalid_request");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "backtestJobId,description,strategyVersionId,weexReferralUrl"
    || typeof record.strategyVersionId !== "string" || !ID.test(record.strategyVersionId)
    || typeof record.backtestJobId !== "string" || !ID.test(record.backtestJobId)
    || typeof record.description !== "string") throw new HttpProblem(400, "invalid_request");
  const description = record.description.trim();
  if (description.length < 20 || description.length > 400 || /[\u0000-\u001f\u007f]/.test(description)) {
    throw new HttpProblem(422, "invalid_publication_description");
  }
  return {
    strategyVersionId: record.strategyVersionId,
    backtestJobId: record.backtestJobId,
    description,
    weexReferralUrl: parseWeexReferralUrl(record.weexReferralUrl),
  };
}

export function publicationSlug(id: string): string {
  const suffix = id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-20);
  const slug = `strategy-${suffix}`;
  if (!SLUG.test(slug)) throw new Error("publication id cannot produce a safe slug");
  return slug;
}

export function toPublicStrategyPublication(record: StrategyPublicationRecord): PublicStrategyPublication {
  const config = configOf(record.configJson);
  if (config.market !== record.market || config.symbol !== record.symbol) {
    throw new Error("published strategy identity mismatch");
  }
  return {
    slug: record.slug,
    name: record.name,
    description: record.description,
    publisherName: record.publisherName,
    weexReferralUrl: parseWeexReferralUrl(record.weexReferralUrl),
    market: config.market,
    symbol: config.symbol,
    timeframe: config.timeframe,
    leverage: config.leverage,
    logicMode: config.logicMode,
    blocks: config.blocks.map((block) => ({
      ...block,
      parameters: block.parameters.map((parameter) => ({ ...parameter })),
    })),
    metrics: metricsOf(record.metricsJson),
    equityCurve: equityOf(record.equityCurveJson),
    actualStartAt: record.actualStartAt,
    actualEndAt: record.actualEndAt,
    publishedAt: record.publishedAt,
    updatedAt: record.updatedAt,
  };
}
