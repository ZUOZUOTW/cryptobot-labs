import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectFile = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

describe("homepage loading performance contracts", () => {
  it("keeps heavy homepage features behind viewport-triggered chunks", async () => {
    const [page, deferredContent] = await Promise.all([
      projectFile("app/page.tsx"),
      projectFile("components/home/DeferredHomeContent.tsx"),
    ]);

    expect(page).not.toContain('from "../components/home/StrategyAssemblyPlayer"');
    expect(page).not.toContain('from "../components/home/StrategyCodePlayer"');
    expect(page).not.toContain('from "../components/HomePerformanceSections"');
    expect(deferredContent).toContain("IntersectionObserver");
    expect(deferredContent).toContain('lazy(() => import("./StrategyAssemblyPlayer")');
    expect(deferredContent).toContain('lazy(() => import("./StrategyCodePlayer")');
    expect(deferredContent).toContain('lazy(() => import("../HomePerformanceSections")');
  });

  it("loads the full translation catalogue asynchronously", async () => {
    const provider = await projectFile("components/I18nProvider.tsx");

    expect(provider).toContain('import("@/lib/i18n/messages")');
    expect(provider).not.toContain('import { canonicalMessageSource, translateMessage } from "@/lib/i18n/messages"');
    expect(provider).toContain("queueMicrotask(flushBodyTranslations)");
    expect(provider).not.toContain("for (const node of record.addedNodes) translateNode(node, locale)");
  });

  it("reuses public market data while switching between feature pages", async () => {
    const [historicalClient, parameterPanel] = await Promise.all([
      projectFile("lib/weex-historical-client.ts"),
      projectFile("components/workshop/ParameterPanel.tsx"),
    ]);

    expect(historicalClient).toContain("BOT_PERFORMANCE_CACHE_TTL_MS");
    expect(historicalClient).toContain("botPerformanceCache.expiresAt > Date.now()");
    expect(parameterPanel).toContain("MARKET_CATALOG_CACHE_TTL_MS");
    expect(parameterPanel).toContain("marketCatalogCache.expiresAt > Date.now()");
  });

  it("serves the prioritized hero as a substantially smaller WebP", async () => {
    const [hero, png, webp] = await Promise.all([
      projectFile("components/OrbitalHero.tsx"),
      stat(resolve(process.cwd(), "public/mascots/ai-observer.png")),
      stat(resolve(process.cwd(), "public/mascots/ai-observer.webp")),
    ]);

    expect(hero).toContain("preload");
    expect(hero).toContain('src="/mascots/ai-observer.webp"');
    expect(webp.size).toBeLessThan(png.size * 0.2);
  });

  it("keeps feature CSS out of the root layout", async () => {
    const rootLayout = await projectFile("app/layout.tsx");

    expect(rootLayout).not.toContain('import "./workshop.css"');
  });
});
