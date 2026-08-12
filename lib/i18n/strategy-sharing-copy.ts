import type { RiskLevel } from "../types";
import type { Locale } from "./locales";

export interface ShareLocaleCopy {
  fallbackName: string;
  spot: string;
  futures: string;
  risks: Record<RiskLevel, string>;
  dialogTitle: (name: string) => string;
  posterPreviewAlt: (name: string) => string;
  text: (input: { name: string; profile: string; performance: string | null; period: string | null }) => string;
}

export interface StrategyPosterLocaleCopy {
  officialBadge: string;
  verifiedBadge: string;
  officialPublisher: string;
  spot: string;
  futures: string;
  riskValues: Record<RiskLevel, string>;
  metricLabels: {
    market: string; timeframe: string; risk: string; modules: string;
    totalReturn: string; maxDrawdown: string; winRate: string; trades: string;
  };
  moduleCount: (count: number) => string;
  publisherPrefix: string;
  publisherSuffix: string;
  officialDisclosure: string;
  memberDisclosure: (historicalPeriod: string | null) => string;
  callToAction: string;
}

export const STRATEGY_SHARE_COPY: Record<Locale, ShareLocaleCopy> = {
  "zh-Hant": {
    fallbackName: "公開策略", spot: "WEEX 現貨", futures: "WEEX USDT-M 合約",
    risks: { 低: "低風險", 中: "中風險", 高: "高風險" },
    dialogTitle: (name) => `分享「${name}」`, posterPreviewAlt: (name) => `${name} 社群分享海報預覽`,
    text: ({ name, profile, performance, period }) => `我在 CryptoBot Labs 發現「${name}」${profile ? `：${profile}` : ""}。${performance ? `固定版本${period ? `在 ${period} 歷史區間` : ""}的 WEEX 歷史回測總報酬為 ${performance}。` : "查看完整策略規則、風控與回測證據。"}歷史回測不代表未來績效。`,
  },
  "zh-Hans": {
    fallbackName: "公开策略", spot: "WEEX 现货", futures: "WEEX USDT-M 合约",
    risks: { 低: "低风险", 中: "中风险", 高: "高风险" },
    dialogTitle: (name) => `分享“${name}”`, posterPreviewAlt: (name) => `${name} 社交分享海报预览`,
    text: ({ name, profile, performance, period }) => `我在 CryptoBot Labs 发现“${name}”${profile ? `：${profile}` : ""}。${performance ? `固定版本${period ? `在 ${period} 历史区间` : ""}的 WEEX 历史回测总收益为 ${performance}。` : "查看完整策略规则、风控和回测证据。"}历史回测不代表未来表现。`,
  },
  en: {
    fallbackName: "public strategy", spot: "WEEX spot", futures: "WEEX USDT-M futures",
    risks: { 低: "low risk", 中: "medium risk", 高: "high risk" },
    dialogTitle: (name) => `Share “${name}”`, posterPreviewAlt: (name) => `${name} social sharing poster preview`,
    text: ({ name, profile, performance, period }) => `I found “${name}” on CryptoBot Labs${profile ? `: ${profile}` : ""}. ${performance ? `This fixed version's verified WEEX historical backtest return${period ? ` for ${period}` : ""} is ${performance}. ` : "Review the complete strategy rules, risk controls, and backtest evidence. "}Historical backtests do not guarantee future results.`,
  },
  ar: {
    fallbackName: "استراتيجية عامة", spot: "سوق WEEX الفوري", futures: "عقود WEEX USDT-M الآجلة",
    risks: { 低: "مخاطر منخفضة", 中: "مخاطر متوسطة", 高: "مخاطر مرتفعة" },
    dialogTitle: (name) => `مشاركة «${name}»`, posterPreviewAlt: (name) => `معاينة ملصق مشاركة ${name}`,
    text: ({ name, profile, performance, period }) => `وجدت «${name}» على CryptoBot Labs${profile ? `: ${profile}` : ""}. ${performance ? `عائد الاختبار التاريخي الموثّق على WEEX لهذه النسخة الثابتة${period ? ` للفترة ${period}` : ""} هو ${performance}. ` : "اطّلع على قواعد الاستراتيجية وضوابط المخاطر وأدلة الاختبار التاريخي. "}لا تضمن نتائج الاختبارات التاريخية النتائج المستقبلية.`,
  },
  ru: {
    fallbackName: "публичная стратегия", spot: "спот WEEX", futures: "фьючерсы WEEX USDT-M",
    risks: { 低: "низкий риск", 中: "средний риск", 高: "высокий риск" },
    dialogTitle: (name) => `Поделиться стратегией «${name}»`, posterPreviewAlt: (name) => `Предпросмотр постера стратегии «${name}»`,
    text: ({ name, profile, performance, period }) => `Я нашёл стратегию «${name}» в CryptoBot Labs${profile ? `: ${profile}` : ""}. ${performance ? `Доходность подтверждённого исторического бэктеста WEEX для этой фиксированной версии${period ? ` за период ${period}` : ""}: ${performance}. ` : "Посмотрите полные правила, управление рисками и результаты бэктеста. "}Исторический бэктест не гарантирует будущих результатов.`,
  },
  ja: {
    fallbackName: "公開戦略", spot: "WEEX 現物", futures: "WEEX USDT-M 先物",
    risks: { 低: "低リスク", 中: "中リスク", 高: "高リスク" },
    dialogTitle: (name) => `「${name}」を共有`, posterPreviewAlt: (name) => `${name}のソーシャル共有ポスターのプレビュー`,
    text: ({ name, profile, performance, period }) => `CryptoBot Labsで「${name}」を見つけました${profile ? `：${profile}` : ""}。${performance ? `固定版${period ? `（履歴期間：${period}）` : ""}の検証済みWEEX過去データバックテスト総収益率は${performance}です。` : "戦略ルール、リスク管理、バックテスト根拠を確認できます。"}過去のバックテスト結果は将来の成果を保証しません。`,
  },
};

export const STRATEGY_POSTER_COPY: Record<Locale, StrategyPosterLocaleCopy> = {
  "zh-Hant": {
    officialBadge: "官方策略", verifiedBadge: "已驗證歷史回測", officialPublisher: "CryptoBot Labs 研究團隊",
    spot: "WEEX 現貨", futures: "WEEX USDT-M 合約", riskValues: { 低: "低風險", 中: "中風險", 高: "高風險" },
    metricLabels: { market: "市場", timeframe: "週期", risk: "風險", modules: "模組", totalReturn: "總報酬", maxDrawdown: "最大回撤", winRate: "勝率", trades: "交易次數" },
    moduleCount: (count) => `${count} 個`, publisherPrefix: "由 ", publisherSuffix: " 發布 · 公開固定版本",
    officialDisclosure: "策略規格預覽 · 歷史回測不代表未來績效",
    memberDisclosure: (period) => `${period ? `歷史區間 ${period} · ` : ""}固定版本歷史證據 · 歷史回測不代表未來績效`, callToAction: "查看策略與完整證據 →",
  },
  "zh-Hans": {
    officialBadge: "官方策略", verifiedBadge: "已验证历史回测", officialPublisher: "CryptoBot Labs 研究团队",
    spot: "WEEX 现货", futures: "WEEX USDT-M 合约", riskValues: { 低: "低风险", 中: "中风险", 高: "高风险" },
    metricLabels: { market: "市场", timeframe: "周期", risk: "风险", modules: "模块", totalReturn: "总收益", maxDrawdown: "最大回撤", winRate: "胜率", trades: "交易次数" },
    moduleCount: (count) => `${count} 个`, publisherPrefix: "由 ", publisherSuffix: " 发布 · 公开固定版本",
    officialDisclosure: "策略规格预览 · 历史回测不代表未来表现",
    memberDisclosure: (period) => `${period ? `历史区间 ${period} · ` : ""}固定版本历史证据 · 历史回测不代表未来表现`, callToAction: "查看策略与完整证据 →",
  },
  en: {
    officialBadge: "OFFICIAL STRATEGY", verifiedBadge: "VERIFIED HISTORICAL BACKTEST", officialPublisher: "CryptoBot Labs Research Team",
    spot: "WEEX spot", futures: "WEEX USDT-M futures", riskValues: { 低: "Low risk", 中: "Medium risk", 高: "High risk" },
    metricLabels: { market: "MARKET", timeframe: "TIMEFRAME", risk: "RISK", modules: "MODULES", totalReturn: "TOTAL RETURN", maxDrawdown: "MAX DRAWDOWN", winRate: "WIN RATE", trades: "TRADES" },
    moduleCount: String, publisherPrefix: "Published by ", publisherSuffix: " · Public fixed version",
    officialDisclosure: "Strategy specification preview · Backtests do not predict future performance",
    memberDisclosure: (period) => `${period ? `Historical period ${period} · ` : ""}Fixed-version evidence · Backtests do not predict future performance`, callToAction: "View strategy and full evidence →",
  },
  ar: {
    officialBadge: "استراتيجية رسمية", verifiedBadge: "اختبار تاريخي موثّق", officialPublisher: "فريق أبحاث CryptoBot Labs",
    spot: "سوق WEEX الفوري", futures: "عقود WEEX USDT-M الآجلة", riskValues: { 低: "مخاطر منخفضة", 中: "مخاطر متوسطة", 高: "مخاطر مرتفعة" },
    metricLabels: { market: "السوق", timeframe: "الإطار الزمني", risk: "المخاطر", modules: "الوحدات", totalReturn: "إجمالي العائد", maxDrawdown: "أقصى تراجع", winRate: "نسبة الفوز", trades: "الصفقات" },
    moduleCount: String, publisherPrefix: "نشرها ", publisherSuffix: " · إصدار عام ثابت",
    officialDisclosure: "معاينة مواصفات الاستراتيجية · لا تتنبأ الاختبارات التاريخية بالأداء المستقبلي",
    memberDisclosure: (period) => `${period ? `الفترة التاريخية ${period} · ` : ""}أدلة إصدار ثابت · لا تتنبأ الاختبارات التاريخية بالأداء المستقبلي`, callToAction: "عرض الاستراتيجية والأدلة الكاملة ←",
  },
  ru: {
    officialBadge: "ОФИЦИАЛЬНАЯ СТРАТЕГИЯ", verifiedBadge: "ПРОВЕРЕННЫЙ БЭКТЕСТ", officialPublisher: "Исследовательская команда CryptoBot Labs",
    spot: "спот WEEX", futures: "фьючерсы WEEX USDT-M", riskValues: { 低: "Низкий риск", 中: "Средний риск", 高: "Высокий риск" },
    metricLabels: { market: "РЫНОК", timeframe: "ТАЙМФРЕЙМ", risk: "РИСК", modules: "МОДУЛИ", totalReturn: "ДОХОДНОСТЬ", maxDrawdown: "МАКС. ПРОСАДКА", winRate: "ДОЛЯ ПОБЕД", trades: "СДЕЛКИ" },
    moduleCount: String, publisherPrefix: "Автор: ", publisherSuffix: " · Публичная фиксированная версия",
    officialDisclosure: "Предпросмотр спецификации · Бэктест не прогнозирует будущие результаты",
    memberDisclosure: (period) => `${period ? `Исторический период ${period} · ` : ""}Данные фиксированной версии · Бэктест не прогнозирует будущие результаты`, callToAction: "Открыть стратегию и данные →",
  },
  ja: {
    officialBadge: "公式戦略", verifiedBadge: "検証済み過去バックテスト", officialPublisher: "CryptoBot Labs リサーチチーム",
    spot: "WEEX 現物", futures: "WEEX USDT-M 先物", riskValues: { 低: "低リスク", 中: "中リスク", 高: "高リスク" },
    metricLabels: { market: "市場", timeframe: "時間足", risk: "リスク", modules: "モジュール", totalReturn: "総収益率", maxDrawdown: "最大ドローダウン", winRate: "勝率", trades: "取引回数" },
    moduleCount: (count) => `${count}個`, publisherPrefix: "", publisherSuffix: " が公開 · 固定バージョン",
    officialDisclosure: "戦略仕様のプレビュー · バックテストは将来の成果を保証しません",
    memberDisclosure: (period) => `${period ? `履歴期間 ${period} · ` : ""}固定バージョンの履歴証拠 · バックテストは将来の成果を保証しません`, callToAction: "戦略と完全な根拠を見る →",
  },
};
