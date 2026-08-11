import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformAuthProvider } from "../components/PlatformAuthProvider";
import { PackagePanel } from "../components/workshop/PackagePanel";
import { STRATEGY_PRESETS } from "../data/strategies";
import { runBacktest } from "../lib/backtest";
import type { BacktestReport, BotConfig } from "../lib/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const config: BotConfig = {
  ...STRATEGY_PRESETS[0],
  blocks: STRATEGY_PRESETS[0].blocks.map((block) => ({
    ...block,
    parameters: block.parameters.map((parameter) => ({ ...parameter })),
  })),
};

const report: BacktestReport = {
  ...runBacktest(config),
  evidence: {
    level: "historical",
    provider: "WEEX",
    market: config.market,
    symbol: config.symbol,
    interval: config.timeframe,
    startTime: 1_700_000_000_000,
    endTime: 1_700_086_400_000,
    collectedAt: 1_700_086_400_000,
    candleCount: 180,
    complete: true,
    feeRate: "0.001",
    slippageRate: "0.0005",
    fundingIncluded: false,
    datasetDigest: "d".repeat(64),
    engineVersion: "test",
  },
};

describe("production strategy publishing UI", () => {
  it("keeps publication and link sharing as two separate user actions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/strategies") {
        return new Response(JSON.stringify({
          strategyVersion: { id: "version_1", configHash: "a".repeat(64) },
        }), { status: 201 });
      }
      if (url === "/api/backtests") {
        return new Response(JSON.stringify({
          backtest: { id: "backtest_1", status: "succeeded" },
        }), { status: 201 });
      }
      if (url === "/api/strategy-publications") {
        return new Response(JSON.stringify({
          publication: { slug: "strategy-communitycopy", updatedAt: 1_707_004_800_000 },
        }), { status: 201 });
      }
      if (url === "/api/strategy-publications/strategy-communitycopy") {
        return new Response(JSON.stringify({
          publication: { slug: "strategy-communitycopy", updatedAt: 1_707_091_200_000 },
        }), { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const user = userEvent.setup();
    render(
      <PlatformAuthProvider
        initialUser={{ id: "usr_1", email: "member@example.test", displayName: "會員 A" }}
        mode="production"
      >
        <PackagePanel config={config} flowCheckState="passed" onImport={() => ({ ok: true })} report={report} />
      </PlatformAuthProvider>,
    );

    const shareButton = screen.getByRole("button", { name: "複製策略分享連結" });
    const referralInput = screen.getByRole("textbox", { name: "WEEX 邀請註冊連結（選填）" });
    expect(shareButton).toBeDisabled();
    expect(referralInput).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "公開策略介紹" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "發布策略到公開列表" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/strategies",
      "/api/backtests",
      "/api/strategy-publications",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      strategyVersionId: "version_1",
      backtestJobId: "backtest_1",
      description: expect.any(String),
    });
    expect(await screen.findByRole("status")).toHaveTextContent("策略已發布到公開策略列表");
    expect(shareButton).toBeEnabled();
    expect(referralInput).toBeEnabled();
    expect(screen.getByRole("link", { name: "查看公開策略" }))
      .toHaveAttribute("href", `${window.location.origin}/strategies/strategy-communitycopy?v=1707004800000`);

    await user.type(referralInput, "https://www.weex.com/register?inviteCode=TEST");
    await user.click(shareButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/api/strategy-publications/strategy-communitycopy");
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      weexReferralUrl: "https://www.weex.com/register?inviteCode=TEST",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("邀請連結已保存，策略分享連結已複製");
    expect(await navigator.clipboard.readText())
      .toBe(`${window.location.origin}/strategies/strategy-communitycopy?v=1707091200000`);
  });
});
