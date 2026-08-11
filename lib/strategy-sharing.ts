import { DEFAULT_LOCALE, type Locale } from "./i18n/locales";
import { sanitizeStrategyDisplayText } from "./strategy-name";
import type { Market, RiskLevel } from "./types";

export type StrategyShareNetwork = "line" | "x" | "facebook" | "telegram";

export interface VerifiedSharePerformance {
  kind: "total-return";
  value: string;
  verified: true;
  historicalPeriod?: {
    startAt: number;
    endAt: number;
  };
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

interface ShareLocaleCopy {
  spot: string;
  futures: string;
  risks: Record<RiskLevel, string>;
  text: (input: { name: string; profile: string; performance: string | null; period: string | null }) => string;
}

const SHARE_COPY: Record<Locale, ShareLocaleCopy> = {
  "zh-Hant": {
    spot: "WEEX 現貨",
    futures: "WEEX USDT-M 合約",
    risks: { 低: "低風險", 中: "中風險", 高: "高風險" },
    text: ({ name, profile, performance, period }) => `我在 CryptoBot Labs 發現「${name}」${profile ? `：${profile}` : ""}。${performance ? `固定版本${period ? `在 ${period} 歷史區間` : ""}的 WEEX 歷史回測總報酬為 ${performance}。` : "查看完整策略規則、風控與回測證據。"}歷史回測不代表未來績效。`,
  },
  "zh-Hans": {
    spot: "WEEX 现货",
    futures: "WEEX USDT-M 合约",
    risks: { 低: "低风险", 中: "中风险", 高: "高风险" },
    text: ({ name, profile, performance, period }) => `我在 CryptoBot Labs 发现“${name}”${profile ? `：${profile}` : ""}。${performance ? `固定版本${period ? `在 ${period} 历史区间` : ""}的 WEEX 历史回测总收益为 ${performance}。` : "查看完整策略规则、风控和回测证据。"}历史回测不代表未来表现。`,
  },
  en: {
    spot: "WEEX spot",
    futures: "WEEX USDT-M futures",
    risks: { 低: "low risk", 中: "medium risk", 高: "high risk" },
    text: ({ name, profile, performance, period }) => `I found “${name}” on CryptoBot Labs${profile ? `: ${profile}` : ""}. ${performance ? `This fixed version's verified WEEX historical backtest return${period ? ` for ${period}` : ""} is ${performance}. ` : "Review the complete strategy rules, risk controls, and backtest evidence. "}Historical backtests do not guarantee future results.`,
  },
  ar: {
    spot: "سوق WEEX الفوري",
    futures: "عقود WEEX USDT-M الآجلة",
    risks: { 低: "مخاطر منخفضة", 中: "مخاطر متوسطة", 高: "مخاطر مرتفعة" },
    text: ({ name, profile, performance, period }) => `وجدت «${name}» على CryptoBot Labs${profile ? `: ${profile}` : ""}. ${performance ? `عائد الاختبار التاريخي الموثّق على WEEX لهذه النسخة الثابتة${period ? ` للفترة ${period}` : ""} هو ${performance}. ` : "اطّلع على قواعد الاستراتيجية وضوابط المخاطر وأدلة الاختبار التاريخي. "}لا تضمن نتائج الاختبارات التاريخية النتائج المستقبلية.`,
  },
  ru: {
    spot: "спот WEEX",
    futures: "фьючерсы WEEX USDT-M",
    risks: { 低: "низкий риск", 中: "средний риск", 高: "высокий риск" },
    text: ({ name, profile, performance, period }) => `Я нашёл стратегию «${name}» в CryptoBot Labs${profile ? `: ${profile}` : ""}. ${performance ? `Доходность подтверждённого исторического бэктеста WEEX для этой фиксированной версии${period ? ` за период ${period}` : ""}: ${performance}. ` : "Посмотрите полные правила, управление рисками и результаты бэктеста. "}Исторический бэктест не гарантирует будущих результатов.`,
  },
  ja: {
    spot: "WEEX 現物",
    futures: "WEEX USDT-M 先物",
    risks: { 低: "低リスク", 中: "中リスク", 高: "高リスク" },
    text: ({ name, profile, performance, period }) => `CryptoBot Labsで「${name}」を見つけました${profile ? `：${profile}` : ""}。${performance ? `固定版${period ? `（履歴期間：${period}）` : ""}の検証済みWEEX過去データバックテスト総収益率は${performance}です。` : "戦略ルール、リスク管理、バックテスト根拠を確認できます。"}過去のバックテスト結果は将来の成果を保証しません。`,
  },
};

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
}) {
  return [
    { label: "TOTAL RETURN", value: formatSignedReturn(metrics.totalReturn), accent: true },
    { label: "MAX DRAWDOWN", value: formatDrawdownMagnitude(metrics.maxDrawdown) },
    { label: "WIN RATE", value: formatRate(metrics.winRate) },
    { label: "TRADES", value: String(metrics.trades) },
  ];
}

export function buildStrategyShareText(
  input: StrategyShareCopyInput,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const copy = SHARE_COPY[locale];
  const name = compact(input.name) ?? (locale === "en" ? "public strategy" : "公開策略");
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
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
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

export function strategyPosterPath(sharePath: string): string {
  const url = new URL(sharePath, "https://cryptobot.invalid");
  const pathname = url.pathname.replace(/\/+$/, "");
  const version = url.searchParams.get("v");
  const versionQuery = version !== null && /^(?:0|[1-9]\d{0,15})$/.test(version) ? `?v=${version}` : "";
  return `${`${pathname || "/"}/opengraph-image`.replace(/^\/\//, "/")}${versionQuery}`;
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
