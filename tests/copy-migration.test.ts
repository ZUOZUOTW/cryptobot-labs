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

describe("WEEX-only product copy", () => {
  it("removes WEEX-only badges without claiming other exchanges", async () => {
    const source = await allUserVisibleSource();

    expect(source).not.toMatch(/WEEX ONLY|WEEX 專用|WEEX 專屬/i);
    expect(source).toContain("WEEX 官方 OAuth");
    expect(source).not.toMatch(/支援 Binance|支援多交易所/i);
  });

  it("explains the currently implemented live connection without weakening its adapter boundary", async () => {
    const source = await allUserVisibleSource();

    expect(source).toContain("正式版透過 WEEX 官方 OAuth 授權");
  });
});
