"use client";

import type { StrategyParameter } from "../lib/types";
import type { Locale } from "../lib/i18n/locales";
import { useI18n } from "./I18nProvider";

const localizedUnit: Partial<Record<NonNullable<StrategyParameter["suffix"]>, Intl.NumberFormatOptions["unit"]>> = {
  "天": "day",
  "小時": "hour",
};

function parameterValue(parameter: StrategyParameter, locale: Locale, translate: (source: string) => string): string {
  if (!parameter.suffix) return String(parameter.value);
  const unit = localizedUnit[parameter.suffix];
  if (unit) {
    return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(parameter.value);
  }
  if (parameter.suffix === "%") return `${parameter.value}%`;
  const separator = locale === "zh-Hant" || locale === "zh-Hans" || locale === "ja" ? "" : " ";
  return `${parameter.value}${separator}${translate(parameter.suffix)}`;
}

export function StrategyParameterSummary({ parameters }: { parameters: readonly StrategyParameter[] }) {
  const { locale, t } = useI18n();
  const summary = parameters.map((parameter) => (
    `${t(parameter.label)} ${parameterValue(parameter, locale, t)}`
  )).join(" · ");

  return <>{summary || t("無額外參數")}</>;
}
