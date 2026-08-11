import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CloudStrategyLauncher,
  type CloudAutomationTemplate,
} from "../components/runs/CloudStrategyLauncher";
import { BOT_CATALOG } from "../data/bots";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const source = BOT_CATALOG.find(({ id }) => id === "breakout-hunter")!;
const template: CloudAutomationTemplate = {
  config: {
    id: source.id, name: source.name, exchange: source.exchange, market: source.market,
    symbol: source.symbol, timeframe: source.timeframe, logicMode: source.logicMode,
    leverage: source.leverage, blocks: source.blocks,
  },
  description: source.description,
  riskNote: source.riskNote,
  tags: source.tags,
};
const hash = "a".repeat(64);
const spotSource = BOT_CATALOG.find(({ id }) => id === "orbit-dca")!;
const spotTemplate: CloudAutomationTemplate = {
  config: {
    id: spotSource.id, name: spotSource.name, exchange: spotSource.exchange, market: spotSource.market,
    symbol: spotSource.symbol, timeframe: spotSource.timeframe, logicMode: spotSource.logicMode,
    leverage: spotSource.leverage, blocks: spotSource.blocks,
  },
  description: spotSource.description,
  riskNote: spotSource.riskNote,
  tags: spotSource.tags,
};

describe("control-console API automation launcher", () => {
  it("saves, backtests, and launches a user-scoped cloud strategy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account: {
          connectionStatus: "active",
          withdrawalAccessAbsent: true,
          permissions: { read: true, futuresTrade: true, spotTrade: true },
        }, runs: [], realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        idempotent: false,
        strategyVersion: { id: "sv_1", strategyId: "strategy_1", version: 1, configHash: hash, createdAt: 1 },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        backtest: {
          id: "bt_1", strategyVersionId: "sv_1", status: "succeeded", evidenceLevel: "historical",
          dataset: { complete: true }, result: { configurationHash: hash },
        },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run: { id: "crun_1" }, idempotent: false }), { status: 201 }));
    const user = userEvent.setup();
    render(<CloudStrategyLauncher templates={[template]} />);

    expect(await screen.findByText("WEEX API 已具備合約真倉交易權限。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "同意風險並啟動 USDT 真倉" }));

    expect(await screen.findByText(/USDT 真倉自動交易策略已啟動/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "真倉策略已啟動" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/cloud-runs", "/api/strategies", "/api/backtests", "/api/cloud-runs",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      config: { id: "breakout-hunter", market: "futures", symbol: "BTCUSDT", leverage: 6 },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      strategyVersionId: "sv_1", market: "futures", fundingMode: "historical", gapPolicy: "fail",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toMatchObject({
      strategyVersionId: "sv_1", configurationHash: hash,
      mode: "live",
      liveConfirmation: { acknowledged: true },
      riskPolicy: { operationMode: "automatic", maxLeverage: "6", allowedSymbols: ["BTCUSDT"] },
    });
  });

  it("does not run a backtest when the user has no active WEEX connection", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      account: null, runs: [], realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
    }), { status: 200 }));
    render(<CloudStrategyLauncher templates={[template]} />);

    expect(await screen.findByText(/尚未完成合約真倉權限驗證/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "同意風險並啟動 USDT 真倉" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "前往連線設定" })).toHaveAttribute("href", "/connections");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("launches a spot strategy as live funds with spot evidence and no funding-rate request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account: {
          connectionStatus: "active",
          withdrawalAccessAbsent: true,
          permissions: { read: true, futuresTrade: true, spotTrade: true },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        strategyVersion: { id: "sv_spot", configHash: hash },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        backtest: {
          strategyVersionId: "sv_spot",
          status: "succeeded",
          evidenceLevel: "historical",
          dataset: { complete: true },
          result: { configurationHash: hash },
        },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run: { id: "crun_spot" } }), { status: 201 }));
    const user = userEvent.setup();
    render(<CloudStrategyLauncher templates={[spotTemplate]} />);

    expect(await screen.findByText("WEEX API 已具備現貨真倉交易權限。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "同意風險並啟動 USDT 真倉" }));
    expect(await screen.findByText(/USDT 真倉自動交易策略已啟動/)).toBeInTheDocument();

    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      market: "spot",
      fundingMode: "none",
      leverage: "1",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toMatchObject({
      mode: "live",
      strategyVersionId: "sv_spot",
    });
  });

  it("uses a fresh backtest workflow when retrying an authoritative failed job", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account: {
          connectionStatus: "active",
          withdrawalAccessAbsent: true,
          permissions: { read: true, futuresTrade: true, spotTrade: true },
        }, runs: [], realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        strategyVersion: { id: "sv_1", configHash: hash },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "backtest_execution_failed" },
      }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        strategyVersion: { id: "sv_1", configHash: hash },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        backtest: {
          id: "bt_retry", strategyVersionId: "sv_1", status: "succeeded", evidenceLevel: "historical",
          dataset: { complete: true }, result: { configurationHash: hash },
        },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run: { id: "crun_retry" } }), { status: 201 }));
    const user = userEvent.setup();
    render(<CloudStrategyLauncher templates={[template]} />);

    expect(await screen.findByText("WEEX API 已具備合約真倉交易權限。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "同意風險並啟動 USDT 真倉" }));
    expect(await screen.findByText("歷史回測未能完成，策略尚未啟動。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "同意風險並啟動 USDT 真倉" }));

    expect(await screen.findByText(/USDT 真倉自動交易策略已啟動/)).toBeInTheDocument();
    const firstBacktestKey = new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("Idempotency-Key");
    const retryBacktestKey = new Headers(fetchMock.mock.calls[4]?.[1]?.headers).get("Idempotency-Key");
    expect(firstBacktestKey).toMatch(/^console-backtest-/);
    expect(retryBacktestKey).toMatch(/^console-backtest-/);
    expect(retryBacktestKey).not.toBe(firstBacktestKey);
  });

  it("reports a cloud runtime service failure without blaming WEEX permissions", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account: {
          connectionStatus: "active",
          withdrawalAccessAbsent: true,
          permissions: { read: true, futuresTrade: true, spotTrade: true },
        }, runs: [], realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        strategyVersion: { id: "sv_1", configHash: hash },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        backtest: {
          id: "bt_1", strategyVersionId: "sv_1", status: "succeeded", evidenceLevel: "historical",
          dataset: { complete: true }, result: { configurationHash: hash },
        },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "cloud_run_service_unavailable",
      }), { status: 503 }));
    const user = userEvent.setup();
    render(<CloudStrategyLauncher templates={[template]} />);

    expect(await screen.findByText("WEEX API 已具備合約真倉交易權限。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "同意風險並啟動 USDT 真倉" }));

    expect(await screen.findByText("雲端運行服務暫時無法建立策略，請稍後再試。")).toBeInTheDocument();
    expect(screen.queryByText(/確認 WEEX API 已啟用合約交易權限/)).not.toBeInTheDocument();
  });

  it("explains when the same WEEX target is already controlled by another strategy", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account: {
          connectionStatus: "active",
          withdrawalAccessAbsent: true,
          permissions: { read: true, futuresTrade: true, spotTrade: true },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        strategyVersion: { id: "sv_1", configHash: hash },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        backtest: {
          id: "bt_1", strategyVersionId: "sv_1", status: "succeeded", evidenceLevel: "historical",
          dataset: { complete: true }, result: { configurationHash: hash },
        },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "cloud_run_target_conflict" }), { status: 409 }));
    const user = userEvent.setup();
    render(<CloudStrategyLauncher templates={[template]} />);

    await user.click(await screen.findByRole("button", { name: "同意風險並啟動 USDT 真倉" }));

    expect(await screen.findByText("同一個 WEEX 帳戶的此市場與交易對已有未停止策略。請先停止原策略，再啟動新版本。"))
      .toBeInTheDocument();
  });
});
