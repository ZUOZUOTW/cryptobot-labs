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
  it("saves an immutable version, creates verified evidence, and publishes a public page", async () => {
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
          publication: { slug: "strategy-communitycopy" },
        }), { status: 201 });
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

    await user.type(screen.getByRole("textbox", { name: "你的 WEEX 邀請註冊連結" }),
      "https://www.weex.com/register?inviteCode=TEST");
    await user.click(screen.getByRole("button", { name: "建立分享連結" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/strategies",
      "/api/backtests",
      "/api/strategy-publications",
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent("策略已發布到公開列表");
  });
});
