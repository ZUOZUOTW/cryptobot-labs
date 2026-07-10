import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) =>
  readFile(resolve(process.cwd(), path), "utf8");

describe("CryptoBot Labs starter surface", () => {
  it("uses product metadata and Traditional Chinese document language", async () => {
    const [layout, page] = await Promise.all([
      readProjectFile("app/layout.tsx"),
      readProjectFile("app/page.tsx"),
    ]);

    expect(layout).toContain('title: "CryptoBot Labs"');
    expect(layout).toContain('<html lang="zh-Hant">');
    expect(page).toContain('title: "CryptoBot Labs"');
    expect(page).not.toContain("Your site is taking shape");
  });

  it("shows a temporary Traditional Chinese loading message", async () => {
    const preview = await readProjectFile(
      "app/_sites-preview/SkeletonPreview.tsx",
    );

    expect(preview).toContain(">CryptoBot Labs<");
    expect(preview).toContain("交易機器人工作台正在準備中");
    expect(preview).toContain("完成後將自動顯示");
    expect(preview).not.toContain("Codex is working");
  });
});
