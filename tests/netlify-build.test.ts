import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Netlify production build", () => {
  it("clears stale Next.js output, compiles production assets, and validates the Edge bundle", async () => {
    const [config, cleaner] = await Promise.all([
      readFile("netlify.toml", "utf8"),
      readFile("scripts/clean-next-build.mjs", "utf8"),
    ]);

    expect(config).toContain(
      'command = "node scripts/check-deployment-env.mjs && node scripts/check-production-database-readiness.mjs website && node scripts/clean-next-build.mjs && node node_modules/next/dist/bin/next build --webpack && node scripts/check-next-edge-bundle.mjs"',
    );
    expect(config).toContain('SECRETS_SCAN_OMIT_KEYS = "SUPABASE_URL"');
    expect(config).not.toContain('SECRETS_SCAN_ENABLED = "false"');
    expect(cleaner).toContain('resolve(projectRoot, ".next")');
    expect(cleaner).toContain("await rm(nextOutput, { force: true, recursive: true })");
  });

  it("fails the production build before rendering when its canonical public origin is absent or unsafe", async () => {
    const [manifest, checker, workflow] = await Promise.all([
      readFile("package.json", "utf8"),
      readFile("scripts/check-deployment-env.mjs", "utf8"),
      readFile(".github/workflows/ci.yml", "utf8"),
    ]);

    expect(JSON.parse(manifest).scripts.build).toMatch(
      /^node scripts\/check-deployment-env\.mjs && node scripts\/check-production-database-readiness\.mjs website /,
    );
    expect(checker).toContain('parsedOrigin.protocol !== "https:"');
    expect(checker).toContain('demoMode !== "true"');
    expect(checker).toContain('"SUPABASE_DATABASE_URL"');
    expect(workflow).toContain('PUBLIC_ORIGIN: "https://ci.cryptobot.invalid"');
  });

  it("renders dynamic social cards without reading public assets from the function filesystem", async () => {
    const [socialImage, socialRenderer, posterCard, publicationLoader] = await Promise.all([
      readFile("app/strategies/[slug]/opengraph-image.tsx", "utf8"),
      readFile("lib/server/strategy-poster-images.tsx", "utf8"),
      readFile("components/StrategyPosterCard.tsx", "utf8"),
      readFile("lib/server/public-strategy-loader.ts", "utf8"),
    ]);

    expect(socialImage).toContain("renderMemberStrategyPoster");
    expect(socialRenderer).toContain("new ImageResponse");
    expect(socialRenderer).toContain("buildMemberStrategyPosterMetrics(publication.metrics, posterLocale)");
    expect(socialRenderer).toContain('new URL("/mascots/ai-builder.png", assetOrigin(requestHeaders)).toString()');
    expect(socialRenderer).toContain("resolveStrategyPosterAssetOrigin");
    expect(socialRenderer).toContain('"Cache-Control": "no-store"');
    expect(socialRenderer).toContain("status: 503");
    expect(socialRenderer).toContain("status: 404");
    expect(socialRenderer).not.toContain("MascotBadge");
    expect(socialImage).toContain("export const revalidate = 3600");
    expect(posterCard).toContain('"Netlify-CDN-Cache-Control": "public, durable, s-maxage=3600, stale-while-revalidate=86400"');
    expect(publicationLoader).toContain("unstable_cache");
    expect(socialRenderer).not.toContain('from "node:fs');
    expect(socialRenderer).not.toContain("join(process.cwd()");
  });
});
