import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) =>
  readFile(resolve(process.cwd(), path), "utf8");

describe("CryptoBot Labs production shell", () => {
  it("uses product metadata and Traditional Chinese document language", async () => {
    const [layout, page] = await Promise.all([
      readProjectFile("app/layout.tsx"),
      readProjectFile("app/page.tsx"),
    ]);

    expect(layout).toContain("title: SITE_TITLE");
    expect(layout).toContain('<html lang="zh-Hant">');
    expect(layout).toContain("<SiteHeader />");
    expect(layout).toContain("<SiteFooter />");
    expect(layout).toContain('<main className="site-main" id="main-content"');
    expect(page).not.toContain("metadata");
    expect(page).not.toContain("SkeletonPreview");
  });

  it("ships the Orbital Lab tokens and global simulation disclosure", async () => {
    const [styles, footer] = await Promise.all([
      readProjectFile("app/globals.css"),
      readProjectFile("components/SiteFooter.tsx"),
    ]);

    expect(styles).toContain("--bg: #06070b");
    expect(styles).toContain("--violet: #8b63ff");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(footer).toContain("模擬回測資料，不代表未來績效");
    expect(footer).toContain("本原型僅支援 WEEX");
  });
});
