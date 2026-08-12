import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const ENGLISH_LOCALE_KEY = "cryptobot-labs.locale";
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const PUBLIC_ROUTES = [
  "/",
  "/bots",
  "/bots/orbit-dca",
  "/workshop?new=1&mode=javascript",
  "/runs",
] as const;

async function selectEnglishBeforeLoad(page: Page) {
  await page.addInitScript(([key, locale]) => {
    window.localStorage.setItem(key, locale);
  }, [ENGLISH_LOCALE_KEY, "en"] as const);
}

async function isolatePublicNetwork(context: BrowserContext, baseURL: string) {
  const localOrigin = new URL(baseURL).origin;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      await route.continue();
      return;
    }
    if (url.origin !== localOrigin) {
      await route.abort("blockedbyclient");
      return;
    }
    if (route.request().resourceType() === "image"
      && (url.pathname === "/_next/image" || url.pathname.startsWith("/mascots/"))) {
      await route.fulfill({ body: TRANSPARENT_PNG, contentType: "image/png", status: 200 });
      return;
    }
    if (url.pathname === "/api/strategy-publications") {
      await route.fulfill({
        body: JSON.stringify({ publications: [], nextCursor: null }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (url.pathname === "/api/weex/markets") {
      await route.fulfill({
        body: JSON.stringify({ error: { code: "e2e_external_market_data_disabled" } }),
        contentType: "application/json",
        status: 503,
      });
      return;
    }
    await route.continue();
  });
}

async function expectNoRootOverflow(page: Page) {
  await expect.poll(async () => page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))).toEqual(expect.objectContaining({
    body: expect.any(Number),
    document: expect.any(Number),
    viewport: expect.any(Number),
  }));
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(dimensions.body, "body must not create horizontal page scrolling").toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.document, "document must not create horizontal page scrolling").toBeLessThanOrEqual(dimensions.viewport + 1);
}

function summarizedViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

test.beforeEach(async ({ baseURL, context, page }) => {
  if (!baseURL) throw new Error("Playwright baseURL is required.");
  await isolatePublicNetwork(context, baseURL);
  await selectEnglishBeforeLoad(page);
});

test("signed-out public routes render without root overflow", async ({ page }) => {
  for (const route of PUBLIC_ROUTES) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${route} should be available`).toBeLessThan(500);
    await expect(page.locator("main#main-content")).toBeVisible();
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expectNoRootOverflow(page);
  }
});

test("English locale bootstraps the workshop source before hydration", async ({ page }) => {
  await page.goto("/workshop?new=1&mode=javascript", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Strategy Assembly Workshop" })).toBeVisible();
  const source = page.getByRole("textbox", { name: "JavaScript strategy source code" });
  await expect(source).toHaveValue(/Example of a simulated strategy for CryptoBot Labs\./u);
  await expect(source).toHaveValue(/Historical backtests run this function only in an isolated sandbox\./u);
  await expect(source).not.toHaveValue(/歷史回測/u);
});

test("JavaScript workshop returns to the exact draft after safe demo authentication", async ({ page }) => {
  await page.goto("/workshop?new=1&mode=javascript", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Strategy Assembly Workshop" })).toBeVisible();
  const saveButton = page.getByRole("button", { name: "Save strategy" });
  if (!await saveButton.isVisible()) {
    await page.getByRole("button", { name: "04 Save / Publish" }).click();
  }
  await saveButton.click();
  await expect(page).toHaveURL(/\/auth\?return_to=/u);
  const authURL = new URL(page.url());
  expect(authURL.searchParams.get("return_to")).toBe("/workshop?new=1&mode=javascript");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/\/workshop\?new=1&mode=javascript$/u);
  await expect(page.getByRole("button", { name: "JavaScript mode" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "JavaScript strategy source code" }))
    .toHaveValue(/Example of a simulated strategy for CryptoBot Labs\./u);
});

test("strategy sharing opens by keyboard and serves a 1200 by 630 PNG", async ({ page }) => {
  await page.goto("/bots/orbit-dca", { waitUntil: "domcontentloaded" });
  const shareTrigger = page.getByRole("button", { name: "Share poster" }).first();
  await shareTrigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: /Share “.+”/u });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("AUTO-GENERATED CAPTION")).toBeVisible();
  await expect(dialog.locator("p").filter({ hasText: "Historical backtests do not guarantee future results." })).toBeVisible();

  const posterResponse = await page.request.get("/api/strategy-posters/bots/orbit-dca/en");
  expect(posterResponse.status()).toBe(200);
  expect(posterResponse.headers()["content-type"]).toContain("image/png");
  const poster = await posterResponse.body();
  expect(poster.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(poster.readUInt32BE(16)).toBe(1200);
  expect(poster.readUInt32BE(20)).toBe(630);
  expect(poster.byteLength).toBeGreaterThan(10_000);
  expect(poster.byteLength).toBeLessThan(5_000_000);

  const preview = dialog.getByRole("img", { name: /social sharing poster preview/u });
  await expect.poll(async () => preview.evaluate((image: HTMLImageElement) => ({
    complete: image.complete,
    height: image.naturalHeight,
    width: image.naturalWidth,
  }))).toEqual({ complete: true, height: 630, width: 1200 });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(shareTrigger).toBeFocused();
});

test("public keyboard path and share dialog pass automated WCAG checks", async ({ browserName, page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  if (browserName === "webkit") {
    // WebKit follows the host Safari preference that can omit links from the
    // sequential Tab order. Focus explicitly, then exercise keyboard activation.
    await skipLink.focus();
  } else {
    await page.keyboard.press("Tab");
  }
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();

  const homeResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(summarizedViolations(homeResults.violations)).toEqual([]);

  await page.goto("/bots/orbit-dca", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Share poster" }).first().click();
  const dialog = page.getByRole("dialog", { name: /Share “.+”/u });
  await expect(dialog).toBeVisible();
  const dialogResults = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(summarizedViolations(dialogResults.violations)).toEqual([]);
});

test("native Chromium touch swipe advances the mobile workshop", async ({ browserName, page }, testInfo) => {
  test.skip(browserName !== "chromium" || !testInfo.project.name.startsWith("mobile-"),
    "Native touch injection is exercised by the two mobile Chromium projects.");

  await page.goto("/workshop?new=1&mode=javascript", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 2, name: "JavaScript strategy" })).toBeVisible();
  const box = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('.workshop-step-panel[data-mobile-active="true"] .workshop-panel__heading')
      ?.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const grid = document.querySelector(".workshop-grid");
    const header = grid?.querySelector<HTMLElement>('.workshop-step-panel[data-mobile-active="true"] .workshop-panel__heading');
    if (!grid || !header) return null;
    grid.addEventListener("touchstart", (event) => {
      document.documentElement.dataset.e2eTouchTrusted = String(event.isTrusted);
    }, { capture: true, once: true });
    const rectangle = header.getBoundingClientRect();
    return { height: rectangle.height, width: rectangle.width, x: rectangle.x, y: rectangle.y };
  });
  if (!box) throw new Error("Active workshop panel is not measurable.");

  const session = await page.context().newCDPSession(page);
  const startX = box.x + Math.min(box.width - 12, Math.max(100, box.width * 0.78));
  const endX = Math.max(box.x + 12, startX - 96);
  const y = box.y + box.height / 2;
  const point = (x: number) => [{ id: 1, x, y, radiusX: 3, radiusY: 3, force: 1 }];
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(startX) });
    await page.waitForTimeout(32);
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point((startX + endX) / 2) });
    await page.waitForTimeout(32);
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(endX) });
    await page.waitForTimeout(32);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }

  await expect(page.locator("html")).toHaveAttribute("data-e2e-touch-trusted", "true");
  await expect(page.getByRole("button", { name: "02 Parameters" })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("region", { name: "Quick parameters" })).toBeVisible();
});
