import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSiteMetadata, requestOrigin } from "../lib/site-metadata";

const readProjectFile = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

describe("production metadata", () => {
  it("derives a safe origin from the incoming forwarded request host", () => {
    const origin = requestOrigin(new Headers({
      host: "internal.example",
      "x-forwarded-host": "labs.example:8443, proxy.internal",
      "x-forwarded-proto": "https, http",
    }));

    expect(origin?.href).toBe("https://labs.example:8443/");
    expect(requestOrigin(new Headers({ host: "bad.example/path" }))).toBeNull();
  });

  it("uses absolute request-host-derived Open Graph and X image URLs", () => {
    const metadata = buildSiteMetadata(new URL("https://labs.example/"));

    expect(metadata.openGraph).toMatchObject({
      title: "CryptoBot Labs｜WEEX 自動交易策略實驗室",
      url: new URL("https://labs.example/"),
      images: [expect.objectContaining({
        url: new URL("https://labs.example/og.png"),
        width: 1672,
        height: 941,
      })],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [new URL("https://labs.example/og.png")],
    });
  });

  it("omits social image fields when no valid request host is available", () => {
    const metadata = buildSiteMetadata(null);

    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).not.toHaveProperty("images");
  });
});

describe("final responsive and maintenance contracts", () => {
  it("keeps touch controls large and workshop actions sticky on mobile", async () => {
    const [globalStyles, workshopStyles] = await Promise.all([
      readProjectFile("app/globals.css"),
      readProjectFile("app/workshop.css"),
    ]);

    expect(globalStyles).toContain("min-block-size: 2.75rem");
    expect(globalStyles).toContain("@media (max-width: 44rem)");
    expect(workshopStyles).toContain("@media (max-width: 44rem)");
    expect(workshopStyles).toMatch(/\.workshop-mode\s*\{[^}]*position: sticky/s);
    expect(workshopStyles).toContain("grid-template-columns: 1fr");
  });

  it("loads the focused workshop stylesheet after the global foundation", async () => {
    const [layout, globalStyles] = await Promise.all([
      readProjectFile("app/layout.tsx"),
      readProjectFile("app/globals.css"),
    ]);

    expect(layout.indexOf('import "./globals.css"')).toBeLessThan(layout.indexOf('import "./workshop.css"'));
    expect(globalStyles).not.toContain("/* Multi-strategy workshop */");
  });

  it("documents the repository's pnpm workflow", async () => {
    const readme = await readProjectFile("README.md");

    expect(readme).toContain("pnpm install");
    expect(readme).toContain("pnpm run build");
    expect(readme).not.toMatch(/(^|\n)(?:- `)?npm /);
  });
});
