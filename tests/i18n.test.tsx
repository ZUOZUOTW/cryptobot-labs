import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/components/I18nProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { BotCard } from "@/components/BotCard";
import { BOT_CATALOG } from "@/data/bots";
import { verifiedHistoricalPerformance } from "./fixtures/verified-historical-performance";
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

  it("translates responsive table labels that remain visible when headers are hidden", async () => {
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["en-US"] });
    render(
      <I18nProvider>
        <table><tbody><tr><td data-label="市場">BTCUSDT</td></tr></tbody></table>
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("BTCUSDT")).toHaveAttribute("data-label", translateMessage("en", "市場"));
    });
  });

  it("localizes official strategy names inside dynamic card action labels", async () => {
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["en-US"] });
    const bot = BOT_CATALOG.find(({ id }) => id === "momentum-forge")!;
    const performance = verifiedHistoricalPerformance(bot, {
      collectedAt: Date.parse("2026-08-01T00:00:00.000Z"),
      datasetDigest: "a".repeat(64),
    });
    render(
      <I18nProvider>
        <BotCard bot={bot} historicalPerformance={performance} onFavorite={() => undefined} />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Favorite Momentum Creator" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "View strategy: Momentum Creator" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Apply directly: Momentum Creator" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch strategy: Momentum Creator" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download strategy: Momentum Creator" })).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Momentum Creator equity curve" })).toBeInTheDocument();
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

  it("keeps workshop backtest assumptions semantically distinct in every catalogue", () => {
    const expectations = [
      ["zh-Hant", {
        "最近 30 天回測假設": "最近 30 天回測假設",
        "手續費率": "手續費率",
        "滑價率": "滑價率",
        "資金費率": "資金費率",
        "資料缺口": "資料缺口",
        "歷史資金費率": "歷史資金費率",
        "不計入": "不計入",
        "遇缺口即停止": "遇缺口即停止",
        "揭露缺口並繼續": "揭露缺口並繼續",
        "驗證設定": "驗證設定",
      }],
      ["zh-Hans", {
        "最近 30 天回測假設": "最近 30 天回测假设",
        "手續費率": "手续费率",
        "滑價率": "滑点率",
        "資金費率": "资金费率",
        "資料缺口": "数据缺口",
        "歷史資金費率": "使用历史资金费率",
        "不計入": "不计入",
        "遇缺口即停止": "遇到数据缺口即停止",
        "揭露缺口並繼續": "披露数据缺口并继续",
        "驗證設定": "验证设置",
      }],
      ["en", {
        "最近 30 天回測假設": "Backtest assumptions for the last 30 days",
        "手續費率": "Trading fee rate",
        "滑價率": "Slippage rate",
        "資金費率": "Funding rate",
        "資料缺口": "Data gaps",
        "歷史資金費率": "Use historical funding rates",
        "不計入": "Do not include",
        "遇缺口即停止": "Stop if a data gap is found",
        "揭露缺口並繼續": "Disclose data gaps and continue",
        "驗證設定": "Validating settings",
      }],
      ["ar", {
        "最近 30 天回測假設": "افتراضات الاختبار التاريخي لآخر 30 يومًا",
        "手續費率": "معدل رسوم التداول",
        "滑價率": "نسبة الانزلاق السعري",
        "資金費率": "معدل التمويل",
        "資料缺口": "فجوات البيانات",
        "歷史資金費率": "استخدام معدلات التمويل التاريخية",
        "不計入": "عدم الاحتساب",
        "遇缺口即停止": "التوقف عند العثور على فجوة بيانات",
        "揭露缺口並繼續": "الإفصاح عن فجوات البيانات والمتابعة",
        "驗證設定": "جارٍ التحقق من الإعدادات",
      }],
      ["ru", {
        "最近 30 天回測假設": "Допущения бэктеста за последние 30 дней",
        "手續費率": "Ставка торговой комиссии",
        "滑價率": "Коэффициент проскальзывания",
        "資金費率": "Ставка финансирования",
        "資料缺口": "Пробелы в данных",
        "歷史資金費率": "Учитывать исторические ставки финансирования",
        "不計入": "Не учитывать",
        "遇缺口即停止": "Остановиться при обнаружении пробела в данных",
        "揭露缺口並繼續": "Раскрыть пробелы в данных и продолжить",
        "驗證設定": "Проверка настроек",
      }],
      ["ja", {
        "最近 30 天回測假設": "直近30日間のバックテスト条件",
        "手續費率": "取引手数料率",
        "滑價率": "スリッページ率",
        "資金費率": "資金調達率",
        "資料缺口": "データ欠損",
        "歷史資金費率": "過去の資金調達率を使用",
        "不計入": "含めない",
        "遇缺口即停止": "データ欠損があれば停止",
        "揭露缺口並繼續": "データ欠損を開示して続行",
        "驗證設定": "設定を検証中",
      }],
    ] as const;

    for (const [locale, translations] of expectations) {
      for (const [source, expected] of Object.entries(translations)) {
        expect(translateMessage(locale, source), `${locale}: ${source}`).toBe(expected);
      }
    }

    expect(translateMessage("en", "重設手續費率為預設值"))
      .toBe("Reset Trading fee rate to default value");
    expect(translateMessage("ja", "重設資金費率為預設值"))
      .toBe("資金調達率をデフォルト値にリセット");
  });
});
