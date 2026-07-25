"use client";

import { useId } from "react";
import { localeDirection, PUBLIC_LOCALES, type Locale } from "@/lib/i18n/locales";
import { useI18n } from "./I18nProvider";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const labelId = useId();

  return (
    <div className="language-switcher" data-i18n-ignore>
      <label className="sr-only" htmlFor={labelId}>{t("選擇語言")}</label>
      <span aria-hidden="true" className="language-switcher__icon">文</span>
      <select
        aria-label={t("選擇語言")}
        id={labelId}
        onChange={(event) => setLocale(event.target.value as Locale)}
        value={locale}
      >
        {PUBLIC_LOCALES.map(({ code, label }) => (
          <option dir={localeDirection(code)} key={code} lang={code} value={code}>{label}</option>
        ))}
      </select>
    </div>
  );
}
