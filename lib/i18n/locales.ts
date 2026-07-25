export const SUPPORTED_LOCALES = [
  { code: "zh-Hant", label: "繁體中文", dir: "ltr" },
  { code: "zh-Hans", label: "简体中文", dir: "ltr" },
  { code: "en", label: "English", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "ru", label: "Русский", dir: "ltr" },
  { code: "ja", label: "日本語", dir: "ltr" },
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number]["code"];

// Arabic remains fully translated so it can be re-enabled after the layout is
// tightened, but it is temporarily excluded from public selection/detection.
export const PUBLIC_LOCALES = SUPPORTED_LOCALES.filter(({ code }) => code !== "ar");

export const DEFAULT_LOCALE: Locale = "zh-Hant";
export const LOCALE_STORAGE_KEY = "cryptobot-labs.locale";

export function isLocale(value: unknown): value is Locale {
  return SUPPORTED_LOCALES.some(({ code }) => code === value);
}

export function isPublicLocale(value: unknown): value is Exclude<Locale, "ar"> {
  return PUBLIC_LOCALES.some(({ code }) => code === value);
}

export function localeDirection(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function openGraphLocale(locale: Locale): string {
  return {
    "zh-Hant": "zh_TW",
    "zh-Hans": "zh_CN",
    en: "en_US",
    ar: "ar_SA",
    ru: "ru_RU",
    ja: "ja_JP",
  }[locale];
}

export function matchPreferredLocale(languageTags: readonly string[]): Locale {
  for (const languageTag of languageTags) {
    const normalized = languageTag.trim().toLowerCase().replaceAll("_", "-");

    if (normalized === "zh-hant" || normalized.startsWith("zh-hant-") || normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk") || normalized.startsWith("zh-mo")) {
      return "zh-Hant";
    }
    if (normalized === "zh-hans" || normalized.startsWith("zh-hans-") || normalized.startsWith("zh-cn") || normalized.startsWith("zh-sg") || normalized === "zh") {
      return "zh-Hans";
    }
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
    if (normalized === "ru" || normalized.startsWith("ru-")) return "ru";
    if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  }

  return DEFAULT_LOCALE;
}

export function resolveInitialLocale(
  storedLocale: string | null,
  languageTags: readonly string[],
): Locale {
  return isPublicLocale(storedLocale) ? storedLocale : matchPreferredLocale(languageTags);
}

export function resolveRequestLocale(cookieHeader: string | null, acceptLanguage: string | null): Locale {
  const cookieLocale = cookieHeader
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === "cryptobot-locale")?.[1];
  if (cookieLocale) {
    try {
      const decoded = decodeURIComponent(cookieLocale);
      if (isPublicLocale(decoded)) return decoded;
    } catch {
      // Ignore malformed cookie values and continue with Accept-Language.
    }
  }

  const preferredTags = (acceptLanguage ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return { tag, quality: quality ? Number(quality.trim().slice(2)) || 0 : 1, index };
    })
    .filter(({ tag, quality }) => Boolean(tag) && tag !== "*" && quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index)
    .map(({ tag }) => tag);
  return matchPreferredLocale(preferredTags);
}
