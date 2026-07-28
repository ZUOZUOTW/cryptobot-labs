import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { browserSecurityHeaders, contentSecurityPolicy } from "../lib/security-headers";

describe("browser security headers", () => {
  it("applies the same hardened headers to dynamic Next.js responses", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{
      source: "/:path*",
      headers: browserSecurityHeaders.map((header) => ({ ...header })),
    }]);
  });

  it("locks framing, plugins, mixed content, and browser capabilities down", () => {
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("connect-src 'self'");
    expect(contentSecurityPolicy).toContain("upgrade-insecure-requests");
    expect(browserSecurityHeaders).toEqual(expect.arrayContaining([
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    ]));
  });

  it("also protects files served directly from Netlify's backing store", async () => {
    const configuration = await readFile("netlify.toml", "utf8");
    expect(configuration).toMatch(/\[\[headers\]\]\s+for = "\/\*"/);
    expect(configuration).toContain(`Content-Security-Policy = "${contentSecurityPolicy}"`);
    for (const header of ["Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security",
      "X-Content-Type-Options", "X-Frame-Options"]) {
      expect(configuration).toContain(header);
    }
  });
});
