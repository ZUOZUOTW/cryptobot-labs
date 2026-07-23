import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../app/manifest";

const projectFile = (path: string) => resolve(process.cwd(), path);

describe("mobile-first PWA shell", () => {
  it("publishes an installable standalone manifest with app shortcuts", () => {
    const value = manifest();

    expect(value).toMatchObject({
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#06070b",
      theme_color: "#06070b",
    });
    expect(value.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/icons/cryptobot-192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "/icons/cryptobot-512.png", sizes: "512x512" }),
      expect.objectContaining({ src: "/icons/cryptobot-maskable-512.png", purpose: "maskable" }),
    ]));
    expect(value.shortcuts).toHaveLength(3);
  });

  it("ships valid PNG icon assets", async () => {
    const icons = [
      "public/icons/cryptobot-192.png",
      "public/icons/cryptobot-512.png",
      "public/icons/cryptobot-maskable-512.png",
    ];
    for (const icon of icons) {
      await access(projectFile(icon));
      const [contents, details] = await Promise.all([readFile(projectFile(icon)), stat(projectFile(icon))]);
      expect(contents.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(details.size).toBeGreaterThan(1_000);
    }
  });

  it("never caches API, auth, or write requests", async () => {
    const worker = await readFile(projectFile("public/sw.js"), "utf8");

    expect(worker).toContain('request.method !== "GET"');
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('url.pathname.startsWith("/auth/")');
    expect(worker).toContain("caches.match(OFFLINE_URL)");
    expect(worker).not.toMatch(/addEventListener\(["'](?:sync|periodicsync)["']/);
  });

  it("provides a five-target mobile tab bar and a stepped workshop", async () => {
    const [tabs, globalStyles, workshop, workshopStyles] = await Promise.all([
      readFile(projectFile("components/MobileTabBar.tsx"), "utf8"),
      readFile(projectFile("app/globals.css"), "utf8"),
      readFile(projectFile("app/workshop/page.tsx"), "utf8"),
      readFile(projectFile("app/workshop.css"), "utf8"),
    ]);

    expect(tabs).toContain("PRIMARY_TABS");
    expect(globalStyles).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
    expect(workshop).toContain("MOBILE_WORKSHOP_STEPS");
    expect(workshop).toContain('aria-current={mobileStep === step.id ? "step" : undefined}');
    expect(workshopStyles).toContain('.workshop-step-panel:not([data-mobile-active="true"]) { display: none; }');
  });
});
