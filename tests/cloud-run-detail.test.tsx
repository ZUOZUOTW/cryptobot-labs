import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudRunDetailPanel } from "../components/runs/CloudRunDetailPanel";
import { CLOUD_RUNS_REFRESH_EVENT } from "../components/runs/events";

vi.mock("../components/I18nProvider", () => ({
  useI18n: () => ({ locale: "zh-TW" }),
}));

const run = {
  id: "crun_live_1",
  name: "突破獵手",
  mode: "live",
  state: "error",
  market: "futures",
  symbol: "BTCUSDT",
  version: 2,
  lastCandleAt: 1_760_000_000_000,
  lastEvaluatedAt: 1_760_000_100_000,
  lastSignalJson: null,
  lastErrorCode: "execution_failed",
  consecutiveFailures: 4,
  updatedAt: 1_760_000_200_000,
  allowedSymbols: ["BTCUSDT"],
  accountAsset: "USDT",
  accountObservedAt: 1_760_000_300_000,
  accountEquity: "5000",
  availableEquity: "5000",
  unrealizedPnl: "0",
  positionsJson: [],
  evaluationCount: 3,
  signalCount: 0,
  maxTotalExposure: "1000",
  maxDailyLoss: "100",
};

const payload = {
  runs: [run],
  account: {
    observedAt: 1_760_000_300_000,
    accountEquity: "5000",
    availableEquity: "5000",
    unrealizedPnl: "0",
    positionsJson: [],
  },
};
const emptyOrders = { orders: [] };
const filledOrder = {
  runId: "crun_live_1",
  candleCloseAt: 1_760_000_000_000,
  createdAt: 1_760_000_000_001,
  updatedAt: 1_760_000_000_100,
  lifecycleStatus: "acknowledged",
  evidenceLevel: "authoritative",
  errorCode: "exchange_order_filled",
  clientOrderId: "safe-client-id",
  exchangeOrderId: "exchange-order-id",
  symbol: "BTCUSDT",
  side: "buy",
  quantity: "0.001",
  requestedPrice: "64000",
  providerStatus: "FILLED",
  cumulativeFilledQuantity: "0.001",
  averageFillPrice: "64000",
  fees: "0.01",
  fills: [],
  evidenceObservedAt: 1_760_000_000_100,
};

const position = (symbol: string, unrealizedPnl: string) => ({
  symbol,
  side: "long" as const,
  leverage: "2",
  size: "1",
  openValue: "50",
  unrealizedPnl,
  updatedAt: 1_760_000_300_000,
});

const usePayload = (value: unknown) => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(value), { status: 200 }));
};

const fact = (label: string): HTMLElement => screen.getByText(label).closest("div") as HTMLElement;

describe("CloudRunDetailPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    ));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads a crun deployment from the cloud-runs API instead of the legacy runs API", async () => {
    render(<CloudRunDetailPanel runId="crun_live_1" />);

    expect(await screen.findByRole("heading", { name: "突破獵手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢復策略" })).toBeEnabled();
    expect(screen.getByText("Executor 暫停原因：策略執行遇到未分類錯誤。系統已安全暫停，請重新整理；若仍發生請聯絡支援。")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/cloud-runs", expect.objectContaining({ cache: "no-store" }));
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/runs/"), expect.anything());
  });

  it("loads the run-bound order projection from the owner-scoped cloud-run endpoint", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ orders: [{
        runId: "crun_live_1", candleCloseAt: 1_760_000_000_000,
        createdAt: 1_760_000_000_001, updatedAt: 1_760_000_000_100,
        lifecycleStatus: "unknown", evidenceLevel: "uncertain",
        errorCode: "order_reconciliation_required", clientOrderId: "safe-client-id",
        exchangeOrderId: null, symbol: "BTCUSDT", side: "buy", quantity: "0.001",
        requestedPrice: "64000", providerStatus: null, cumulativeFilledQuantity: null,
        averageFillPrice: null, fees: null, fills: [], evidenceObservedAt: null,
      }] }), { status: 200 }));

    render(<CloudRunDetailPanel runId="crun_live_1" />);

    expect(await screen.findByRole("heading", { name: "最近委託與成交對帳" })).toBeInTheDocument();
    expect(screen.getByText("待對帳（狀態不確定）")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/cloud-runs/crun_live_1",
      expect.objectContaining({ cache: "no-store" }));
  });

  it("marks retained evidence stale after a background failure and preserves it after manual retry failure", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ orders: [filledOrder] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockRejectedValueOnce(new Error("background order evidence unavailable"))
      .mockRejectedValueOnce(new Error("manual order evidence unavailable"));
    const user = userEvent.setup();
    render(<CloudRunDetailPanel runId="crun_live_1" />);

    expect(await screen.findByText("交易所已成交")).toBeInTheDocument();
    const later = Date.now() + 2_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    window.dispatchEvent(new Event(CLOUD_RUNS_REFRESH_EVENT));

    const section = screen.getByRole("region", { name: "最近委託與成交對帳" });
    const alert = await within(section).findByRole("alert");
    expect(alert).toHaveTextContent("不代表目前即時狀態");
    expect(section).toHaveAttribute("data-evidence-state", "stale");
    expect(screen.getByText("交易所已成交")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新載入委託證據" }));

    await waitFor(() => expect(section).toHaveAttribute("data-evidence-state", "error"));
    expect(section).toHaveAttribute("data-evidence-freshness", "stale");
    expect(screen.getByText("交易所已成交")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("resumes with the current version and explains order reconciliation", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(emptyOrders), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        run: { ...run, state: "running", version: 3, lastErrorCode: null, consecutiveFailures: 0 },
      }), { status: 200 }));
    const user = userEvent.setup();
    render(<CloudRunDetailPanel runId="crun_live_1" />);

    await user.click(await screen.findByRole("button", { name: "恢復策略" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/cloud-runs/crun_live_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ state: "running", expectedVersion: 2 }),
      })));
    expect(await screen.findByText("恢復命令已接受；Executor 將先核對未完成訂單，再評估新行情。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暫停新增交易" })).toBeEnabled();
  });

  it("keeps a paused run unchanged when another strategy already controls the same target", async () => {
    const paused = { ...run, state: "paused", lastErrorCode: null, consecutiveFailures: 0 };
    const pausedPayload = { ...payload, runs: [paused] };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(pausedPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(emptyOrders), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "cloud_run_target_conflict" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pausedPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(emptyOrders), { status: 200 }));
    const user = userEvent.setup();
    render(<CloudRunDetailPanel runId="crun_live_1" />);

    await user.click(await screen.findByRole("button", { name: "恢復策略" }));

    expect(await screen.findByText("此 WEEX 帳戶的同一市場與交易對已有其他未停止策略；目前策略維持原狀，請先停止原策略再恢復。"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢復策略" })).toBeEnabled();
  });

  it("keeps a run and its target active while an exchange order is still settling", async () => {
    const running = { ...run, state: "running", lastErrorCode: null, consecutiveFailures: 0 };
    const runningPayload = { ...payload, runs: [running] };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(runningPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(emptyOrders), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "cloud_run_order_in_flight" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(runningPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(emptyOrders), { status: 200 }));
    const user = userEvent.setup();
    render(<CloudRunDetailPanel runId="crun_live_1" />);

    await user.click(await screen.findByRole("button", { name: "停止策略" }));

    expect(await screen.findByText("交易所訂單仍在核對中；策略維持原狀，交易目標尚未釋放。請等待訂單取得最終狀態後再停止。"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止策略" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith("/api/cloud-runs/crun_live_1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ state: "stopped", expectedVersion: 2 }),
    }));
  });

  it("uses the exact persisted target instead of a broad risk allowlist and separates account PnL", async () => {
    const selected = {
      ...run,
      state: "running",
      lastErrorCode: null,
      consecutiveFailures: 0,
      allowedSymbols: ["BTCUSDT", "ETHUSDT"],
    };
    usePayload({
      runs: [selected],
      account: {
        ...payload.account,
        unrealizedPnl: "11.25",
        positionsJson: [position("BTCUSDT", "4.25"), position("ETHUSDT", "7")],
      },
    });

    render(<CloudRunDetailPanel runId={selected.id} />);

    expect(await screen.findByText("BTCUSDT · 合約")).toBeInTheDocument();
    expect(within(fact("交易目標部位未實現損益")).getByText("4.25 USDT")).toBeInTheDocument();
    expect(within(fact("帳戶未實現損益")).getByText("11.25 USDT")).toBeInTheDocument();
    expect(screen.getByText("帳戶聚合，非 run_id 成交歸屬")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "BTCUSDT" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "ETHUSDT" })).not.toBeInTheDocument();
  });

  it("does not manufacture zero target PnL before the first account position snapshot", async () => {
    const selected = { ...run, state: "running", lastErrorCode: null, consecutiveFailures: 0 };
    usePayload({
      runs: [selected],
      account: {
        ...payload.account,
        observedAt: null,
        accountEquity: null,
        availableEquity: null,
        unrealizedPnl: null,
        positionsJson: null,
      },
    });

    render(<CloudRunDetailPanel runId={selected.id} />);

    expect(await screen.findByText("尚無可用的帳戶部位快照，暫不顯示目標部位與損益。"))
      .toBeInTheDocument();
    expect(within(fact("交易目標部位未實現損益")).getByText("尚無可信證據")).toBeInTheDocument();
    expect(within(fact("交易目標部位未實現損益")).queryByText("0.00 USDT")).not.toBeInTheDocument();
  });

  it("sums target position PnL without unsafe-number rounding", async () => {
    const selected = { ...run, state: "running", lastErrorCode: null, consecutiveFailures: 0 };
    usePayload({
      ...payload,
      runs: [selected],
      account: {
        ...payload.account,
        positionsJson: [
          position("BTCUSDT", "9007199254740992.1"),
          { ...position("BTCUSDT", "0.9"), side: "short" },
        ],
      },
    });

    render(<CloudRunDetailPanel runId={selected.id} />);

    await screen.findByText("交易目標部位未實現損益");
    expect(within(fact("交易目標部位未實現損益"))
      .getByText("9,007,199,254,740,993.00 USDT")).toBeInTheDocument();
  });

  it("ignores a same-symbol spot run when attributing a live futures target", async () => {
    const selected = { ...run, state: "running", lastErrorCode: null, consecutiveFailures: 0 };
    usePayload({
      ...payload,
      runs: [
        { ...selected, id: "spot_1", name: "Spot", market: "spot" },
        selected,
      ],
      account: { ...payload.account, positionsJson: [position("BTCUSDT", "5")] },
    });

    render(<CloudRunDetailPanel runId={selected.id} />);

    expect(await screen.findByRole("cell", { name: "BTCUSDT" })).toBeInTheDocument();
    expect(within(fact("交易目標部位未實現損益")).getByText("5.00 USDT")).toBeInTheDocument();
  });

  it("does not attach a futures account position to the same-symbol spot run", async () => {
    const spot = {
      ...run,
      id: "spot_1",
      name: "Spot",
      state: "running",
      market: "spot",
      lastErrorCode: null,
      consecutiveFailures: 0,
    };
    const live = { ...spot, id: "live_1", name: "Live", market: "futures" };
    usePayload({
      ...payload,
      runs: [spot, live],
      account: { ...payload.account, positionsJson: [position("BTCUSDT", "5")] },
    });

    render(<CloudRunDetailPanel runId={spot.id} />);

    expect(await screen.findByText("這是現貨策略；帳戶合約部位不會歸屬到此策略。"))
      .toBeInTheDocument();
    expect(within(fact("交易目標部位未實現損益")).getByText("不適用")).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "BTCUSDT" })).not.toBeInTheDocument();
  });

  it("ignores a stopped predecessor when attributing its live successor", async () => {
    const selected = { ...run, state: "running", lastErrorCode: null, consecutiveFailures: 0 };
    usePayload({
      ...payload,
      runs: [{ ...selected, id: "stopped_1", name: "Stopped", state: "stopped" }, selected],
      account: { ...payload.account, positionsJson: [position("BTCUSDT", "6")] },
    });

    render(<CloudRunDetailPanel runId={selected.id} />);

    expect(await screen.findByRole("cell", { name: "BTCUSDT" })).toBeInTheDocument();
    expect(within(fact("交易目標部位未實現損益")).getByText("6.00 USDT")).toBeInTheDocument();
  });

  it("does not attach a current account position to the stopped predecessor", async () => {
    const stopped = {
      ...run,
      id: "stopped_1",
      name: "Stopped",
      state: "stopped",
      lastErrorCode: null,
      consecutiveFailures: 0,
    };
    const live = { ...stopped, id: "live_1", name: "Live", state: "running" };
    usePayload({
      ...payload,
      runs: [stopped, live],
      account: { ...payload.account, positionsJson: [position("BTCUSDT", "6")] },
    });

    render(<CloudRunDetailPanel runId={stopped.id} />);

    expect(await screen.findByText("此策略已停止，不歸屬目前帳戶合約部位。"))
      .toBeInTheDocument();
    expect(within(fact("交易目標部位未實現損益")).getByText("不適用")).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "BTCUSDT" })).not.toBeInTheDocument();
  });

  it("keeps legacy duplicate live targets unassigned", async () => {
    const selected = { ...run, state: "running", lastErrorCode: null, consecutiveFailures: 0 };
    usePayload({
      ...payload,
      runs: [selected, { ...selected, id: "duplicate_1", name: "Duplicate" }],
      account: { ...payload.account, unrealizedPnl: "7", positionsJson: [position("BTCUSDT", "7")] },
    });

    render(<CloudRunDetailPanel runId={selected.id} />);

    expect(await screen.findByText("多個未停止策略共用相同合約交易目標，無法安全歸屬帳戶部位。"))
      .toBeInTheDocument();
    expect(within(fact("交易目標部位未實現損益")).getByText("不可歸屬")).toBeInTheDocument();
    expect(within(fact("帳戶未實現損益")).getByText("7.00 USDT")).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "BTCUSDT" })).not.toBeInTheDocument();
  });

  it("does not attribute an existing position while Executor reports unmanaged position state", async () => {
    const selected = { ...run, lastErrorCode: "unmanaged_position_state" };
    usePayload({
      ...payload,
      runs: [selected],
      account: { ...payload.account, unrealizedPnl: "8", positionsJson: [position("BTCUSDT", "8")] },
    });

    render(<CloudRunDetailPanel runId={selected.id} />);

    expect(await screen.findByText("帳戶已有未受此運行管理的部位，無法安全歸屬部位與損益。"))
      .toBeInTheDocument();
    expect(within(fact("交易目標部位未實現損益")).getByText("不可歸屬")).toBeInTheDocument();
    expect(within(fact("帳戶未實現損益")).getByText("8.00 USDT")).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "BTCUSDT" })).not.toBeInTheDocument();
  });

  it("does not attach live account positions to a futures-demo run", async () => {
    const demo = {
      ...run,
      id: "demo_1",
      name: "Demo",
      mode: "futures-demo",
      state: "running",
      accountAsset: "SUSDT",
      accountEquity: "10000",
      availableEquity: "9950",
      unrealizedPnl: "12.5",
      positionsJson: [position("BTCUSDT", "12.5")],
      lastErrorCode: null,
      consecutiveFailures: 0,
    };
    const live = { ...demo, id: "live_1", name: "Live", mode: "live" };
    usePayload({
      ...payload,
      runs: [demo, live],
      account: {
        ...payload.account,
        accountEquity: "5000",
        availableEquity: "4900",
        unrealizedPnl: "9",
        positionsJson: [position("BTCUSDT", "9")],
      },
    });

    render(<CloudRunDetailPanel runId={demo.id} />);

    expect(await screen.findByRole("heading", { name: "模擬策略部位" })).toBeInTheDocument();
    expect(within(fact("模擬權益")).getByText("10,000.00 SUSDT")).toBeInTheDocument();
    expect(within(fact("模擬可用權益")).getByText("9,950.00 SUSDT")).toBeInTheDocument();
    expect(within(fact("模擬未實現損益")).getByText("12.50 SUSDT")).toBeInTheDocument();
    expect(within(fact("交易目標部位未實現損益")).getByText("12.50 SUSDT")).toBeInTheDocument();
    expect(screen.getByText("此運行的 WEEX Futures Demo 快照")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "12.5 SUSDT" })).toBeInTheDocument();
    expect(screen.queryByText("5,000.00 USDT")).not.toBeInTheDocument();
    expect(screen.queryByText("9.00 USDT")).not.toBeInTheDocument();
  });

  it("keeps a live target attributable when a same-symbol demo run exists", async () => {
    const selected = { ...run, state: "running", lastErrorCode: null, consecutiveFailures: 0 };
    const demo = { ...selected, id: "demo_1", name: "Demo", mode: "futures-demo" };
    usePayload({
      ...payload,
      runs: [demo, selected],
      account: { ...payload.account, positionsJson: [position("BTCUSDT", "9")] },
    });

    render(<CloudRunDetailPanel runId={selected.id} />);

    expect(await screen.findByRole("cell", { name: "BTCUSDT" })).toBeInTheDocument();
    expect(within(fact("交易目標部位未實現損益")).getByText("9.00 USDT")).toBeInTheDocument();
  });
});
