import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../components/I18nProvider";
import { StrategyPosterCard, fitStrategyPosterText, strategyPosterTextUnits } from "../components/StrategyPosterCard";
import { StrategyShareActions } from "../components/StrategyShareActions";
import { resolveStrategyPosterAssetOrigin } from "../lib/server/strategy-poster-origin";
import {
  buildStrategyShareText,
  buildMemberStrategyPosterMetrics,
  formatDrawdownMagnitude,
  formatHistoricalPeriod,
  formatIsoHistoricalPeriod,
  formatRate,
  formatSignedReturn,
  socialShareUrl,
  strategyPosterFilename,
  strategyPosterPath,
} from "../lib/strategy-sharing";

const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");
const originalCanShare = Object.getOwnPropertyDescriptor(navigator, "canShare");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const restoreNavigatorProperty = (name: "share" | "canShare" | "clipboard", descriptor: PropertyDescriptor | undefined) => {
  if (descriptor) Object.defineProperty(navigator, name, descriptor);
  else Reflect.deleteProperty(navigator, name);
};

const nativeShare = (share = vi.fn().mockResolvedValue(undefined), canShare = vi.fn().mockReturnValue(true)) => {
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: canShare });
  return { canShare, share };
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  restoreNavigatorProperty("share", originalShare);
  restoreNavigatorProperty("canShare", originalCanShare);
  restoreNavigatorProperty("clipboard", originalClipboard);
  if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
  else Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("strategy poster asset origin", () => {
  const requestHeaders = (host: string) => new Headers({ host });

  it("uses only configured PUBLIC_ORIGIN in production and ignores an attacker Host", () => {
    expect(resolveStrategyPosterAssetOrigin({
      nodeEnv: "production",
      publicOrigin: "https://app.example.test",
      requestHeaders: requestHeaders("169.254.169.254"),
    }).href).toBe("https://app.example.test/");
  });

  it("fails closed without PUBLIC_ORIGIN or with an unsafe configured origin", () => {
    expect(() => resolveStrategyPosterAssetOrigin({
      nodeEnv: "production",
      publicOrigin: undefined,
      requestHeaders: requestHeaders("attacker.example"),
    })).toThrow(/PUBLIC_ORIGIN is required/);
    expect(() => resolveStrategyPosterAssetOrigin({
      nodeEnv: "production",
      publicOrigin: "http://metadata.internal/latest",
      requestHeaders: requestHeaders("app.example.test"),
    })).toThrow(/PUBLIC_ORIGIN is invalid/);
  });

  it("allows request-derived origins only for loopback development", () => {
    expect(resolveStrategyPosterAssetOrigin({
      nodeEnv: "development",
      publicOrigin: undefined,
      requestHeaders: requestHeaders("localhost:3108"),
    }).href).toBe("http://localhost:3108/");
    expect(() => resolveStrategyPosterAssetOrigin({
      nodeEnv: "development",
      publicOrigin: undefined,
      requestHeaders: requestHeaders("internal.example"),
    })).toThrow(/PUBLIC_ORIGIN is required/);
  });
});

describe("strategy poster copy fitting", () => {
  it("bounds 100-character strategy and publisher names without control or bidi characters", () => {
    const longName = `\u202e${"超長策略名稱".repeat(17)}`.slice(0, 100);
    const longUnbrokenLatinName = "m".repeat(100);
    const longPublisher = "W".repeat(100);
    const fittedName = fitStrategyPosterText(longName, 44);
    const fittedUnbrokenLatinName = fitStrategyPosterText(longUnbrokenLatinName, 44);
    const fittedPublisher = fitStrategyPosterText(longPublisher, 36);

    expect(fittedName.endsWith("…")).toBe(true);
    expect(fittedName).not.toContain("\u202e");
    expect(strategyPosterTextUnits(fittedName)).toBeLessThanOrEqual(44);
    expect(fittedUnbrokenLatinName.endsWith("…")).toBe(true);
    expect(strategyPosterTextUnits(fittedUnbrokenLatinName)).toBeLessThanOrEqual(44);
    expect(fittedPublisher.endsWith("…")).toBe(true);
    expect(strategyPosterTextUnits(fittedPublisher)).toBeLessThanOrEqual(36);

    render(<StrategyPosterCard
      badge="VERIFIED"
      context="WEEX · BTCUSDT · 4H"
      disclosure="Historical backtest"
      mascotSrc="data:image/png;base64,iVBORw0KGgo="
      metrics={[{ label: "RETURN", value: "+1.0%" }]}
      name={longName}
      publisher={longPublisher}
    />);
    expect(screen.queryByText(longName)).not.toBeInTheDocument();
    expect(screen.getByText(fittedName)).toHaveStyle({ wordBreak: "break-all" });
    expect(screen.getAllByText(/…/)).toHaveLength(2);
    expect(fitStrategyPosterText("CryptoBot\u200BLabs 官方", 44)).toBe("CryptoBotLabs 官方");
  });

});

describe("strategy share copy", () => {
  const historicalPeriod = {
    startAt: Date.UTC(2024, 0, 2),
    endAt: Date.UTC(2024, 1, 3),
  };

  it("builds useful market, timeframe, and risk copy without inventing performance", () => {
    const copy = buildStrategyShareText({
      name: "軌道定投",
      marketKind: "spot",
      timeframe: "4h",
      riskLevel: "低",
    });

    expect(copy).toContain("軌道定投");
    expect(copy).toContain("WEEX 現貨 · 4H · 低風險");
    expect(copy).toContain("查看完整策略規則、風控與回測證據");
    expect(copy).toContain("歷史回測不代表未來績效");
    expect(copy).not.toMatch(/報酬為|勝率為/);
  });

  it("includes verified performance and only its real historical window", () => {
    const verified = buildStrategyShareText({
      name: "會員策略",
      verifiedPerformance: {
        historicalPeriod,
        kind: "total-return",
        value: "+12.00%",
        verified: true,
      },
    });
    const unverified = buildStrategyShareText({
      name: "會員策略",
      verifiedPerformance: { kind: "total-return", value: "+99%", verified: false } as never,
    });

    expect(verified).toContain("WEEX 歷史回測總報酬為 +12.00%");
    expect(verified).toContain(formatHistoricalPeriod(historicalPeriod, "zh-Hant"));
    expect(unverified).not.toContain("+99%");
    expect(formatIsoHistoricalPeriod(historicalPeriod.startAt, historicalPeriod.endAt)).toBe("2024-01-02–2024-02-03");
    expect(formatIsoHistoricalPeriod(null, historicalPeriod.endAt)).toBeNull();
  });

  it("removes bidi and invisible characters from every outbound strategy name", () => {
    const bidi = buildStrategyShareText({ name: "SAFE\u202Egpj.exe", marketKind: "spot" }, "en");
    const zeroWidth = buildStrategyShareText({ name: "CryptoBot\u200BLabs 官方", marketKind: "spot" });

    expect(bidi).toContain("SAFEgpj.exe");
    expect(bidi).not.toContain("\u202E");
    expect(zeroWidth).toContain("CryptoBotLabs 官方");
    expect(zeroWidth).not.toContain("\u200B");
  });

  it("formats member poster metrics according to their financial meaning", () => {
    expect(formatSignedReturn("0.08")).toBe("+8.0%");
    expect(formatSignedReturn("-0.08")).toBe("-8.0%");
    expect(formatDrawdownMagnitude("0.08")).toBe("8.0%");
    expect(formatDrawdownMagnitude("-0.08")).toBe("8.0%");
    expect(formatRate("0.08")).toBe("8.0%");
    expect(formatRate("0.08")).not.toContain("+");
    expect(buildMemberStrategyPosterMetrics({
      maxDrawdown: "0.08",
      totalReturn: "0.08",
      trades: 42,
      winRate: "0.08",
    }, "en")).toEqual([
      { accent: true, label: "TOTAL RETURN", value: "+8.0%" },
      { label: "MAX DRAWDOWN", value: "8.0%" },
      { label: "WIN RATE", value: "8.0%" },
      { label: "TRADES", value: "42" },
    ]);
  });

  it("generates fully localized English and Japanese external payloads", () => {
    const input = {
      name: "Atlas Strategy",
      marketKind: "spot" as const,
      riskLevel: "低" as const,
      timeframe: "4h",
      verifiedPerformance: {
        historicalPeriod,
        kind: "total-return" as const,
        value: "+12.00%",
        verified: true as const,
      },
    };
    const english = buildStrategyShareText(input, "en");
    const japanese = buildStrategyShareText(input, "ja");

    expect(english).toContain("I found “Atlas Strategy”");
    expect(english).toContain("WEEX spot · 4H · low risk");
    expect(english).toContain("verified WEEX historical backtest return");
    expect(english).not.toMatch(/[現貨風險績效]/u);
    expect(japanese).toContain("CryptoBot Labsで「Atlas Strategy」を見つけました");
    expect(japanese).toContain("WEEX 現物 · 4H · 低リスク");
    expect(japanese).toContain("過去のバックテスト結果は将来の成果を保証しません");
  });

  it("supports every configured locale and creates stable social URLs", () => {
    for (const locale of ["zh-Hant", "zh-Hans", "en", "ar", "ru", "ja"] as const) {
      expect(buildStrategyShareText({ name: "Atlas", marketKind: "futures" }, locale).length).toBeGreaterThan(40);
    }
    expect(strategyPosterPath("/strategies/member-alpha?via=demo")).toBe("/strategies/member-alpha/opengraph-image");
    expect(strategyPosterPath("/strategies/member-alpha?v=1707080400000&via=demo"))
      .toBe("/strategies/member-alpha/opengraph-image?v=1707080400000");
    expect(strategyPosterPath("/strategies/member-alpha?v=unsafe-version"))
      .toBe("/strategies/member-alpha/opengraph-image");
    expect(strategyPosterPath("/bots/orbit-dca?locale=en", "en"))
      .toBe("/api/strategy-posters/bots/orbit-dca/en");
    expect(strategyPosterPath("/strategies/member-alpha?v=1707080400000&locale=ja"))
      .toBe("/api/strategy-posters/strategies/member-alpha/ja?v=1707080400000");
    expect(strategyPosterFilename("Member Alpha!")).toBe("cryptobot-member-alpha-poster.png");
    expect(socialShareUrl("line", { text: "策略文案", url: "https://example.test/bots/a" }))
      .toContain("https://line.me/R/share?text=");
    expect(decodeURIComponent(socialShareUrl("facebook", { text: "策略文案", url: "https://example.test/bots/a" })))
      .toContain("quote=策略文案");
  });
});

describe("strategy poster share dialog", () => {
  it("shows the generated poster, caption controls, and traps focus until Escape closes it", async () => {
    const user = userEvent.setup();
    render(
      <StrategyShareActions
        botId="orbit-dca"
        botName="軌道定投"
        marketKind="spot"
        riskLevel="低"
        timeframe="4h"
      />,
    );

    const trigger = screen.getByRole("button", { name: "分享海報" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "分享「軌道定投」" });
    expect(within(dialog).getByRole("img", { name: "軌道定投 社群分享海報預覽" }))
      .toHaveAttribute("src", "/api/strategy-posters/bots/orbit-dca/zh-Hant");
    expect(within(dialog).getByRole("button", { name: "下載海報" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "複製文案" })).toBeInTheDocument();
    expect(within(dialog).getByText(/WEEX 現貨 · 4H · 低風險/)).toBeInTheDocument();

    const close = within(dialog).getByRole("button", { name: "關閉分享海報" });
    await waitFor(() => expect(close).toHaveFocus());
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Telegram" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("preloads the PNG on dialog open and attaches the ready File without awaiting in the click", async () => {
    const { canShare, share } = nativeShare();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("png", {
      headers: { "content-type": "image/png" },
      status: 200,
    }));

    const user = userEvent.setup();
    render(
      <StrategyShareActions
        botId="member-alpha"
        botName="會員 Alpha 策略"
        marketKind="futures"
        sharePath="/strategies/member-alpha?v=1707080400000"
        timeframe="1h"
        verifiedPerformance={{
          historicalPeriod: { startAt: Date.UTC(2024, 0, 2), endAt: Date.UTC(2024, 1, 3) },
          kind: "total-return",
          value: "+12.00%",
          verified: true,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "分享海報" }));
    await waitFor(() => expect(document.querySelector('[data-poster-preparation="ready"]')).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "系統分享（支援時附上 PNG）" }));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/strategy-posters/strategies/member-alpha/zh-Hant?v=1707080400000",
      { cache: "force-cache", credentials: "same-origin" },
    );
    expect(canShare).toHaveBeenCalledTimes(2);
    expect(share).toHaveBeenCalledTimes(1);
    const shareData = share.mock.calls[0]?.[0] as ShareData;
    expect(shareData.text).toContain("WEEX 歷史回測總報酬為 +12.00%");
    expect(shareData.text).toContain("2024");
    expect(shareData.url).toBe("http://localhost:3000/strategies/member-alpha?v=1707080400000&locale=zh-Hant");
    expect(shareData.files).toHaveLength(1);
    expect(shareData.files?.[0]).toMatchObject({ name: "cryptobot-member-alpha-poster.png", type: "image/png" });
    expect(await screen.findByRole("status")).toHaveTextContent("海報 PNG 已一併附上");
  });

  it("calls native share immediately with text and URL when preload is still pending", async () => {
    const events: string[] = [];
    let resolvePoster!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      events.push("fetch-started");
      return new Promise<Response>((resolve) => { resolvePoster = resolve; });
    });
    const share = vi.fn<(data?: ShareData) => Promise<void>>(() => {
      events.push("share-called");
      return Promise.resolve();
    });
    nativeShare(share);

    const user = userEvent.setup();
    render(<StrategyShareActions botId="orbit-dca" botName={"SAFE\u202Egpj.exe"} marketKind="spot" timeframe="4h" />);
    await user.click(screen.getByRole("button", { name: "分享海報" }));
    expect(events).toEqual(["fetch-started"]);
    await user.click(screen.getByRole("button", { name: "系統分享（支援時附上 PNG）" }));

    expect(events).toEqual(["fetch-started", "share-called"]);
    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.any(String),
      title: "SAFEgpj.exe｜CryptoBot Labs",
      url: "http://localhost:3000/bots/orbit-dca?locale=zh-Hant",
    }));
    const sharePayload = share.mock.calls[0]?.[0] as ShareData;
    expect(sharePayload.files).toBeUndefined();
    expect(sharePayload.text).not.toContain("\u202E");

    resolvePoster(new Response("png", {
      headers: { "content-type": "image/png" },
      status: 200,
    }));
  });

  it("uses current English locale for clipboard payload and Japanese locale for social payload", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const english = render(
      <I18nProvider initialLocale="en">
        <StrategyShareActions botId="atlas" botName="Atlas" marketKind="spot" riskLevel="低" timeframe="4h" />
      </I18nProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Share poster" }));
    await user.click(await screen.findByRole("button", { name: "Copy caption" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("I found “Atlas”"));
    expect(String(writeText.mock.calls[0]?.[0])).not.toContain("我在");
    english.unmount();

    localStorage.setItem("cryptobot-labs.locale", "ja");
    document.documentElement.dataset.locale = "ja";
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <I18nProvider initialLocale="ja">
        <StrategyShareActions botId="atlas" botName="Atlas" marketKind="spot" riskLevel="低" timeframe="4h" />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "X" }));
    const target = decodeURIComponent(String(open.mock.calls[0]?.[0]));
    expect(target).toContain("CryptoBot Labsで「Atlas」を見つけました");
    expect(target).toContain("WEEX 現物 · 4H · 低リスク");
    expect(target).not.toContain("我在");
  });

  it("uses the real official bot's English display name, paired quotes, and isolated poster cache path", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    localStorage.setItem("cryptobot-labs.locale", "en");
    document.documentElement.dataset.locale = "en";
    document.documentElement.lang = "en";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(
      <I18nProvider initialLocale="en">
        <StrategyShareActions
          botId="orbit-dca"
          botName="軌道定投"
          localizedBotNames={{ en: "DCA along the trajectory" }}
          marketKind="spot"
          riskLevel="低"
          timeframe="4h"
        />
      </I18nProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Share poster" }));
    const dialog = screen.getByRole("dialog", { name: "Share “DCA along the trajectory”" });
    expect(within(dialog).getByRole("heading")).toHaveTextContent(/^Share “DCA along the trajectory”$/u);
    expect(within(dialog).getByRole("img", { name: "DCA along the trajectory social sharing poster preview" }))
      .toHaveAttribute("src", "/api/strategy-posters/bots/orbit-dca/en");
    await user.click(within(dialog).getByRole("button", { name: "Copy caption" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("I found “DCA along the trajectory”"));
    expect(String(writeText.mock.calls[0]?.[0])).not.toContain("軌道定投");
  });
});
