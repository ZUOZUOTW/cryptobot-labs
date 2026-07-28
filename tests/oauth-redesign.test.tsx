import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DemoAuthorizePanel } from "../app/demo/weex-authorize/DemoAuthorizePanel";
import { OAuthConnectionFlow } from "../components/connections/OAuthConnectionFlow";
import { DemoRunsPanel } from "../components/runs/DemoRunsPanel";
import { DEFAULT_PROMOTER_SLUG } from "../data/demo-platform";
import { captureAttribution } from "../lib/attribution";
import { safeReturnTo, signInDemo } from "../lib/demo-auth";
import { setDemoConnection } from "../lib/demo-connection";
import { createDemoPaperRun } from "../lib/demo-runs";
import { demoModeEnabled, productionLiveReady, productionOAuthReady } from "../lib/server/demo-mode";
import { GET as getBotPerformance } from "../app/api/weex/bot-performance/route";

beforeEach(() => { localStorage.clear(); window.history.replaceState({}, "", "/connections"); });
afterEach(cleanup);

const syntheticPublishableKey = ["sb", "publishable", "1234567890"].join("_");
const fixtureHex = ["0123", "4567", "89ab", "cdef"].join("");
const syntheticCookieSecret = fixtureHex.repeat(2);

describe("OAuth-first redesign demo", () => {
  it("preserves safe relative return paths and rejects open redirects", () => {
    expect(safeReturnTo("/workshop?bot=orbit-dca#paper")).toBe("/workshop?bot=orbit-dca#paper");
    expect(safeReturnTo("//evil.example/path", "/bots")).toBe("/bots");
    expect(safeReturnTo("https://evil.example/path", "/bots")).toBe("/bots");
  });

  it("requires demo login, branches account setup, and unlocks Paper only after safe verification", async () => {
    const user = userEvent.setup();
    render(<OAuthConnectionFlow />);
    expect(screen.getByRole("link", { name: "Google／Email 登入" })).toHaveAttribute("href", "/auth?return_to=%2Fconnections");

    act(() => signInDemo({ displayName: "測試用戶", email: "demo@example.test", provider: "email" }));
    expect(screen.getByRole("heading", { name: "你已經有 WEEX 帳戶嗎？" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /我已有 WEEX 帳戶/ }));
    expect(screen.getByRole("link", { name: "前往 WEEX 展示授權" })).toHaveAttribute("href", "/demo/weex-authorize?return_to=%2Fconnections");

    act(() => setDemoConnection("paper-ready"));
    expect(screen.getByText(/展示連線已就緒/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "選擇策略並開始模擬運行" })).toHaveAttribute("href", "/workshop?bot=orbit-dca&onboarding=paper");
  });

  it("labels the simulated authorization page and never offers Live", () => {
    act(() => signInDemo({ displayName: "Google 展示用戶", email: "google@example.test", provider: "google" }));
    render(<DemoAuthorizePanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("模擬授權頁，非 WEEX 官方頁");
    expect(screen.getByText("不允許")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Live|實盤/ })).not.toBeInTheDocument();
  });

  it("accepts only approved promoter slugs and locks unknown input to the site default", () => {
    expect(captureAttribution("orbit-trader").lastTouch).toBe("orbit-trader");
    expect(captureAttribution("https://evil.example").lastTouch).toBe(DEFAULT_PROMOTER_SLUG);
  });

  it("creates a local Paper run without a private WEEX connection", () => {
    act(() => signInDemo({ displayName: "Paper 用戶", email: "paper@example.test", provider: "email" }));
    const run = createDemoPaperRun({ botId: "orbit-dca", botName: "軌道定投" });
    render(<DemoRunsPanel />);
    expect(screen.getByText("軌道定投")).toBeInTheDocument();
    expect(screen.getByText("共用公開行情")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看運行與停止控制" })).toHaveAttribute("href", `/runs/${run.id}`);
  });

  it("fails closed outside demo mode and never enables Live from environment variables", () => {
    expect(demoModeEnabled({ DEMO_MODE: "true" })).toBe(true);
    expect(productionOAuthReady({ DEMO_MODE: "false" })).toBe(false);
    expect(productionOAuthReady({ DEMO_MODE: "false", PUBLIC_ORIGIN: "https://app.example.test",
      SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: syntheticPublishableKey,
      AUTH_COOKIE_SECRET: syntheticCookieSecret,
      EXECUTOR_API_ORIGIN: "https://api.example.test",
      EXECUTOR_HANDOFF_SECRET: "a-secure-handoff-secret-with-at-least-32-bytes",
      WEEX_AUTH_STAGE: "transition" })).toBe(false);
    expect(productionOAuthReady({ DEMO_MODE: "false", PUBLIC_ORIGIN: "https://app.example.test",
      SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: syntheticPublishableKey,
      AUTH_COOKIE_SECRET: syntheticCookieSecret,
      EXECUTOR_API_ORIGIN: "https://api.example.test",
      EXECUTOR_HANDOFF_SECRET: "a-secure-handoff-secret-with-at-least-32-bytes",
      WEEX_AUTH_STAGE: "dual" })).toBe(true);
    expect(productionOAuthReady({ DEMO_MODE: "false", PUBLIC_ORIGIN: "https://app.example.test",
      SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: syntheticPublishableKey,
      AUTH_COOKIE_SECRET: syntheticCookieSecret,
      EXECUTOR_API_ORIGIN: "https://api.example.test",
      EXECUTOR_HANDOFF_SECRET: "a-secure-handoff-secret-with-at-least-32-bytes",
      WEEX_AUTH_STAGE: "oauth-only" })).toBe(false);
    expect(productionLiveReady()).toBe(false);
  });

  it("keeps the catalog fail-closed when account demo mode has no verified market performance", async () => {
    const catalogResponse = await getBotPerformance();
    await expect(catalogResponse.json()).resolves.toMatchObject({ demo: true, performances: {} });
  });
});
