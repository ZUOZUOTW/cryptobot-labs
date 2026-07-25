import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Netlify production build", () => {
  it("clears stale Next.js output before compiling production assets", async () => {
    const [config, cleaner] = await Promise.all([
      readFile("netlify.toml", "utf8"),
      readFile("scripts/clean-next-build.mjs", "utf8"),
    ]);

    expect(config).toContain('command = "node scripts/clean-next-build.mjs && node node_modules/next/dist/bin/next build --webpack"');
    expect(cleaner).toContain('resolve(projectRoot, ".next")');
    expect(cleaner).toContain("await rm(nextOutput, { force: true, recursive: true })");
  });
});
