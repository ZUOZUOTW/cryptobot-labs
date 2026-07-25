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
  it("creates a 24/7 WEEX Futures Demo run from verified historical evidence", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      run: { id: "crun_1" }, idempotent: false,
    }), { status: 201 }));
    const user = userEvent.setup(); render(<CreateRunPanel backtest={backtest} config={config} />);
    await user.click(screen.getByRole("button", { name: "設定風控並啟動雲端策略" }));
    await user.click(screen.getByRole("button", { name: "啟動 24/7 雲端策略" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/cloud-runs");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      strategyVersionId: "sv_1", botName: config.name, configurationHash: "a".repeat(64),
      riskPolicy: { allowedSymbols: ["BTCUSDT"], maxLeverage: String(config.leverage), operationMode: "automatic" } });
    expect(await screen.findByText(/雲端運行已啟動/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往雲端運行控制中心" })).toHaveAttribute("href", "/runs");
  });

  it("never renders deployment controls for a failed or incomplete backtest", () => {
    const { container } = render(<CreateRunPanel backtest={{ ...backtest, status: "failed", result: null }} config={config} />);
    expect(container).toBeEmptyDOMElement();
  });
});
