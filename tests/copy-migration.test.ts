import { readFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const USER_VISIBLE_ROOTS = ["app", "components"] as const;
const USER_VISIBLE_LIBRARIES = [
  "lib/site-metadata.ts",
  "lib/strategy-validation.ts",
  "lib/bot-package.ts",
] as const;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(path)) ? [path] : [];
  }));
  return files.flat();
}

async function allUserVisibleSource() {
  const roots = await Promise.all(USER_VISIBLE_ROOTS.map((root) => sourceFiles(resolve(process.cwd(), root))));
  const libraries = USER_VISIBLE_LIBRARIES.map((path) => resolve(process.cwd(), path));
  const sources = await Promise.all([...roots.flat(), ...libraries].map((path) => readFile(path, "utf8")));
  return sources.join("\n");
}

describe("softened WEEX product copy", () => {
  it("removes exclusivity language without claiming other exchanges", async () => {
    const source = await allUserVisibleSource();

    expect(source).not.toMatch(/WEEX ONLY|只為 WEEX 而生|WEEX 專屬|只支援 WEEX|僅支援 WEEX|固定為 WEEX/i);
    expect(source).toMatch(/推薦使用 WEEX API|WEEX API · 推薦/);
    expect(source).not.toMatch(/支援 Binance|支援多交易所/i);
  });

  it("explains the currently implemented live connection without weakening its adapter boundary", async () => {
    const source = await allUserVisibleSource();

    expect(source).toContain("目前可用的實盤連線為 WEEX API");
  });
});
