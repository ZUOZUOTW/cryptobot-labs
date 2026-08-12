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
          permissions: { read: true, futuresTrade: false, futuresDemoTrade: true, liveVerified: false, spotTrade: false },
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

    expect(await screen.findByText("WEEX API 已具備合約 Demo 交易權限。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "啟動 SUSDT 合約 Demo" }));

    expect(await screen.findByText(/SUSDT 合約 Demo 自動交易策略已啟動/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Demo 策略已啟動" })).toBeDisabled();
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
      mode: "futures-demo",
      riskPolicy: { operationMode: "automatic", maxLeverage: "6", allowedSymbols: ["BTCUSDT"] },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).not.toHaveProperty("liveConfirmation");
  });

  it("does not run a backtest when the user has no active WEEX connection", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      account: null, runs: [], realizedPnl: { asset: "USDT", total: "0", tradeCount: 0, points: [] },
    }), { status: 200 }));
    render(<CloudStrategyLauncher templates={[template]} />);

    expect(await screen.findByText(/尚未完成合約 Demo 權限驗證/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "啟動 SUSDT 合約 Demo" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "前往連線設定" })).toHaveAttribute("href", "/connections");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("does not reinterpret an unverified live-futures flag as Demo capability", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      account: {
        connectionStatus: "active",
        withdrawalAccessAbsent: true,
        permissions: { read: true, futuresTrade: true, spotTrade: false },
      },
    }), { status: 200 }));
    render(<CloudStrategyLauncher templates={[template]} />);

    expect(await screen.findByText(/尚未完成合約 Demo 權限驗證/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "啟動 SUSDT 合約 Demo" })).toBeDisabled();
  });

  it("accepts the legacy fallback only when live futures permission was formally verified", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      account: {
        connectionStatus: "active",
        withdrawalAccessAbsent: true,
        permissions: { read: true, futuresTrade: true, liveVerified: true, spotTrade: false },
      },
    }), { status: 200 }));
    render(<CloudStrategyLauncher templates={[template]} />);

    expect(await screen.findByText("WEEX API 已具備合約 Demo 交易權限。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "啟動 SUSDT 合約 Demo" })).toBeEnabled();
  });

  it("fails spot cloud execution closed and routes the user to historical backtesting", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account: {
          connectionStatus: "active",
          withdrawalAccessAbsent: true,
          permissions: { read: true, futuresTrade: false, futuresDemoTrade: true, liveVerified: false, spotTrade: false },
        },
      }), { status: 200 }));
    render(<CloudStrategyLauncher templates={[spotTemplate]} />);

    expect(screen.getByRole("heading", { name: "現貨雲端模擬尚未開放" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往歷史回測" })).toHaveAttribute("href", "/workshop?bot=orbit-dca");
    expect(screen.queryByRole("button", { name: /啟動/ })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("uses a fresh backtest workflow when retrying an authoritative failed job", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account: {
          connectionStatus: "active",
          withdrawalAccessAbsent: true,
          permissions: { read: true, futuresTrade: false, futuresDemoTrade: true, liveVerified: false, spotTrade: false },
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

    expect(await screen.findByText("WEEX API 已具備合約 Demo 交易權限。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "啟動 SUSDT 合約 Demo" }));
    expect(await screen.findByText("歷史回測未能完成，策略尚未啟動。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "啟動 SUSDT 合約 Demo" }));

    expect(await screen.findByText(/SUSDT 合約 Demo 自動交易策略已啟動/)).toBeInTheDocument();
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
          permissions: { read: true, futuresTrade: false, futuresDemoTrade: true, liveVerified: false, spotTrade: false },
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

    expect(await screen.findByText("WEEX API 已具備合約 Demo 交易權限。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "啟動 SUSDT 合約 Demo" }));

    expect(await screen.findByText("雲端運行服務暫時無法建立策略，請稍後再試。")).toBeInTheDocument();
    expect(screen.queryByText(/確認 WEEX API 已啟用合約交易權限/)).not.toBeInTheDocument();
  });

  it("explains when the same WEEX target is already controlled by another strategy", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account: {
          connectionStatus: "active",
          withdrawalAccessAbsent: true,
          permissions: { read: true, futuresTrade: false, futuresDemoTrade: true, liveVerified: false, spotTrade: false },
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

    await user.click(await screen.findByRole("button", { name: "啟動 SUSDT 合約 Demo" }));

    expect(await screen.findByText("同一個 WEEX 帳戶的此市場與交易對已有未停止策略。請先停止原策略，再啟動新版本。"))
      .toBeInTheDocument();
  });
});
