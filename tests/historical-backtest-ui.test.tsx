import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BacktestHistory } from "../components/backtests/BacktestHistory";
import { BacktestRequestForm } from "../components/backtests/BacktestRequestForm";
import { BacktestResultCard, type HistoricalBacktestRecord } from "../components/backtests/BacktestResultCard";
import { STRATEGY_PRESETS } from "../data/strategies";
import WorkshopPage from "../app/workshop/page";
import { attestHistoricalReportForConfig } from "../lib/historical-evidence";

const succeededBacktest: HistoricalBacktestRecord = {
  id: "job-owner-1",
  strategyVersionId: "version-1",
  status: "succeeded",
  evidenceLevel: "historical",
  request: {
    strategyVersionId: "version-1", market: "spot", symbol: "BTCUSDT", interval: "1h",
    startTime: 1_700_000_000_000, endTime: 1_700_086_400_000, initialCapital: "10000",
    feeRate: "0.001", slippageRate: "0.0005", leverage: "1", fundingMode: "none", gapPolicy: "fail",
  },
  error: null,
  createdAt: 1_700_086_400_000,
  startedAt: 1_700_086_400_100,
  completedAt: 1_700_086_401_000,
  dataset: {
    id: "dataset-1", market: "spot", symbol: "BTCUSDT", interval: "1h", source: "WEEX public API",
    requestedStartAt: 1_700_000_000_000, requestedEndAt: 1_700_086_400_000,
    actualStartAt: 1_700_000_000_000, actualEndAt: 1_700_086_399_999, complete: true,
    gaps: [], checksum: "d".repeat(64),
  },
  result: {
    id: "result-1",
    funding: { convention: "long-pays-positive-short-receives-positive", suppliedEvents: 0, appliedEvents: 0, netFunding: "0" },
    metrics: { totalReturn: "0.12", annualizedReturn: "0.23", maxDrawdown: "0.04", winRate: "0.58", profitFactor: "1.7", sharpe: "1.2", trades: 18 },
    provenance: {
      provider: "WEEX", dataSource: "public-api", sourceKind: "public-api",
      requestedRange: { startTime: 1_700_000_000_000, endTime: 1_700_086_400_000 },
      fetchedRange: { startTime: 1_700_000_000_000, endTime: 1_700_086_399_999 },
      gaps: [], gapCount: 0, duplicateCount: 0, incompleteCount: 0, complete: true,
      feeRate: "0.001", slippageRate: "0.0005",
      fundingTreatment: { convention: "long-pays-positive-short-receives-positive", suppliedEvents: 0, appliedEvents: 0, netFunding: "0" },
      market: "spot", symbol: "BTCUSDT", interval: "1h", engineVersion: "engine-v1",
      configHash: "c".repeat(64), strategyHash: "s".repeat(64), datasetDigest: "d".repeat(64),
      executionConvention: { signalEvaluation: "completed-candle-close", signalExecution: "next-candle-open", riskTrigger: "close-only-not-intrabar" },
      liquidationModel: { maintenanceMarginRate: "0", maximumSupportedLeverage: "500", check: "funding-event-mark-immediately-then-candle-low-long-high-short", orderingAssumption: "funding-applied-at-event-timestamp-before-candle-wide-adverse-extreme", model: "fixed-conservative-not-weex-tier-exact" },
    },
    equityCurve: [{ timestamp: 1_700_000_000_000, equity: "10000" }, { timestamp: 1_700_086_399_999, equity: "11200" }],
    engineVersion: "engine-v1", configurationHash: "c".repeat(64), strategyHash: "s".repeat(64), scriptHash: null,
  },
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("historical backtest UI", () => {
  it("uses exact evidence labels and never presents historical evidence as live performance", () => {
    render(<BacktestResultCard backtest={succeededBacktest} />);
    expect(screen.getByText("歷史回測")).toBeInTheDocument();
    expect(screen.getByText("公開歷史行情")).toBeInTheDocument();
    expect(screen.getByText("不是實盤績效")).toBeInTheDocument();
    expect(screen.getByText(/完整資料/)).toBeInTheDocument();
    expect(screen.getByText(/資料缺口 0/)).toBeInTheDocument();
    expect(screen.getByText(/重複 0/)).toBeInTheDocument();
    expect(screen.getByText(/未完成 0/)).toBeInTheDocument();
    expect(screen.getByText(/策略風控：僅收盤價、非盤中/)).toBeInTheDocument();
    expect(screen.getByText(/清算另採盤中極值/)).toBeInTheDocument();
    expect(screen.getByText(/資金費率在事件時間先套用/)).toBeInTheDocument();
    expect(screen.getByText(/模型上限 500×/)).toBeInTheDocument();
    expect(screen.getByText(/固定保守估算模型/)).toBeInTheDocument();
    expect(screen.getAllByText(/實盤績效/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^實盤$/)).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /權益曲線/ })).toBeInTheDocument();
  });

  it("ensures an immutable visual strategy version before posting an idempotent request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ strategyVersion: { id: "version-1", strategyId: "strategy-1", version: 1, configHash: "c".repeat(64), createdAt: 1_700_000_000_000 }, idempotent: false }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ backtest: succeededBacktest }), { status: 201 }));
    const user = userEvent.setup();
    const view = render(<BacktestRequestForm config={STRATEGY_PRESETS[0]} />);

    await user.click(screen.getByRole("button", { name: "執行進階歷史回測" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/strategies");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ config: STRATEGY_PRESETS[0] });
    const second = fetchMock.mock.calls[1];
    expect(second?.[0]).toBe("/api/backtests");
    expect(new Headers((second?.[1] as RequestInit).headers).get("Idempotency-Key")).toMatch(/^historical-/);
    const request = JSON.parse(String((second?.[1] as RequestInit).body));
    expect(request).toMatchObject({ strategyVersionId: "version-1", market: "spot", symbol: STRATEGY_PRESETS[0].symbol, gapPolicy: "fail" });
    expect(request.endTime).toBeGreaterThan(request.startTime);
    expect(screen.getByText("不是實盤績效")).toBeInTheDocument();
    view.rerender(<BacktestRequestForm config={{ ...STRATEGY_PRESETS[0], leverage: 2, source: "return;" }} />);
    expect(screen.queryByText("不是實盤績效")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "執行進階歷史回測" })).toBeDisabled();
  });

  it("keeps disclose mode available on the standalone page without mislabeling a successful result", async () => {
    const succeededRequest = succeededBacktest.request!;
    const disclosedBacktest: HistoricalBacktestRecord = {
      ...succeededBacktest,
      request: { ...succeededRequest, gapPolicy: "disclose" },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ strategyVersion: {
        id: "version-1", strategyId: "strategy-1", version: 1, configHash: "c".repeat(64),
        createdAt: 1_700_000_000_000,
      }, idempotent: false }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ backtest: disclosedBacktest }), { status: 201 }));
    const onVerifiedReport = vi.fn();
    const user = userEvent.setup();
    render(<BacktestRequestForm config={STRATEGY_PRESETS[0]} onVerifiedReport={onVerifiedReport} />);

    const gapPolicy = screen.getByRole("combobox", { name: "資料缺口" });
    expect(gapPolicy).toBeEnabled();
    await user.selectOptions(gapPolicy, "disclose");
    await user.click(screen.getByRole("button", { name: "執行進階歷史回測" }));

    expect(await screen.findByText("不是實盤績效")).toBeInTheDocument();
    expect(screen.queryByText(/回測證據與目前策略版本不一致/)).not.toBeInTheDocument();
    expect(onVerifiedReport).not.toHaveBeenCalled();
    const request = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(request.gapPolicy).toBe("disclose");
  });

  it("reuses request-bound idempotency keys after a lost response and rotates them after success", async () => {
    const strategy = (idempotent: boolean) => new Response(JSON.stringify({ strategyVersion: {
      id: "version-1", strategyId: "strategy-1", version: 1, configHash: "c".repeat(64), createdAt: 1_700_000_000_000,
    }, idempotent }), { status: idempotent ? 200 : 201 });
    const completed = () => new Response(JSON.stringify({ backtest: succeededBacktest }), { status: 201 });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(strategy(false))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(strategy(true))
      .mockResolvedValueOnce(completed())
      .mockResolvedValueOnce(strategy(true))
      .mockResolvedValueOnce(completed());
    const user = userEvent.setup();
    render(<BacktestRequestForm config={STRATEGY_PRESETS[0]} />);

    await user.click(screen.getByRole("button", { name: "執行進階歷史回測" }));
    expect(await screen.findByText(/暫時無法執行/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "執行進階歷史回測" }));
    expect(await screen.findByText("不是實盤績效")).toBeInTheDocument();

    const key = (call: number) => new Headers((fetchMock.mock.calls[call]?.[1] as RequestInit).headers).get("Idempotency-Key");
    expect(key(0)).toBe(key(2));
    expect(key(1)).toBe(key(3));

    await user.click(screen.getByRole("button", { name: "執行進階歷史回測" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(key(4)).not.toBe(key(2));
    expect(key(5)).not.toBe(key(3));
  });

  it("offers sign-in recovery and blocks invalid JavaScript before persistence", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const onStateChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<BacktestRequestForm config={STRATEGY_PRESETS[0]} onStateChange={onStateChange} />);
    await user.click(screen.getByRole("button", { name: "執行進階歷史回測" }));
    expect(await screen.findByRole("link", { name: "登入" })).toHaveAttribute("href", "/auth?return_to=%2Fbacktests");
    expect(onStateChange).toHaveBeenCalledWith("ensuring");
    expect(onStateChange).toHaveBeenLastCalledWith("unauthorized");

    rerender(<BacktestRequestForm config={{ ...STRATEGY_PRESETS[0], source: "fetch('https://example.com')" }} onStateChange={onStateChange} />);
    const button = screen.getByRole("button", { name: "執行進階歷史回測" });
    expect(button).toBeDisabled();
    expect(screen.getByText(/回測結果會記錄程式碼雜湊/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("submits a valid JavaScript strategy for immutable save and sandbox backtest",async()=>{
    const preset=STRATEGY_PRESETS[0];
    const source=`export const strategy={exchange:"WEEX",market:"spot",symbol:${JSON.stringify(preset.symbol)},timeframe:${JSON.stringify(preset.timeframe)}};\nexport default () => ({action:"hold",reason:"test"});`;
    const custom={...preset,blocks:[],source};
    const fetchMock=vi.spyOn(globalThis,"fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({strategyVersion:{id:"version-js",strategyId:"strategy-js",version:1,configHash:"c".repeat(64),createdAt:1_700_000_000_000},idempotent:false}),{status:201}))
      .mockResolvedValueOnce(new Response(JSON.stringify({backtest:{...succeededBacktest,strategyVersionId:"version-js",result:{...succeededBacktest.result,scriptHash:"d".repeat(64)}}}),{status:201}));
    const user=userEvent.setup();
    render(<BacktestRequestForm config={custom}/>);
    const button=screen.getByRole("button",{name:"執行進階歷史回測"});
    expect(button).toBeEnabled();
    await user.click(button);
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({config:custom});
    expect(screen.getByText(/回測結果會記錄程式碼雜湊/)).toBeInTheDocument();
    expect(screen.queryByRole("heading",{name:"建立雲端交易機器人"})).not.toBeInTheDocument();
    expect(screen.getByText(/雲端 Executor 只支援視覺策略/)).toBeInTheDocument();
  });

  it("loads an ownership-shaped history response without caching and supports retry", async () => {
    const secondBacktest = { ...succeededBacktest, id: "job-owner-2", createdAt: succeededBacktest.createdAt - 1 };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("upstream", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [succeededBacktest], nextCursor: "1700086400000:job-owner-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("upstream", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [succeededBacktest, secondBacktest], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ backtest: succeededBacktest }), { status: 200 }));
    const user = userEvent.setup();
    render(<BacktestHistory />);
    expect(await screen.findByText(/無法載入歷史/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重試載入" }));
    expect(await screen.findByText("BTCUSDT")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/backtests?limit=20", expect.objectContaining({ cache: "no-store" }));
    expect(within(screen.getByRole("list", { name: "歷史回測紀錄" })).getByText("已完成")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "載入更多" }));
    expect(await screen.findByText(/無法載入更多/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重試載入更多" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/api/backtests?limit=20&cursor=1700086400000%3Ajob-owner-1");
    await user.click(screen.getAllByRole("button", { name: "查看完整結果" })[0]!);
    expect(await screen.findByText("不是實盤績效")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/backtests/job-owner-1", expect.objectContaining({ cache: "no-store" }));
  });

  it("runs the quick workshop check against the public WEEX historical endpoint", async () => {
    window.history.replaceState({}, "", "/workshop?bot=steady-trend");
    const quickConfig = STRATEGY_PRESETS[0];
    const quickReport = attestHistoricalReportForConfig({
      seed: "d".repeat(8), generatedAt: new Date(1_700_086_400_000).toISOString(),
      metrics: { totalReturn: -6.2, annualizedReturn: -54, maxDrawdown: -12, winRate: 25, profitFactor: 0.49, sharpe: -2.19, trades: 4, runningDays: 30, stability: 78 },
      equityCurve: [{ label: "01/01", value: 100 }, { label: "01/31", value: 93.8 }],
      disclaimer: "WEEX 歷史行情回測，不代表未來績效",
    }, { level: "historical", provider: "WEEX", market: "spot", symbol: "BTCUSDT", interval: "4h", startTime: 1_697_494_400_000, endTime: 1_700_086_400_000, collectedAt: 1_700_086_400_000, candleCount: 180, complete: true, feeRate: "0.001", slippageRate: "0.0005", fundingIncluded: false, gapPolicy: "fail", datasetDigest: "d".repeat(64), engineVersion: "test" }, quickConfig);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ report: quickReport }), { status: 200 }));
    const user = userEvent.setup();
    render(<WorkshopPage />);
    expect(screen.getByText("快速驗證 · 公開歷史 K 線 · 無需登入")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "保存、發布與分享策略" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "保存策略" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "發布到公開策略列表" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "分享策略連結" })).toBeInTheDocument();
    expect(document.querySelector('img[src*="ai-strategy-vault-v1.webp"]')).toBeInTheDocument();
    expect(document.querySelector('img[src*="ai-version-broadcast-v1.webp"]')).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "開始模擬運行" })).not.toBeInTheDocument();
    const quickButton = screen.getByRole("button", { name: "執行行情回測" });
    expect(screen.getByRole("spinbutton", { name: "手續費率" })).toHaveValue(0.001);
    expect(screen.getByRole("spinbutton", { name: "滑價率" })).toHaveValue(0.0005);
    expect(screen.getByRole("combobox", { name: "資金費率" })).toHaveValue("none");
    expect(screen.getByRole("combobox", { name: "資料缺口" })).toHaveValue("fail");
    expect(screen.queryByRole("heading", { name: "進階歷史回測" })).not.toBeInTheDocument();
    await user.click(quickButton);
    expect(await screen.findByRole("region", { name: "回測結果" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/weex/historical-backtest");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      config: STRATEGY_PRESETS[0],
      assumptions: { feeRate: "0.001", slippageRate: "0.0005", fundingMode: "none", gapPolicy: "fail" },
    });
    expect(screen.getByText("WEEX 歷史行情回測，不代表未來績效")).toBeInTheDocument();
  });
});
