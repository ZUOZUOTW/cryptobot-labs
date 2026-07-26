import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Netlify production build", () => {
  it("clears stale Next.js output before compiling production assets", async () => {
    const [config, cleaner] = await Promise.all([
      readFile("netlify.toml", "utf8"),
      readFile("scripts/clean-next-build.mjs", "utf8"),
    ]);

    expect(config).toContain('command = "node scripts/clean-next-build.mjs && node node_modules/next/dist/bin/next build --webpack"');
    expect(config).toContain('SECRETS_SCAN_OMIT_KEYS = "SUPABASE_URL"');
    expect(config).not.toContain('SECRETS_SCAN_ENABLED = "false"');
    expect(cleaner).toContain('resolve(projectRoot, ".next")');
    expect(cleaner).toContain("await rm(nextOutput, { force: true, recursive: true })");
  });

  it("renders dynamic social cards without reading public assets from the function filesystem", async () => {
    const [socialImage, publicationLoader] = await Promise.all([
      readFile("app/strategies/[slug]/opengraph-image.tsx", "utf8"),
      readFile("lib/server/public-strategy-loader.ts", "utf8"),
    ]);

    expect(socialImage).toContain("new ImageResponse");
    expect(socialImage).toContain("<MascotBadge />");
    expect(socialImage).toContain("export const revalidate = 3600");
    expect(socialImage).toContain('"Netlify-CDN-Cache-Control": "public, durable, s-maxage=3600, stale-while-revalidate=86400"');
    expect(publicationLoader).toContain("unstable_cache");
    expect(socialImage).not.toContain('from "node:fs');
    expect(socialImage).not.toContain("join(process.cwd()");
  });
});
