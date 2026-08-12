import { DEFAULT_LOCALE, isLocale, type Locale } from "./i18n/locales";
import {
  STRATEGY_POSTER_COPY,
  STRATEGY_SHARE_COPY,
  type StrategyPosterLocaleCopy,
} from "./i18n/strategy-sharing-copy";
import { sanitizeStrategyDisplayText } from "./strategy-name";
import type { Market, RiskLevel } from "./types";

export type StrategyShareNetwork = "line" | "x" | "facebook" | "telegram";

export interface VerifiedSharePerformance {
  kind: "total-return";
  value: string;
  verified: true;
  historicalPeriod?: { startAt: number; endAt: number };
}

export interface StrategyShareCopyInput {
  name: string;
  market?: string;
  marketKind?: Market;
  timeframe?: string;
  risk?: string;
  riskLevel?: RiskLevel;
  verifiedPerformance?: VerifiedSharePerformance;
}

const compact = (value: string | undefined): string | null => {
  const normalized = sanitizeStrategyDisplayText(value);
  return normalized ? normalized : null;
};

const ratioPercent = (value: string, fractionDigits: number): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isSafeInteger(fractionDigits)
    && fractionDigits >= 0 && fractionDigits <= 6
    ? parsed * 100
    : null;
};

export function formatSignedReturn(value: string, fractionDigits = 1): string {
  const percentage = ratioPercent(value, fractionDigits);
  return percentage === null ? "—" : `${percentage >= 0 ? "+" : ""}${percentage.toFixed(fractionDigits)}%`;
}

export function formatDrawdownMagnitude(value: string, fractionDigits = 1): string {
  const percentage = ratioPercent(value, fractionDigits);
  return percentage === null ? "—" : `${Math.abs(percentage).toFixed(fractionDigits)}%`;
}

export function formatRate(value: string, fractionDigits = 1): string {
  const percentage = ratioPercent(value, fractionDigits);
  return percentage === null ? "—" : `${percentage.toFixed(fractionDigits)}%`;
}

export function buildMemberStrategyPosterMetrics(metrics: {
  totalReturn: string;
  maxDrawdown: string;
  winRate: string;
  trades: number;
}, locale: Locale = DEFAULT_LOCALE) {
  const labels = STRATEGY_POSTER_COPY[locale].metricLabels;
  return [
    { label: labels.totalReturn, value: formatSignedReturn(metrics.totalReturn), accent: true },
    { label: labels.maxDrawdown, value: formatDrawdownMagnitude(metrics.maxDrawdown) },
    { label: labels.winRate, value: formatRate(metrics.winRate) },
    { label: labels.trades, value: new Intl.NumberFormat(locale).format(metrics.trades) },
  ];
}

export function strategyPosterLocaleCopy(locale: Locale = DEFAULT_LOCALE): StrategyPosterLocaleCopy {
  return STRATEGY_POSTER_COPY[locale];
}

export function strategyShareDialogTitle(name: string, locale: Locale = DEFAULT_LOCALE): string {
  const copy = STRATEGY_SHARE_COPY[locale];
  return copy.dialogTitle(compact(name) ?? copy.fallbackName);
}

export function strategyPosterPreviewAlt(name: string, locale: Locale = DEFAULT_LOCALE): string {
  const copy = STRATEGY_SHARE_COPY[locale];
  return copy.posterPreviewAlt(compact(name) ?? copy.fallbackName);
}

export function buildStrategyShareText(
  input: StrategyShareCopyInput,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const copy = STRATEGY_SHARE_COPY[locale];
  const name = compact(input.name) ?? copy.fallbackName;
  const market = input.marketKind ? copy[input.marketKind] : compact(input.market);
  const risk = input.riskLevel ? copy.risks[input.riskLevel] : compact(input.risk);
  const profile = [market, compact(input.timeframe)?.toUpperCase(), risk]
    .filter((value): value is string => value !== null)
    .join(" · ");
  const performance = input.verifiedPerformance?.verified ? compact(input.verifiedPerformance.value) : null;
  const period = input.verifiedPerformance?.verified
    ? formatHistoricalPeriod(input.verifiedPerformance.historicalPeriod, locale)
    : null;
  return copy.text({ name, profile, performance, period });
}

export function formatHistoricalPeriod(
  period: VerifiedSharePerformance["historicalPeriod"] | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (!period || !Number.isSafeInteger(period.startAt) || !Number.isSafeInteger(period.endAt)
    || period.startAt < 0 || period.endAt < period.startAt) return null;
  const start = new Date(period.startAt);
  const end = new Date(period.endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "2-digit", month: "short", timeZone: "UTC", year: "numeric",
  });
  return `${formatter.format(start)}–${formatter.format(end)}`;
}

export function formatIsoHistoricalPeriod(startAt: number | null, endAt: number | null): string | null {
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt)
    || startAt === null || endAt === null || startAt < 0 || endAt < startAt) return null;
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  return `${start.toISOString().slice(0, 10)}–${end.toISOString().slice(0, 10)}`;
}

export function strategyPosterPath(sharePath: string, locale?: Locale): string {
  const url = new URL(sharePath, "https://cryptobot.invalid");
  const pathname = url.pathname.replace(/\/+$/, "");
  const version = url.searchParams.get("v");
  const versionQuery = version !== null && /^(?:0|[1-9]\d{0,15})$/.test(version) ? `?v=${version}` : "";
  const queryLocale = url.searchParams.get("locale");
  const requestedLocale = locale ?? (isLocale(queryLocale) ? queryLocale : undefined);
  if (requestedLocale && /^\/(?:bots|strategies)\/[^/]+$/u.test(pathname)) {
    return `/api/strategy-posters${pathname}/${requestedLocale}${versionQuery}`;
  }
  return `${`${pathname || "/"}/opengraph-image`.replace(/^\/\//, "/")}${versionQuery}`;
}

export function localizeStrategyPosterPath(posterPath: string, locale: Locale): string {
  const url = new URL(posterPath, "https://cryptobot.invalid");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "api" && segments[1] === "strategy-posters") {
    segments.splice(-1, 1, locale);
    return `/${segments.join("/")}${url.search}`;
  }
  const imageIndex = segments.lastIndexOf("opengraph-image");
  if (imageIndex < 0) return posterPath;
  const strategySegments = segments.slice(0, imageIndex);
  return `/api/strategy-posters/${strategySegments.join("/")}/${locale}${url.search}`;
}

export function socialShareUrl(
  network: StrategyShareNetwork,
  { text, url }: { text: string; url: string },
): string {
  const encodedText = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(url);
  const targets: Record<StrategyShareNetwork, string> = {
    line: `https://line.me/R/share?text=${encodeURIComponent(`${text}\n${url}`)}`,
    x: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`,
    telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
  };
  return targets[network];
}

export function strategyPosterFilename(strategyId: string): string {
  const safeId = strategyId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `cryptobot-${safeId || "strategy"}-poster.png`;
}
