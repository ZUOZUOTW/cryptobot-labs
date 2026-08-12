import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u.test(baseURL)) {
  throw new Error("PLAYWRIGHT_BASE_URL must be a loopback origin supplied by scripts/run-browser-e2e.mjs.");
}

const sharedUse = {
  baseURL,
  colorScheme: "dark" as const,
  locale: "en-US",
  screenshot: "only-on-failure" as const,
  trace: "retain-on-failure" as const,
  video: "retain-on-failure" as const,
};

export default defineConfig({
  expect: { timeout: 8_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  outputDir: "test-results",
  projects: [
    {
      name: "desktop-chromium",
      use: { ...sharedUse, browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium-320",
      use: {
        ...sharedUse,
        browserName: "chromium",
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
        viewport: { width: 320, height: 800 },
      },
    },
    {
      name: "mobile-chromium-390",
      use: {
        ...sharedUse,
        browserName: "chromium",
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "mobile-webkit-390",
      use: {
        ...devices["iPhone 13"],
        ...sharedUse,
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests/e2e",
  timeout: 45_000,
  use: sharedUse,
  workers: 2,
});
