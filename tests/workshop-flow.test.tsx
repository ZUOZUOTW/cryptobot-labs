import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkshopPage from "../app/workshop/page";
import { I18nProvider } from "../components/I18nProvider";
import { BacktestPanel } from "../components/workshop/BacktestPanel";
import { BOT_CATALOG } from "../data/bots";
import { STRATEGY_BLOCKS, STRATEGY_PRESETS } from "../data/strategies";
import * as botPackage from "../lib/bot-package";
import { runBacktest } from "../lib/backtest";
import { validateConfig } from "../lib/strategy-validation";
import type { BacktestReport, BotConfig } from "../lib/types";
import { historicalConfigurationHash, historicalScriptHash } from "../lib/historical-evidence";
import { LOCALE_STORAGE_KEY } from "../lib/i18n/locales";

vi.mock("../lib/weex-historical-client", async () => {
  const { runBacktest: runLocalBacktest } = await vi.importActual<typeof import("../lib/backtest")>("../lib/backtest");
  const { attestHistoricalReportForConfig } = await vi.importActual<typeof import("../lib/historical-evidence")>("../lib/historical-evidence");
  return {
    runWeexHistoricalBacktest: vi.fn((config: BotConfig) => {
      const report = runLocalBacktest(config);
      const collectedAt = Date.parse(report.generatedAt);
      const datasetDigest = report.seed.padEnd(64, "0");
      return attestHistoricalReportForConfig({
        ...report,
        seed: datasetDigest.slice(0, 8),
        disclaimer: "WEEX 歷史行情回測，不代表未來績效",
      }, {
          level: "historical",
          provider: "WEEX",
          market: config.market,
          symbol: config.symbol,
          interval: config.timeframe,
          startTime: collectedAt - 30 * 24 * 60 * 60 * 1_000,
          endTime: collectedAt,
          collectedAt,
          candleCount: 180,
          complete: true,
          feeRate: "0.001",
          slippageRate: "0.0005",
          fundingIncluded: false,
          gapPolicy: "fail",
          datasetDigest,
          engineVersion: "test-weex-history-v1",
      }, config);
    }),
  };
});

const DISCLAIMER = "WEEX 歷史行情回測，不代表未來績效";
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/workshop");
  delete document.documentElement.dataset.locale;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
});

function renderWorkshop() {
  return render(<WorkshopPage />);
}

function cloneConfig(config: BotConfig): BotConfig {
  return {
    ...config,
    blocks: config.blocks.map((block) => ({
      ...block,
      parameters: block.parameters.map((parameter) => ({ ...parameter })),
    })),
  };
}

async function loadSteadyTrend(user: ReturnType<typeof userEvent.setup>) {
  void user;
  await waitFor(() => expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("SMA 均線交叉"));
}

async function selectTradingPair(user: ReturnType<typeof userEvent.setup>, search: string, optionName: RegExp) {
  await user.click(screen.getByRole("combobox", { name: "交易對" }));
  await user.type(screen.getByRole("searchbox", { name: "快速搜尋交易對" }), search);
  await user.click(screen.getByRole("option", { name: optionName }));
}

async function completeBacktest() {
  await waitFor(() => {
    expect(screen.getByRole("region", { name: "回測結果" })).toBeInTheDocument();
  });
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });
}

describe("multi-strategy workshop", () => {
  it("uses market-specific fee defaults and resets every backtest assumption", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    const feeRate = screen.getByRole("spinbutton", { name: "手續費率" });
    const slippageRate = screen.getByRole("spinbutton", { name: "滑價率" });
    expect(feeRate).toHaveValue(0.001);
    expect(slippageRate).toHaveValue(0.0005);

    await user.clear(feeRate);
    await user.type(feeRate, "0.002");
    await user.click(screen.getByRole("button", { name: "重設手續費率為預設值" }));
    expect(feeRate).toHaveValue(0.001);

    await user.clear(slippageRate);
    await user.type(slippageRate, "0.003");
    await user.click(screen.getByRole("button", { name: "重設滑價率為預設值" }));
    expect(slippageRate).toHaveValue(0.0005);

    await user.selectOptions(screen.getByRole("combobox", { name: "資料缺口" }), "disclose");
    await user.click(screen.getByRole("button", { name: "重設資料缺口為預設值" }));
    expect(screen.getByRole("combobox", { name: "資料缺口" })).toHaveValue("fail");

    await user.click(screen.getByRole("button", { name: /^合約/ }));
    expect(screen.getByRole("spinbutton", { name: "手續費率" })).toHaveValue(0.0008);
    const fundingMode = screen.getByRole("combobox", { name: "資金費率" });
    await user.selectOptions(fundingMode, "none");
    await user.click(screen.getByRole("button", { name: "重設資金費率為預設值" }));
    expect(fundingMode).toHaveValue("historical");
  });

  it("makes trade direction explicit and resets spot strategies to long-only", async () => {
    const user = userEvent.setup();
    renderWorkshop();
    const direction = screen.getByRole("group", { name: "交易方向" });

    expect(within(direction).getByRole("button", { name: /^只做多/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(direction).getByRole("button", { name: /^多空雙向/ })).toBeDisabled();
    expect(within(direction).getByRole("button", { name: /^只做空/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^合約/ }));
    expect(within(direction).getByRole("button", { name: /^只做空/ })).toBeEnabled();
    await user.click(within(direction).getByRole("button", { name: /^只做空/ }));
    expect(within(direction).getByRole("button", { name: /^只做空/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "交易政策摘要" })).toHaveTextContent("只做空");
    expect(screen.getByRole("region", { name: "策略摘要" }))
      .toHaveTextContent("空頭訊號可開倉，多頭訊號只用於平空倉");

    await user.click(screen.getByRole("button", { name: /^現貨/ }));
    expect(within(direction).getByRole("button", { name: /^只做多/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(direction).getByRole("button", { name: /^只做空/ })).toBeDisabled();
  });

  it("quickly checks the signal flow without calling the market API", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderWorkshop();
    const summary = screen.getByRole("region", { name: "策略摘要" });
    const readiness = screen.getByLabelText("策略發布準備狀態");

    expect(readiness).toHaveTextContent("策略設定已就緒");
    expect(readiness).toHaveTextContent("行情回測待執行");
    expect(readiness).toHaveTextContent("快速測試訊號流程未測試");

    await user.click(within(summary).getByRole("button", { name: "快速測試訊號流程" }));

    expect(within(summary).getByRole("status")).toHaveTextContent("流程測試通過");
    expect(readiness).toHaveTextContent("快速測試訊號流程通過測試");
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "清空選取" }));
    await user.click(within(summary).getByRole("button", { name: "快速測試訊號流程" }));
    expect(readiness).toHaveTextContent("策略設定需要調整");
    expect(readiness).toHaveTextContent("快速測試訊號流程未通過測試");
  });

  it("offers every announced WEEX API pair and applies the selected contract leverage ceiling", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    const symbols = screen.getByRole("combobox", { name: "交易對" });
    expect(symbols).toHaveAttribute("aria-expanded", "false");
    await user.click(symbols);
    const spotListbox = screen.getByRole("listbox", { name: "交易對搜尋結果" });
    expect(within(spotListbox).getAllByRole("option")).toHaveLength(25);
    expect(within(spotListbox).getByRole("option", { name: /^USDC \/ USDT/ })).toBeInTheDocument();
    expect(screen.getByText("共 25 個交易對")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("region", { name: "交易對槓桿上限" }))
      .toHaveTextContent("現貨交易不使用合約槓桿，系統固定為 1×");

    await user.click(screen.getByRole("button", { name: /^合約/ }));
    await user.click(screen.getByRole("combobox", { name: "交易對" }));
    const futuresListbox = screen.getByRole("listbox", { name: "交易對搜尋結果" });
    expect(within(futuresListbox).getAllByRole("option").length).toBeGreaterThan(100);
    expect(within(futuresListbox).getByRole("option", { name: /^1000BONK \/ USDT/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("slider", { name: "槓桿滑桿" })).toHaveAttribute("max", "400");
    const leverageLimit = screen.getByRole("region", { name: "交易對槓桿上限" });
    expect(leverageLimit).toHaveTextContent("此商品最大支援槓桿");
    expect(leverageLimit).toHaveTextContent("400×");
    expect(leverageLimit).toHaveTextContent("BTCUSDT · 合約");
    expect(leverageLimit).toHaveTextContent("此交易對最高支援 400×；目前設定為 1×");

    await selectTradingPair(user, "SOL", /^SOL \/ USDT/);
    expect(screen.getByRole("spinbutton", { name: "槓桿數值" })).toHaveAttribute("max", "100");
    expect(leverageLimit).toHaveTextContent("SOLUSDT · 合約");
    expect(leverageLimit).toHaveTextContent("此交易對最高支援 100×");
  });

  it("blocks saved strategies whose pair is not supported by WEEX API trading", () => {
    const unsupported = cloneConfig(STRATEGY_PRESETS[0]);
    unsupported.symbol = "NOTAPIUSDT";

    expect(validateConfig(unsupported)).toEqual(expect.objectContaining({
      valid: false,
      errors: expect.arrayContaining(["NOTAPIUSDT 不在 WEEX API 公告支援的現貨交易對中"]),
    }));
  });

  it("shows a stable common value beside each adjustable parameter", async () => {
    const user = userEvent.setup();
    renderWorkshop();
    await loadSteadyTrend(user);

    const stopLoss = screen.getByRole("spinbutton", { name: "停損數值" });
    expect(stopLoss).toHaveAttribute("max", "100");
    expect(screen.getByText("預設 3%")).toBeInTheDocument();
    await user.clear(stopLoss);
    await user.type(stopLoss, "7");
    expect(stopLoss).toHaveValue(7);
    expect(screen.getByText("預設 3%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重置固定停損的停損為預設值" }));
    expect(stopLoss).toHaveValue(3);

    expect(screen.getByRole("spinbutton", { name: "停利數值" })).toHaveAttribute("max", "1000");
    expect(screen.getByText("預設 8%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "穩健趨勢" })).not.toBeInTheDocument();
  });

  it("offers accessible visual and JavaScript modes plus a ZIP file input", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    const visualMode = screen.getByRole("button", { name: "視覺化模式" });
    const javascriptMode = screen.getByRole("button", { name: "JavaScript 模式" });
    expect(visualMode).toHaveAttribute("aria-pressed", "true");
    expect(javascriptMode).toHaveAttribute("aria-pressed", "false");

    await user.click(javascriptMode);

    expect(visualMode).toHaveAttribute("aria-pressed", "false");
    expect(javascriptMode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "JavaScript 策略原始碼" })).toBeInTheDocument();
    expect(screen.getByText(/^\d+ 行程式碼$/)).toBeInTheDocument();
    expect(screen.getByLabelText("匯入策略 ZIP 套件")).toHaveAttribute("accept", expect.stringContaining(".zip"));
    expect(screen.getByRole("button", { name: "下載草稿備份 JSON" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeDisabled();
  });

  it("accepts a blank source-only JavaScript workflow without dummy visual blocks", async () => {
    window.history.replaceState(null, "", "/workshop?new=1&mode=javascript");
    const user = userEvent.setup();
    renderWorkshop();

    await screen.findByRole("textbox", { name: "JavaScript 策略原始碼" });
    expect(screen.getByRole("button", { name: "JavaScript 模式" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("list", { name: "設定問題" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "執行進階歷史回測" })).toBeEnabled();

    const summary = screen.getByRole("region", { name: "策略摘要" });
    await user.click(within(summary).getByRole("button", { name: "快速測試訊號流程" }));
    expect(within(summary).getByRole("status"))
      .toHaveTextContent("程式碼靜態合約通過；仍需完成隔離沙箱歷史回測");
  });

  it("binds a successful formal source-only result to export readiness and invalidates it on source change", async () => {
    window.history.replaceState(null, "", "/workshop?new=1&mode=javascript");
    let savedConfig: BotConfig | null = null;
    const datasetDigest = "d".repeat(64);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/strategies") {
        savedConfig = (JSON.parse(String(init?.body)) as { config: BotConfig }).config;
        return new Response(JSON.stringify({ strategyVersion: {
          id: "version_source", strategyId: "strategy_source", version: 1,
          configHash: historicalConfigurationHash(savedConfig), createdAt: 1,
        }, idempotent: false }), { status: 201 });
      }
      if (String(input) === "/api/backtests" && savedConfig) {
        const request = JSON.parse(String(init?.body)) as {
          strategyVersionId: string; market: "spot" | "futures"; symbol: string; interval: string;
          startTime: number; endTime: number; initialCapital: string; feeRate: string; slippageRate: string;
          leverage: string; fundingMode: "none" | "historical"; gapPolicy: "fail" | "disclose";
        };
        const configHash = historicalConfigurationHash(savedConfig);
        return new Response(JSON.stringify({ backtest: {
          id: "job_source", strategyVersionId: "version_source", status: "succeeded",
          evidenceLevel: "historical", request, error: null, createdAt: 1, startedAt: 2,
          completedAt: request.endTime,
          dataset: { id: "dataset_source", market: request.market, symbol: request.symbol,
            interval: request.interval, source: "WEEX public API", requestedStartAt: request.startTime,
            requestedEndAt: request.endTime, actualStartAt: request.startTime,
            actualEndAt: request.endTime - 1, complete: true, gaps: [], checksum: datasetDigest },
          result: { id: "result_source", funding: {}, metrics: { totalReturn: "0.1",
            annualizedReturn: "0.2", maxDrawdown: "0.05", winRate: "0.6",
            profitFactor: "1.5", sharpe: "1.2", trades: 4 },
            provenance: { provider: "WEEX", dataSource: "WEEX", sourceKind: "public-api",
              requestedRange: { startTime: request.startTime, endTime: request.endTime },
              fetchedRange: { startTime: request.startTime, endTime: request.endTime - 1 },
              gaps: [], gapCount: 0, duplicateCount: 0, incompleteCount: 0, complete: true,
              feeRate: request.feeRate, slippageRate: request.slippageRate,
              fundingTreatment: { suppliedEvents: 0, appliedEvents: 0, netFunding: "0",
                convention: "long-pays-positive-short-receives-positive" },
              market: request.market, symbol: request.symbol, interval: request.interval,
              engineVersion: "formal-test", configHash, strategyHash: configHash, datasetDigest,
              executionConvention: { signalEvaluation: "completed-candle-close",
                signalExecution: "next-candle-open", riskTrigger: "close-only-not-intrabar" },
              liquidationModel: { maintenanceMarginRate: "0", maximumSupportedLeverage: "500",
                check: "test", orderingAssumption: "test", model: "test" } },
            equityCurve: [{ timestamp: request.startTime, equity: "10000" },
              { timestamp: request.endTime - 1, equity: "11000" }],
            engineVersion: "formal-test", configurationHash: configHash, strategyHash: configHash,
            scriptHash: historicalScriptHash(savedConfig) },
        } }), { status: 201 });
      }
      throw new Error(`unexpected request: ${String(input)}`);
    });
    const user = userEvent.setup();
    renderWorkshop();

    const editor = await screen.findByRole("textbox", { name: "JavaScript 策略原始碼" });
    await user.click(screen.getByRole("button", { name: "執行進階歷史回測" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeEnabled();

    fireEvent.change(editor, { target: { value: `${(editor as HTMLTextAreaElement).value}\n// changed` } });
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeDisabled();
  });

  it("drops JavaScript source when switching to visual mode", async () => {
    const user = userEvent.setup();
    const importedConfig = {
      ...cloneConfig(STRATEGY_PRESETS[0]),
      source: "const exchange = 'WEEX'; export default function evaluate() { return { action: 'hold' }; }",
    };
    vi.spyOn(botPackage, "importBotPackage").mockResolvedValue({
      config: importedConfig,
      report: runBacktest(importedConfig),
    });
    renderWorkshop();

    await user.upload(screen.getByLabelText("匯入策略 ZIP 套件"), new File(["zip"], "js.zip"));
    await screen.findByRole("textbox", { name: "JavaScript 策略原始碼" });
    await user.click(screen.getByRole("button", { name: "視覺化模式" }));
    expect(screen.queryByRole("textbox", { name: "JavaScript 策略原始碼" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("cryptobot-labs:draft:v1")!)).not.toHaveProperty("source");

    expect(screen.getByRole("button", { name: "下載草稿備份 JSON" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeDisabled();
  });

  it("treats JavaScript as inert text and blocks non-WEEX source", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "JavaScript 模式" }));
    fireEvent.change(screen.getByRole("textbox", { name: "JavaScript 策略原始碼" }), {
      target: { value: "fetch('https://api.binance.com')" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("偵測到非 WEEX 網域：api.binance.com");
    expect(screen.getByRole("button", { name: "執行進階歷史回測" })).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("routes a valid WEEX JavaScript template through the authenticated evidence flow", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "JavaScript 模式" }));
    const source = screen.getByRole("textbox", { name: "JavaScript 策略原始碼" });

    expect((source as HTMLTextAreaElement).value).toContain("WEEX");
    expect(screen.getByRole("region", { name: "程式碼靜態預覽" })).toHaveTextContent("不會執行程式碼");
    expect(screen.getByRole("heading", { name: "進階歷史回測" })).toBeInTheDocument();
    const gapPolicy = screen.getByRole("combobox", { name: "資料缺口" });
    expect(gapPolicy).toBeDisabled();
    expect(gapPolicy).toHaveValue("fail");
    expect(within(gapPolicy).queryByRole("option", { name: "揭露缺口並繼續" })).not.toBeInTheDocument();
    const run = screen.getByRole("button", { name: "執行進階歷史回測" });
    expect(run).toBeEnabled();

    await user.click(run);
    expect(await screen.findByRole("link", { name: "登入" })).toHaveAttribute("href", "/auth?return_to=%2Fworkshop");
    expect(within(screen.getByRole("region", { name: "手機版組裝操作" }))
      .getByText("請先登入，才能保存並查看自己的歷史回測。")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/strategies");
    expect(fetchSpy.mock.calls.some(([url]) => url === "/api/weex/historical-backtest")).toBe(false);
  });

  it("creates JavaScript from current controls and blocks adjacent control drift", async () => {
    const user = userEvent.setup();
    renderWorkshop();
    await user.click(screen.getByRole("button", { name: /^合約/ }));
    await selectTradingPair(user, "ETHUSDT", /^ETH \/ USDT/);
    await user.click(screen.getByRole("button", { name: /^4 小時/ }));
    await user.click(screen.getByRole("button", { name: "JavaScript 模式" }));

    const source = screen.getByRole("textbox", { name: "JavaScript 策略原始碼" });
    expect((source as HTMLTextAreaElement).value).toContain('market: "futures"');
    expect((source as HTMLTextAreaElement).value).toContain('symbol: "ETHUSDT"');
    expect((source as HTMLTextAreaElement).value).toContain('timeframe: "4h"');

    await selectTradingPair(user, "SOLUSDT", /^SOL \/ USDT/);
    expect(screen.getByRole("list", { name: "設定問題" })).toHaveTextContent("JavaScript 的交易對（ETHUSDT）與策略設定（SOLUSDT）不一致");
    expect(screen.getByRole("button", { name: "執行進階歷史回測" })).toBeDisabled();
  });

  it("confirms simulation limits, downloads a ZIP, and revokes the object URL", async () => {
    const user = userEvent.setup();
    const objectUrl = "blob:workshop-package";
    let clickedDownload = "";
    let clickedWhileConnected = false;
    const exportPackage = vi.spyOn(botPackage, "exportBotPackage").mockResolvedValue(new Blob(["zip"]));
    const createObjectURL = vi.fn(() => objectUrl);
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedDownload = this.download;
      clickedWhileConnected = this.isConnected;
    });
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行行情回測" }));
    await completeBacktest();
    await user.click(screen.getByRole("button", { name: "下載完整策略包" }));

    const dialog = screen.getByRole("dialog", { name: "確認下載完整策略包" });
    expect(dialog).toHaveTextContent("歷史行情回測資料");
    expect(dialog).toHaveTextContent("無法獨立交易");
    expect(exportPackage).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "確認下載" }));
    await waitFor(() => expect(exportPackage).toHaveBeenCalledTimes(1));
    expect(clickedDownload).toMatch(/\.zip$/);
    expect(clickedWhileConnected).toBe(true);
    expect(document.body.querySelector(`a[href="${objectUrl}"]`)).toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl));
  });

  it("removes the connected download anchor and revokes its URL when clicking fails", async () => {
    const user = userEvent.setup();
    const objectUrl = "blob:failed-workshop-package";
    vi.spyOn(botPackage, "exportBotPackage").mockResolvedValue(new Blob(["zip"]));
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => objectUrl) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true);
      throw new Error("瀏覽器阻擋下載");
    });
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行行情回測" }));
    await completeBacktest();
    await user.click(screen.getByRole("button", { name: "下載完整策略包" }));
    await user.click(screen.getByRole("button", { name: "確認下載" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("瀏覽器阻擋下載");
    expect(await screen.findAllByRole("button", { name: /下載單一檔案/ })).toHaveLength(5);
    expect(document.body.querySelector(`a[href="${objectUrl}"]`)).toBeNull();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl));
  });

  it("moves focus into the confirmation, traps Tab, closes on Escape, and restores the trigger", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行行情回測" }));
    await completeBacktest();
    const trigger = screen.getByRole("button", { name: "下載完整策略包" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "確認下載完整策略包" });
    expect(dialog.parentElement).toBe(document.body);
    const cancel = within(dialog).getByRole("button", { name: "取消" });
    const confirm = within(dialog).getByRole("button", { name: "確認下載" });
    await waitFor(() => expect(cancel).toHaveFocus());

    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "確認下載完整策略包" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("restores focus to the export trigger after a successful deferred download", async () => {
    const user = userEvent.setup();
    let resolveExport!: (blob: Blob) => void;
    vi.spyOn(botPackage, "exportBotPackage").mockReturnValue(new Promise((resolve) => { resolveExport = resolve; }));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:deferred-success") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行行情回測" }));
    await completeBacktest();
    const trigger = screen.getByRole("button", { name: "下載完整策略包" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "確認下載" }));

    expect(trigger).toBeDisabled();
    expect(trigger).not.toHaveFocus();
    await act(async () => { resolveExport(new Blob(["zip"])); });
    await screen.findByText("完整策略包已開始下載。");
    expect(trigger).toBeEnabled();
    expect(trigger).toHaveFocus();
  });

  it("restores focus to the export trigger after a deferred export failure", async () => {
    const user = userEvent.setup();
    let rejectExport!: (error: Error) => void;
    vi.spyOn(botPackage, "exportBotPackage").mockReturnValue(new Promise((_resolve, reject) => { rejectExport = reject; }));
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行行情回測" }));
    await completeBacktest();
    const trigger = screen.getByRole("button", { name: "下載完整策略包" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "確認下載" }));

    expect(trigger).toBeDisabled();
    expect(trigger).not.toHaveFocus();
    await act(async () => { rejectExport(new Error("策略套件輸出失敗")); });
    expect(await screen.findByRole("alert")).toHaveTextContent("策略套件輸出失敗");
    expect(trigger).toBeEnabled();
    expect(trigger).toHaveFocus();
  });

  it("retries a failed workshop ZIP download through a fresh confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(botPackage, "exportBotPackage")
      .mockRejectedValueOnce(new Error("第一次失敗"))
      .mockResolvedValueOnce(new Blob(["zip"]));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:retry") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行行情回測" }));
    await completeBacktest();
    const trigger = screen.getByRole("button", { name: "下載完整策略包" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "確認下載" }));
    await screen.findByText("第一次失敗");
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "確認下載完整策略包" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確認下載" }));

    expect(await screen.findByText("完整策略包已開始下載。")).toBeInTheDocument();
  });

  it("only exports a report matching the current config fingerprint", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行行情回測" }));
    await completeBacktest();
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeEnabled();

    fireEvent.change(screen.getByRole("spinbutton", { name: "短期均線數值" }), { target: { value: "12" } });

    expect(screen.queryByRole("region", { name: "回測結果" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeDisabled();
  });

  it("cancels a deferred download when the strategy fingerprint changes", async () => {
    const user = userEvent.setup();
    let resolveExport!: (blob: Blob) => void;
    const exportPackage = vi.spyOn(botPackage, "exportBotPackage")
      .mockReturnValue(new Promise((resolve) => { resolveExport = resolve; }));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行行情回測" }));
    await completeBacktest();
    await user.click(screen.getByRole("button", { name: "下載完整策略包" }));
    await user.click(screen.getByRole("button", { name: "確認下載" }));
    expect(exportPackage).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("spinbutton", { name: "短期均線數值" }), { target: { value: "12" } });
    await act(async () => { resolveExport(new Blob(["stale-zip"])); });

    expect(await screen.findByRole("alert")).toHaveTextContent("策略設定已變更，請以目前設定重新完成回測後再匯出");
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("restores imported config and report only after a successful ZIP import", async () => {
    const user = userEvent.setup();
    const importedConfig = cloneConfig(STRATEGY_PRESETS[4]);
    const importedReport = runBacktest(importedConfig);
    const importPackage = vi.spyOn(botPackage, "importBotPackage").mockResolvedValue({
      config: importedConfig,
      report: importedReport,
    });
    renderWorkshop();

    await user.upload(
      screen.getByLabelText("匯入策略 ZIP 套件"),
      new File(["zip"], "restored-bot.zip", { type: "application/zip" }),
    );

    await waitFor(() => expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("MACD 動能"));
    expect(importPackage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("ATR 波動倉位");
    expect(screen.getByRole("region", { name: "回測結果" })).toHaveAttribute("data-report-key", JSON.stringify(importedReport));
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeEnabled();
  });

  it("retains a valid import in memory with immediate export when draft persistence fails", async () => {
    const user = userEvent.setup();
    const importedConfig = cloneConfig(STRATEGY_PRESETS[4]);
    vi.spyOn(botPackage, "importBotPackage").mockResolvedValue({
      config: importedConfig,
      report: runBacktest(importedConfig),
    });
    renderWorkshop();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });

    await user.upload(
      screen.getByLabelText("匯入策略 ZIP 套件"),
      new File(["zip"], "cannot-save.zip", { type: "application/zip" }),
    );

    expect(await screen.findByText(/無法儲存匯入策略草稿/)).toBeInTheDocument();
    expect(screen.getByText(/已匯入 cannot-save\.zip/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("MACD 動能");
    expect(screen.getByRole("region", { name: "回測結果" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeEnabled();
  });

  it("allows retrying the same ZIP file after an import failure", async () => {
    const user = userEvent.setup();
    const importPackage = vi.spyOn(botPackage, "importBotPackage")
      .mockRejectedValue(new Error("策略套件 ZIP 格式無效"));
    const file = new File(["broken"], "same-file.zip", { type: "application/zip" });
    renderWorkshop();

    const input = screen.getByLabelText("匯入策略 ZIP 套件");
    await user.upload(input, file);
    await screen.findByRole("alert");
    await user.upload(input, file);

    await waitFor(() => expect(importPackage).toHaveBeenCalledTimes(2));
  });

  it("hydrates a known catalog bot ahead of a saved draft and clones catalog parameters", async () => {
    const catalogBefore = JSON.stringify(BOT_CATALOG);
    localStorage.setItem("cryptobot-labs:draft:v1", JSON.stringify(STRATEGY_PRESETS[0]));
    window.history.replaceState(null, "", "/workshop?bot=momentum-forge");
    renderWorkshop();

    await waitFor(() => expect(screen.getByRole("button", { name: /^合約/ })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("MACD");
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("SMA 均線交叉");
    fireEvent.change(screen.getByRole("spinbutton", { name: "停損數值" }), { target: { value: "7" } });
    expect(JSON.stringify(BOT_CATALOG)).toBe(catalogBefore);
  });

  it("falls back to the saved draft for an unknown catalog bot id", async () => {
    localStorage.setItem("cryptobot-labs:draft:v1", JSON.stringify(STRATEGY_PRESETS[4]));
    window.history.replaceState(null, "", "/workshop?bot=unknown-bot");
    renderWorkshop();

    await waitFor(() => expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("MACD 動能"));
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("ATR 波動倉位");
  });

  it("preserves JavaScript mode while hydrating a catalog bot query", async () => {
    window.history.replaceState(null, "", "/workshop?bot=orbit-dca&mode=javascript");
    renderWorkshop();

    const source = await screen.findByRole("textbox", { name: "JavaScript 策略原始碼" });
    expect((source as HTMLTextAreaElement).value).toContain("WEEX");
    expect(screen.getByRole("button", { name: "JavaScript 模式" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^現貨/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("uses the persisted production locale before the i18n bootstrap effect finishes", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    document.documentElement.dataset.locale = "zh-Hant";
    window.history.replaceState(null, "", "/workshop?new=1&mode=javascript");
    render(
      <I18nProvider initialLocale="zh-Hant">
        <WorkshopPage />
      </I18nProvider>,
    );

    const source = await screen.findByRole("textbox", { name: "JavaScript 策略原始碼" });
    await waitFor(() => expect(document.documentElement.dataset.locale).toBe("en"));
    expect((source as HTMLTextAreaElement).value).toContain("Example of a simulated strategy for CryptoBot Labs.");
    expect((source as HTMLTextAreaElement).value).toContain("Historical backtests run this function only in an isolated sandbox.");
    expect((source as HTMLTextAreaElement).value).not.toContain("模擬策略範例");
    expect(screen.getByRole("textbox", { name: "策略名稱" })).toHaveValue("Unnamed Strategy");
  });

  it("shows named import errors and preserves the current draft on failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(botPackage, "importBotPackage").mockRejectedValue(new Error("策略套件缺少必要檔案：manifest.json"));
    renderWorkshop();

    fireEvent.change(screen.getByRole("spinbutton", { name: "短期均線數值" }), { target: { value: "12" } });
    await user.upload(
      screen.getByLabelText("匯入策略 ZIP 套件"),
      new File(["zip"], "broken.zip", { type: "application/zip" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("策略套件缺少必要檔案：manifest.json");
    expect(screen.getByRole("spinbutton", { name: "短期均線數值" })).toHaveValue(12);
  });

  it("rejects non-ZIP imports before calling the package reader", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const importPackage = vi.spyOn(botPackage, "importBotPackage");
    renderWorkshop();

    await user.upload(
      screen.getByLabelText("匯入策略 ZIP 套件"),
      new File(["plain"], "strategy.js", { type: "text/javascript" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("只接受 .zip 策略套件");
    expect(importPackage).not.toHaveBeenCalled();
  });

  it("completes the beginner preset flow and shows the exact simulation disclosure", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await loadSteadyTrend(user);
    await user.click(screen.getByRole("button", { name: "加入 RSI Rebound" }));
    await user.clear(screen.getByRole("spinbutton", { name: "超賣門檻數值" }));
    await user.type(screen.getByRole("spinbutton", { name: "超賣門檻數值" }), "28");
    await user.selectOptions(screen.getByRole("combobox", { name: "條件邏輯" }), "all");
    await user.click(screen.getByRole("button", { name: "執行行情回測" }));

    await completeBacktest();
    expect(screen.getByRole("region", { name: "回測結果" })).toHaveTextContent(DISCLAIMER);
    expect(screen.getByRole("figure", { name: /歷史行情資產曲線/ })).toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: /回測指標/ })).toHaveLength(9);
  });

  it("renders a smooth node-free simulation curve and semantic metric colors", () => {
    const config = cloneConfig(STRATEGY_PRESETS[0]);
    const report: BacktestReport = {
      ...runBacktest(config),
      equityCurve: [
        { label: "第 01 月", value: 100 },
        { label: "第 02 月", value: 94 },
        { label: "第 03 月", value: 86.03 },
      ],
      metrics: {
        totalReturn: -13.97,
        annualizedReturn: -4.89,
        maxDrawdown: -38.55,
        winRate: 52.78,
        profitFactor: 0.99,
        sharpe: -0.01,
        trades: 629,
        runningDays: 1095,
        stability: 18.47,
      },
    };

    render(
      <BacktestPanel
        config={config}
        restoredReport={report}
        validation={validateConfig(config)}
      />,
    );

    const chart = screen.getByRole("figure", { name: /歷史行情資產曲線/ });
    expect(chart).toHaveAttribute("data-variant", "smooth");
    expect(chart.querySelector(".performance-chart__smooth-line")).toBeInTheDocument();
    expect(chart.querySelectorAll("circle")).toHaveLength(0);
    expect(screen.getByRole("article", { name: "總報酬回測指標" })).toHaveAttribute("data-tone", "negative");
    expect(screen.getByRole("article", { name: "獲利因子回測指標" })).toHaveAttribute("data-tone", "negative");
    expect(screen.getByRole("article", { name: "勝率回測指標" })).toHaveAttribute("data-tone", "positive");
    expect(screen.getByRole("article", { name: "交易次數回測指標" })).toHaveAttribute("data-tone", "info");
  });

  it("disables backtesting and explains when every exit and risk rule is removed", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await loadSteadyTrend(user);
    await user.click(screen.getByRole("button", { name: "移除 固定停損" }));
    await user.click(screen.getByRole("button", { name: "移除 固定停利" }));

    expect(screen.getByText("至少需要一個出場或風控規則")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "執行行情回測" })).toBeDisabled();
  });

  it.each([
    {
      strategy: "SMA 均線交叉",
      input: "短期均線數值",
      value: "60",
      guidance: "SMA 均線交叉（sma-cross）的短期均線（shortPeriod）必須小於長期均線（longPeriod）",
    },
    {
      strategy: "MACD 動能",
      input: "快線週期數值",
      value: "26",
      guidance: "MACD 動能（macd）的快線週期（fastPeriod）必須小於慢線週期（slowPeriod）",
    },
  ])("blocks contradictory strategy periods in the $strategy workshop flow", async ({ strategy, input, value, guidance }) => {
    const user = userEvent.setup();
    renderWorkshop();

    if (strategy === "MACD 動能") await user.click(screen.getByRole("button", { name: "加入 MACD 動能" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: input }), { target: { value } });

    expect(screen.getByRole("region", { name: "策略摘要" })).toHaveTextContent(guidance);
    expect(screen.getByRole("button", { name: "執行行情回測" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "回測結果" })).not.toBeInTheDocument();
  });

  it("supports searching and selecting multiple strategy blocks", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.type(screen.getByRole("searchbox", { name: "搜尋策略模組" }), "RSI");
    await user.click(screen.getByRole("button", { name: "加入 RSI Rebound" }));
    await user.clear(screen.getByRole("searchbox", { name: "搜尋策略模組" }));
    await user.click(screen.getByRole("button", { name: "加入 MACD 動能" }));

    const selection = screen.getByRole("region", { name: "已選策略" });
    expect(within(selection).getByText("RSI Rebound")).toBeInTheDocument();
    expect(within(selection).getByText("MACD 動能")).toBeInTheDocument();
    expect(within(selection).getAllByRole("listitem")).toHaveLength(7);
  });

  it("offers expanded confirmation, profit-exit, and consecutive-loss protection modules", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("tab", { name: /訊號確認/ }));
    expect(screen.getByRole("button", { name: "加入 ATR 波動確認" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入 布林帶寬確認" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /獲利離場/ }));
    expect(screen.getByRole("button", { name: "加入 ATR 動態停利" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入 RSI 動能離場" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入 持倉時間停利" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /虧損保護/ }));
    await user.click(screen.getByRole("button", { name: "加入 連敗暫停交易" }));
    expect(screen.getByRole("spinbutton", { name: "連敗次數數值" })).toHaveValue(3);
    expect(screen.getByRole("spinbutton", { name: "停止時間數值" })).toHaveValue(24);
  });

  it("offers direct confirmation and a broad catalog of mainstream entry methods", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    for (const name of ["CCI 順勢反彈", "Williams %R 反彈", "ROC 價格動能", "一目均衡表突破", "Supertrend 趨勢翻轉", "拋物線 SAR 翻轉", "VWAP 均價收復", "MFI 資金流反彈", "OBV 能量潮突破", "價格行為突破"]) {
      expect(screen.getByRole("button", { name: `加入 ${name}` })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("tab", { name: /訊號確認/ }));
    await user.click(screen.getByRole("button", { name: "加入 直接確認" }));
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("直接確認");
    expect(screen.queryByRole("group", { name: "直接確認" })).not.toBeInTheDocument();
  });

  it("highlights selected strategy cards and toggles them off with a second click", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "加入 RSI Rebound" }));

    const selectedControl = screen.getByRole("button", { name: "取消選取 RSI Rebound" });
    const selectedCard = selectedControl.closest("li");
    expect(selectedCard).toHaveAttribute("data-selected", "true");
    expect(selectedControl).toHaveTextContent("✓");
    expect(selectedControl).toHaveAttribute("aria-pressed", "true");

    await user.click(selectedControl);
    expect(screen.getByRole("button", { name: "加入 RSI Rebound" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "取消選取 RSI Rebound" })).not.toBeInTheDocument();
  });

  it("keeps slider, numeric input, summary, and draft in sync", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "加入 RSI Rebound" }));
    const numeric = screen.getByRole("spinbutton", { name: "超賣門檻數值" });
    const slider = screen.getByRole("slider", { name: "超賣門檻滑桿" });

    await user.clear(numeric);
    await user.type(numeric, "28");

    expect(slider).toHaveValue("28");
    expect(screen.getByRole("region", { name: "策略摘要" })).toHaveTextContent("低於 28");
    expect(JSON.parse(localStorage.getItem("cryptobot-labs:draft:v1")!))
      .toMatchObject({ blocks: expect.arrayContaining([expect.objectContaining({ id: "rsi" })]) });
  });

  it("moves selected blocks with keyboard-accessible ordering controls", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "加入 RSI Rebound" }));
    await user.click(screen.getByRole("button", { name: "加入 MACD 動能" }));
    const selection = screen.getByRole("region", { name: "已選策略" });

    screen.getByRole("button", { name: "向上移動 MACD 動能" }).focus();
    await user.keyboard("{Enter}");

    expect(within(selection).getAllByRole("listitem").slice(-2).map((item) => item.getAttribute("data-block-id")))
      .toEqual(["macd", "rsi"]);
  });

  it("reports draft save failures without losing the editable config", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "加入 RSI Rebound" }));

    expect(screen.getByRole("status")).toHaveTextContent("無法儲存策略草稿");
    expect(screen.getByRole("status")).toHaveTextContent("目前內容仍保留在本頁");
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("RSI Rebound");
  });

  it("downloads an incomplete invalid draft backup independently of package readiness", async () => {
    const user = userEvent.setup();
    const objectUrl = "blob:invalid-draft-backup";
    let downloadedBlob: Blob | undefined;
    let clickedDownload = "";
    let clickedWhileConnected = false;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        downloadedBlob = blob;
        return objectUrl;
      }),
    });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedDownload = this.download;
      clickedWhileConnected = this.isConnected;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "清空選取" }));
    await user.click(screen.getByRole("button", { name: "JavaScript 模式" }));
    fireEvent.change(screen.getByRole("textbox", { name: "JavaScript 策略原始碼" }), {
      target: { value: "const exchange = 'WEEX'; const = ;" },
    });

    expect(screen.getByRole("button", { name: "下載草稿備份 JSON" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "下載草稿備份 JSON" }));

    expect(clickedDownload).toBe("untitled-strategy-draft-backup.json");
    expect(clickedWhileConnected).toBe(true);
    expect(downloadedBlob).toBeInstanceOf(Blob);
    expect(downloadedBlob).toHaveProperty("type", "application/json");
    await expect(readBlobText(downloadedBlob!)).resolves.toContain('"blocks": []');
    await expect(readBlobText(downloadedBlob!)).resolves.toContain("const exchange = 'WEEX'; const = ;");
    expect(document.body.querySelector(`a[href="${objectUrl}"]`)).toBeNull();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl));
  });

  it("offers a truthful blank draft backup when reset persistence fails", async () => {
    const user = userEvent.setup();
    let clickedDownload = "";
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:blank-draft-backup") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedDownload = this.download;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "清空選取" }));

    expect(screen.getByRole("status")).toHaveTextContent("無法儲存策略草稿");
    expect(screen.getByText("草稿備份不是可執行策略套件，也不含交易憑證。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下載草稿備份 JSON" }));
    expect(clickedDownload).toBe("untitled-strategy-draft-backup.json");
  });

  it("ignores an unreadable saved draft and starts from the safe default", () => {
    localStorage.setItem("cryptobot-labs:draft:v1", "{broken-json");

    renderWorkshop();

    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("固定停損");
    expect(screen.getByRole("button", { name: "執行行情回測" })).toBeEnabled();
  });

  it("restores a valid saved draft after mount", async () => {
    localStorage.setItem("cryptobot-labs:draft:v1", JSON.stringify(STRATEGY_PRESETS[4]));

    renderWorkshop();

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("MACD 動能");
    });
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("ATR 波動倉位");
  });

  it("restores an incomplete invalid-JavaScript draft without executing it", async () => {
    const marker = "__invalidDraftExecuted";
    delete (globalThis as Record<string, unknown>)[marker];
    const draft = { ...cloneConfig(STRATEGY_PRESETS[0]), blocks: [], source: `globalThis.${marker}=true; const = ;` };
    localStorage.setItem("cryptobot-labs:draft:v1", JSON.stringify(draft));

    renderWorkshop();

    const editor = await screen.findByRole("textbox", { name: "JavaScript 策略原始碼" });
    expect(editor).toHaveValue(draft.source);
    expect(screen.getByRole("button", { name: "執行進階歷史回測" })).toBeDisabled();
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });

  it("gives new=1 precedence over catalog and saved draft and guides an empty config", async () => {
    localStorage.setItem("cryptobot-labs:draft:v1", JSON.stringify(STRATEGY_PRESETS[4]));
    window.history.replaceState(null, "", "/workshop?bot=momentum-forge&new=1");

    renderWorkshop();

    await waitFor(() => expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("尚未選擇策略模組"));
    expect(screen.getByRole("region", { name: "策略摘要" })).toHaveTextContent("至少需要一個進場訊號");
    expect(screen.getByRole("button", { name: "執行行情回測" })).toBeDisabled();
  });

  it("provides a visible action that deliberately resets to a blank visual config", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "清空選取" }));

    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("尚未選擇策略模組");
    expect(screen.getByRole("button", { name: "視覺化模式" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the catalog and presets isolated from editable values and selections", async () => {
    const catalogBefore = JSON.stringify(STRATEGY_BLOCKS);
    const presetsBefore = JSON.stringify(STRATEGY_PRESETS);
    const user = userEvent.setup();
    renderWorkshop();

    await loadSteadyTrend(user);
    fireEvent.change(screen.getByRole("spinbutton", { name: "短期均線數值" }), { target: { value: "33" } });
    await user.click(screen.getByRole("button", { name: "加入 RSI Rebound" }));

    expect(JSON.stringify(STRATEGY_BLOCKS)).toBe(catalogBefore);
    expect(JSON.stringify(STRATEGY_PRESETS)).toBe(presetsBefore);

    await user.click(screen.getByRole("button", { name: "重置SMA 均線交叉的短期均線為預設值" }));
    await user.click(screen.getByRole("button", { name: "移除 RSI Rebound" }));
    expect(screen.getByRole("spinbutton", { name: "短期均線數值" })).toHaveValue(20);
    expect(screen.getByRole("region", { name: "已選策略" })).not.toHaveTextContent("RSI Rebound");
  });

  it("exposes the validating, running, and complete backtest states", async () => {
    vi.useFakeTimers();
    renderWorkshop();

    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "idle");
    expect(screen.getByText("等待執行")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "執行行情回測" }));
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "validating");
    expect(screen.getByText("驗證設定")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(40));
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "running");
    expect(screen.getAllByText("歷史行情計算中")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("歷史行情計算中");

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "complete");
    expect(screen.getByText("回測完成")).toBeInTheDocument();
  });

  it("moves through the mobile-first steps before validation and backtest", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    const bar = screen.getByRole("region", { name: "手機版組裝操作" });
    expect(screen.getByRole("button", { name: /01.*組裝/ })).toHaveAttribute("aria-current", "step");
    expect(within(bar).queryByRole("button", { name: "行動列：檢查設定" })).not.toBeInTheDocument();
    await user.click(within(bar).getByRole("button", { name: "行動列：下一步" }));
    expect(screen.getByRole("button", { name: /02.*參數/ })).toHaveAttribute("aria-current", "step");
    await user.click(within(bar).getByRole("button", { name: "行動列：下一步" }));
    expect(screen.getByRole("button", { name: /03.*驗證/ })).toHaveAttribute("aria-current", "step");
    expect(within(bar).getByRole("button", { name: "行動列：檢查設定" })).toBeEnabled();
    await user.click(within(bar).getByRole("button", { name: "行動列：執行回測" }));
    expect(within(bar).getByText("正在取得公開歷史行情並執行回測…")).toBeInTheDocument();
    await completeBacktest();
    expect(within(bar).getByText("回測完成，可保存或發布策略")).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "行動列：開始模擬運行" })).not.toBeInTheDocument();
  });

  it("switches only mobile workshop steps with an intentional horizontal swipe", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      renderWorkshop();
      const grid = document.querySelector<HTMLElement>(".workshop-grid");
      expect(grid).not.toBeNull();

      fireEvent.touchStart(grid!, { touches: [{ clientX: 330, clientY: 260 }] });
      fireEvent.touchEnd(grid!, { changedTouches: [{ clientX: 250, clientY: 266 }] });
      expect(screen.getByRole("button", { name: /02.*參數/ })).toHaveAttribute("aria-current", "step");

      fireEvent.touchStart(grid!, { touches: [{ clientX: 250, clientY: 260 }] });
      fireEvent.touchEnd(grid!, { changedTouches: [{ clientX: 255, clientY: 350 }] });
      expect(screen.getByRole("button", { name: /02.*參數/ })).toHaveAttribute("aria-current", "step");

      fireEvent.touchStart(grid!, { touches: [{ clientX: 80, clientY: 260 }] });
      fireEvent.touchEnd(grid!, { changedTouches: [{ clientX: 155, clientY: 262 }] });
      expect(screen.getByRole("button", { name: /01.*組裝/ })).toHaveAttribute("aria-current", "step");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    }
  });

  it("returns from validating to idle with guidance when validation rejects the run", () => {
    vi.useFakeTimers();
    const config = cloneConfig(STRATEGY_PRESETS[0]);
    config.blocks.find((block) => block.id === "sma-cross")!
      .parameters.find((parameter) => parameter.key === "shortPeriod")!.value = 60;
    render(<BacktestPanel config={config} validation={{ valid: true, errors: [] }} />);

    fireEvent.click(screen.getByRole("button", { name: "執行行情回測" }));
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "validating");

    act(() => vi.advanceTimersByTime(40));
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "idle");
    expect(screen.getByRole("alert")).toHaveTextContent("短期均線（shortPeriod）必須小於長期均線（longPeriod）");
  });

  it("enters the error state when the backtest runtime throws", async () => {
    vi.useFakeTimers();
    const config = cloneConfig(STRATEGY_PRESETS[0]);
    render(
      <BacktestPanel
        config={config}
        executeBacktest={() => { throw new Error("回測服務暫時無法使用"); }}
        validation={validateConfig(config)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "執行行情回測" }));
    act(() => vi.advanceTimersByTime(40));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "error");
    expect(screen.getByRole("alert")).toHaveTextContent("回測服務暫時無法使用");
  });

  it("immediately hides a completed report when its config fingerprint changes", async () => {
    vi.useFakeTimers();
    const config = cloneConfig(STRATEGY_PRESETS[0]);
    const view = render(<BacktestPanel config={config} validation={validateConfig(config)} />);
    fireEvent.click(screen.getByRole("button", { name: "執行行情回測" }));
    act(() => vi.advanceTimersByTime(40));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole("region", { name: "回測結果" })).toBeInTheDocument();

    config.blocks[0].parameters[0].value += 1;
    view.rerender(<BacktestPanel config={config} validation={validateConfig(config)} />);

    expect(screen.queryByRole("region", { name: "回測結果" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "idle");
  });

  it("returns identical report data when unchanged settings are run again", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行行情回測" }));
    await completeBacktest();
    const first = screen.getByRole("region", { name: "回測結果" }).getAttribute("data-report-key");

    await user.click(screen.getByRole("button", { name: "再次執行行情回測" }));
    await completeBacktest();
    const second = screen.getByRole("region", { name: "回測結果" }).getAttribute("data-report-key");

    expect(second).toBe(first);
  });

  it("marks mutually exclusive position blocks as conflicts", async () => {
    renderWorkshop();

    const addControl = screen.getByRole("button", { name: "加入 ATR 波動倉位" });
    const warning = screen.getByText("與已選擇的固定倉位衝突，請先移除原倉位模組。");
    expect(addControl).toBeDisabled();
    expect(warning).toHaveAttribute("id", "strategy-conflict-atr-sizing");
    expect(addControl).toHaveAttribute("aria-describedby", "strategy-conflict-atr-sizing");

    fireEvent.click(addControl);
    expect(screen.getByRole("region", { name: "已選策略" })).not.toHaveTextContent("ATR 波動倉位");
  });
});
