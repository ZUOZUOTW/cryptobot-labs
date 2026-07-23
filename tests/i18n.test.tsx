import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/components/I18nProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  LOCALE_STORAGE_KEY,
  matchPreferredLocale,
  PUBLIC_LOCALES,
  resolveRequestLocale,
  SUPPORTED_LOCALES,
} from "@/lib/i18n/locales";
import { canonicalMessageSource, reviewedMessages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/messages";

const originalNavigatorLanguages = navigator.languages;

describe("site internationalization", () => {
  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, "languages", { configurable: true, value: originalNavigatorLanguages });
  });

  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.locale;
    document.documentElement.lang = "zh-Hant";
    document.documentElement.dir = "ltr";
  });

  it("retains all six catalogues while exposing only the five layout-safe locales", () => {
    expect(SUPPORTED_LOCALES.map(({ code }) => code)).toEqual([
      "zh-Hant", "zh-Hans", "en", "ar", "ru", "ja",
    ]);
    expect(PUBLIC_LOCALES.map(({ code }) => code)).toEqual([
      "zh-Hant", "zh-Hans", "en", "ru", "ja",
    ]);
    expect(matchPreferredLocale(["zh-TW"])).toBe("zh-Hant");
    expect(matchPreferredLocale(["zh-Hant-HK"])).toBe("zh-Hant");
    expect(matchPreferredLocale(["zh-CN"])).toBe("zh-Hans");
    expect(matchPreferredLocale(["zh-Hans-CN"])).toBe("zh-Hans");
    expect(matchPreferredLocale(["en-US"])).toBe("en");
    expect(matchPreferredLocale(["ar-SA"])).toBe("zh-Hant");
    expect(matchPreferredLocale(["ar-SA", "en-US"])).toBe("en");
    expect(matchPreferredLocale(["ru-RU"])).toBe("ru");
    expect(matchPreferredLocale(["ja-JP"])).toBe("ja");
    expect(matchPreferredLocale(["fr-FR", "ja-JP"])).toBe("ja");
    expect(matchPreferredLocale(["fr-FR"])).toBe("zh-Hant");
    expect(resolveRequestLocale("cryptobot-locale=ar", "en-US,en;q=0.9")).toBe("en");
    expect(resolveRequestLocale(null, "fr-FR;q=0.8, ja-JP;q=0.9")).toBe("ja");
    expect(resolveRequestLocale(null, "en-US;q=0, ru-RU;q=0.7")).toBe("ru");
  });

  it("keeps every reviewed message catalogue structurally complete", () => {
    const expectedKeys = Object.keys(reviewedMessages.en).sort();
    for (const { code } of SUPPORTED_LOCALES) {
      expect(Object.keys(reviewedMessages[code]).sort()).toEqual(expectedKeys);
      expect(Object.values(reviewedMessages[code]).every((message) => message.trim().length > 0)).toBe(true);
      for (const [source, message] of Object.entries(reviewedMessages[code])) {
        expect((message.match(/__\d+__/gu) ?? []).toSorted(), source)
          .toEqual((source.match(/__\d+__/gu) ?? []).toSorted());
      }
    }
  });

  it("hides Arabic and ignores a previously stored Arabic preference", async () => {
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["en-US"] });
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "ar");
    render(
      <I18nProvider>
        <LanguageSwitcher />
        <p>探索策略</p>
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en");
      expect(document.documentElement.dir).toBe("ltr");
      expect(screen.getByText("Explore strategies")).toBeInTheDocument();
    });
    expect(screen.queryByRole("option", { name: "العربية" })).not.toBeInTheDocument();
  });

  it("automatically applies the browser's preferred supported language", async () => {
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["ja-JP", "en-US"] });
    render(<I18nProvider><p>探索策略</p></I18nProvider>);

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("ja");
      expect(screen.getByText("戦略を探す")).toBeInTheDocument();
    });
  });

  it("uses reviewed placeholder translations for high-risk validation copy", () => {
    expect(translateMessage("en", "BTCUSDT 不在 WEEX API 公告支援的現貨交易對中"))
      .toBe("BTCUSDT is not among the spot trading pairs supported by the WEEX API.");
    expect(translateMessage("ja", "3 筆 · 最近 1h"))
      .toBe("3件 · 最終更新 1h");
    expect(translateMessage("ar", "MARKET DATA")).toBe("بيانات السوق");
    expect(translateMessage("ru", "PAGE NOT FOUND / 404")).toBe("СТРАНИЦА НЕ НАЙДЕНА / 404");
    expect(translateMessage("zh-Hant", "SECURITY CHECK")).toBe("安全驗證");
    expect(canonicalMessageSource("CryptoBot Labs | Automated Trading Strategy Lab"))
      .toBe("CryptoBot Labs｜自動交易策略實驗室");
    expect(canonicalMessageSource("BTCUSDT is not among the spot trading pairs supported by the WEEX API."))
      .toBe("BTCUSDT 不在 WEEX API 公告支援的現貨交易對中");
  });
});
