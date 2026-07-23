import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HistoricalBacktestRecord } from "../components/backtests/BacktestResultCard";
import { CreateRunPanel } from "../components/runs/CreateRunPanel";
import { BOT_CATALOG } from "../data/bots";
import type { BotConfig } from "../lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const source = BOT_CATALOG.find(({ market }) => market === "futures")!;
const config: BotConfig = { id: source.id, name: source.name, exchange: "WEEX", market: source.market,
  symbol: source.symbol, timeframe: source.timeframe, logicMode: source.logicMode, leverage: source.leverage,
  blocks: source.blocks };
const backtest = { id: "bt_1", strategyVersionId: "sv_1", status: "succeeded", evidenceLevel: "historical",
  createdAt: 1, startedAt: 1, completedAt: 2, result: { configurationHash: "a".repeat(64) } } as HistoricalBacktestRecord;

describe("historical backtest to Agent run", () => {
  it("lets a novice select a paired device, choose automation policy, and create a paper-first run", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ connections: [{ id: "dev_1", name: "交易電腦",
        platform: "macos", deviceStatus: "active", lastSeenAt: 1, connection: { status: "verified",
          hasLocalCredential: true }, commandTarget: null }], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run: { id: "run_1" }, deploymentCommand: { status: "pending" },
        idempotent: false }), { status: 201 }));
    const user = userEvent.setup(); render(<CreateRunPanel backtest={backtest} config={config} />);
    await user.click(screen.getByRole("button", { name: "選擇裝置並建立模擬運行" }));
    expect(await screen.findByLabelText("執行裝置")).toHaveValue("dev_1");
    await user.selectOptions(screen.getByLabelText("執行方式"), "automatic");
    await user.click(screen.getByRole("button", { name: "建立模擬運行" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/runs");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ deviceId: "dev_1",
      strategyVersionId: "sv_1", botName: config.name, configurationHash: "a".repeat(64),
      riskPolicy: { allowedSymbols: ["BTCUSDT"], maxLeverage: String(config.leverage), operationMode: "automatic" } });
    expect(await screen.findByText(/模擬運行已建立/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往運行控制中心" })).toHaveAttribute("href", "/runs/run_1");
  });

  it("never renders deployment controls for a failed or incomplete backtest", () => {
    const { container } = render(<CreateRunPanel backtest={{ ...backtest, status: "failed", result: null }} config={config} />);
    expect(container).toBeEmptyDOMElement();
  });
});
