import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSiteMetadata, requestOrigin } from "../lib/site-metadata";

const readProjectFile = (path: string) => readFile(resolve(process.cwd(), path), "utf8");
const EXPECTED_TITLE = "CryptoBot Labs｜WEEX 自動交易策略實驗室";
const EXPECTED_DESCRIPTION = "探索、比較並組裝 WEEX 專屬自動交易策略，透過可重現的模擬回測安全驗證交易想法。";
const EXPECTED_IMAGE_ALT = "CryptoBot Labs：把交易想法，組裝成你的機器人。WEEX ONLY";

describe("production metadata", () => {
  const rawHeaders = (host: string | null, forwardedHost: string | null = null, forwardedProto: string | null = null) => ({
    get(name: string) {
      if (name === "host") return host;
      if (name === "x-forwarded-host") return forwardedHost;
      if (name === "x-forwarded-proto") return forwardedProto;
      return null;
    },
  });

  it.each([
    ["labs.example", "https://labs.example/"],
    ["labs.example:8443", "https://labs.example:8443/"],
    ["192.0.2.10:8080", "https://192.0.2.10:8080/"],
    ["[2001:db8::1]:8443", "https://[2001:db8::1]:8443/"],
    ["localhost", "http://localhost/"],
    ["localhost:3000", "http://localhost:3000/"],
    ["127.0.0.1:4173", "http://127.0.0.1:4173/"],
    ["[::1]:3000", "http://[::1]:3000/"],
  ])("derives %s from the actual Host header", (host, expected) => {
    expect(requestOrigin(rawHeaders(host))?.href).toBe(expected);
  });

  it("ignores forwarded host and protocol without a trusted proxy contract", () => {
    const origin = requestOrigin(rawHeaders("internal.example", "attacker.example", "http"));

    expect(origin?.href).toBe("https://internal.example/");
  });

  it.each([
    null,
    "",
    "labs.example,attacker.example",
    " labs.example",
    "labs.example ",
    "labs .example",
    "labs.example\t",
    "labs.example\u0000",
    "user@labs.example",
    "labs.example/path",
    "labs.example\\path",
    "labs.example?query",
    "labs.example#hash",
    "labs.example:notaport",
    "labs.example:65536",
    "labs.example:",
    "[::1",
    "::1",
    "[]:3000",
    "-labs.example",
    "labs_.example",
    "999.1.1.1",
  ])("rejects an unsafe or malformed Host value: %s", (host) => {
    expect(requestOrigin(rawHeaders(host))).toBeNull();
  });

  it("uses absolute request-host-derived Open Graph and X image URLs", () => {
    const metadata = buildSiteMetadata(new URL("https://labs.example/"));

    expect(metadata.openGraph).toMatchObject({
      title: EXPECTED_TITLE,
      url: new URL("https://labs.example/"),
      images: [{
        url: new URL("https://labs.example/og.png"),
        width: 1672,
        height: 941,
        alt: EXPECTED_IMAGE_ALT,
      }],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: EXPECTED_TITLE,
      description: EXPECTED_DESCRIPTION,
      images: [{
        url: new URL("https://labs.example/og.png"),
        width: 1672,
        height: 941,
        alt: EXPECTED_IMAGE_ALT,
      }],
    });
  });

  it("omits social image fields when no valid request host is available", () => {
    const metadata = buildSiteMetadata(null);

    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).not.toHaveProperty("images");
  });
});

describe("final responsive and maintenance contracts", () => {
  it("gives each compact interaction surface an exact 44px minimum target", async () => {
    const [globalStyles, workshopStyles] = await Promise.all([
      readProjectFile("app/globals.css"),
      readProjectFile("app/workshop.css"),
    ]);

    expect(globalStyles).toMatch(/button,\s*input:not\(\[type="file"\]\),\s*select\s*\{\s*min-block-size: 2\.75rem;/);
    expect(globalStyles).toMatch(/\.menu-button\s*\{[^}]*width: 2\.75rem;/s);
    expect(globalStyles).toMatch(/\.button--small\s*\{\s*min-height: 2\.75rem;/);
    expect(globalStyles).toMatch(/\.period-switcher__button\s*\{\s*min-height: 2\.75rem;/);
    expect(globalStyles).toMatch(/\.risk-return-panel__point > a\s*\{[^}]*width: 2\.75rem;[^}]*height: 2\.75rem;/s);
    expect(workshopStyles).toMatch(/\.strategy-option__add\s*\{\s*width: 2\.75rem;/);
    expect(workshopStyles).toMatch(/\.selected-strategies__actions button\s*\{\s*width: 2\.75rem;/);
    expect(workshopStyles).toMatch(/\.market-controls select\s*\{\s*min-height: 2\.75rem;/);
  });

  it("uses exact mobile single-column and sticky workshop action rules", async () => {
    const [globalStyles, workshopStyles] = await Promise.all([
      readProjectFile("app/globals.css"),
      readProjectFile("app/workshop.css"),
    ]);

    expect(globalStyles).toMatch(/@media \(max-width: 44rem\) \{\s*\.bot-grid,\s*\.metric-grid \{ grid-template-columns: 1fr; \}/);
    expect(workshopStyles).toMatch(/@media \(max-width: 44rem\) \{[\s\S]*?\.workshop-mode \{[\s\S]*?position: sticky;[\s\S]*?top: calc\(var\(--header-height\) \+ 0\.5rem\);/);
    expect(workshopStyles).toMatch(/@media \(max-width: 44rem\) \{[\s\S]*?\.market-controls,\s*\.block-parameters \{ grid-template-columns: 1fr; \}[\s\S]*?\.backtest-metrics \{ grid-template-columns: 1fr; \}[\s\S]*?\.package-panel__grid \{ grid-template-columns: 1fr; \}/);
    expect(workshopStyles).toMatch(/\.workshop-mobile-actions \{[\s\S]*?position: fixed;[\s\S]*?bottom: 0;[\s\S]*?env\(safe-area-inset-bottom\)/);
  });

  it("keeps the exact reduced-motion override and editor focus ring", async () => {
    const [globalStyles, workshopStyles] = await Promise.all([
      readProjectFile("app/globals.css"),
      readProjectFile("app/workshop.css"),
    ]);

    expect(globalStyles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{[^}]*scroll-behavior: auto !important;[^}]*animation-duration: 0\.01ms !important;[^}]*animation-iteration-count: 1 !important;[^}]*transition-duration: 0\.01ms !important;/s);
    expect(workshopStyles).toMatch(/\.javascript-editor textarea:focus-visible\s*\{\s*outline: 2px solid var\(--cyan\);\s*outline-offset: 2px;/);
  });

  it("loads the focused workshop stylesheet after the global foundation", async () => {
    const [layout, globalStyles, metadataSource] = await Promise.all([
      readProjectFile("app/layout.tsx"),
      readProjectFile("app/globals.css"),
      readProjectFile("lib/site-metadata.ts"),
    ]);

    expect(layout.indexOf('import "./globals.css"')).toBeLessThan(layout.indexOf('import "./workshop.css"'));
    expect(globalStyles).not.toContain("/* Multi-strategy workshop */");
    expect(layout).toContain("title: SITE_TITLE");
    expect(layout).toContain("description: SITE_DESCRIPTION");
    expect(metadataSource).toContain("export const SITE_TITLE");
    expect(metadataSource).toContain("export const SITE_DESCRIPTION");
    expect(metadataSource).toContain("export const SOCIAL_IMAGE_ALT");
    expect(metadataSource.match(/CryptoBot Labs｜WEEX 自動交易策略實驗室/g)).toHaveLength(1);
    expect(metadataSource.match(/CryptoBot Labs：把交易想法，組裝成你的機器人。WEEX ONLY/g)).toHaveLength(1);
  });

  it("documents the repository's pnpm workflow", async () => {
    const readme = await readProjectFile("README.md");

    expect(readme).toContain("pnpm install");
    expect(readme).toContain("pnpm run build");
    expect(readme).not.toMatch(/(^|\n)(?:- `)?npm /);
  });

  it("uses pnpm in the optional D1 recovery copy", async () => {
    const route = await readProjectFile("examples/d1/app/api/notes/route.ts");

    expect(route).toContain("pnpm run db:generate");
    expect(route).not.toMatch(/`npm run db:generate`/);
  });
});
