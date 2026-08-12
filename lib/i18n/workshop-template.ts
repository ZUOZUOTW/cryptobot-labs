import type { Locale } from "./locales";

const TEMPLATE_COPY: Readonly<Record<Locale, {
  sample: string;
  sandbox: string;
  unnamed: string;
}>> = {
  "zh-Hant": { sample: "CryptoBot Labs 的模擬策略範例。", sandbox: "歷史回測只會在隔離沙箱中執行此函式。", unnamed: "未命名策略" },
  "zh-Hans": { sample: "CryptoBot Labs 的模拟策略范例。", sandbox: "历史回测只会在隔离沙箱中执行此函数。", unnamed: "未命名策略" },
  en: { sample: "Example of a simulated strategy for CryptoBot Labs.", sandbox: "Historical backtests run this function only in an isolated sandbox.", unnamed: "Unnamed Strategy" },
  ar: { sample: "مثال على استراتيجية محاكاة لـ CryptoBot Labs.", sandbox: "لا تُشغِّل الاختبارات التاريخية هذه الدالة إلا داخل بيئة معزولة.", unnamed: "استراتيجية بدون اسم" },
  ru: { sample: "Пример смоделированной стратегии для CryptoBot Labs.", sandbox: "Исторические бэктесты запускают эту функцию только в изолированной песочнице.", unnamed: "Стратегия без названия" },
  ja: { sample: "CryptoBot Labs におけるシミュレーション戦略の例。", sandbox: "履歴バックテストは、この関数を隔離サンドボックス内でのみ実行します。", unnamed: "名前が指定されていない戦略" },
};

export function localizedWorkshopTemplateCopy(locale: Locale) {
  return TEMPLATE_COPY[locale];
}
