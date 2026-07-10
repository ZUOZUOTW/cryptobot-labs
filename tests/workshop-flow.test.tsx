import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkshopPage from "../app/workshop/page";
import { BacktestPanel } from "../components/workshop/BacktestPanel";
import { BOT_CATALOG } from "../data/bots";
import { STRATEGY_BLOCKS, STRATEGY_PRESETS } from "../data/strategies";
import * as botPackage from "../lib/bot-package";
import { runBacktest } from "../lib/backtest";
import { validateConfig } from "../lib/strategy-validation";
import type { BotConfig } from "../lib/types";

const DISCLAIMER = "模擬回測資料，不代表未來績效";
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/workshop");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
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
  await user.click(screen.getByRole("button", { name: "穩健趨勢" }));
}

async function completeBacktest() {
  await waitFor(() => {
    expect(screen.getByRole("region", { name: "回測結果" })).toBeInTheDocument();
  });
}

describe("multi-strategy workshop", () => {
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
    expect(screen.getByRole("button", { name: "執行模擬回測" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts the WEEX template for validation and backtesting without executing it", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "JavaScript 模式" }));
    const source = screen.getByRole("textbox", { name: "JavaScript 策略原始碼" });

    expect((source as HTMLTextAreaElement).value).toContain("WEEX");
    expect(screen.getByRole("region", { name: "程式碼靜態預覽" })).toHaveTextContent("不會執行程式碼");
    expect(screen.getByRole("button", { name: "執行模擬回測" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "執行模擬回測" }));
    await completeBacktest();
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeEnabled();
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
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      clickedDownload = this.download;
      clickedWhileConnected = this.isConnected;
    });
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行模擬回測" }));
    await completeBacktest();
    await user.click(screen.getByRole("button", { name: "下載完整策略包" }));

    const dialog = screen.getByRole("dialog", { name: "確認下載完整策略包" });
    expect(dialog).toHaveTextContent("模擬");
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
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      expect(this.isConnected).toBe(true);
      throw new Error("瀏覽器阻擋下載");
    });
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行模擬回測" }));
    await completeBacktest();
    await user.click(screen.getByRole("button", { name: "下載完整策略包" }));
    await user.click(screen.getByRole("button", { name: "確認下載" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("瀏覽器阻擋下載");
    expect(document.body.querySelector(`a[href="${objectUrl}"]`)).toBeNull();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl));
  });

  it("moves focus into the confirmation, traps Tab, closes on Escape, and restores the trigger", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行模擬回測" }));
    await completeBacktest();
    const trigger = screen.getByRole("button", { name: "下載完整策略包" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "確認下載完整策略包" });
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

  it("only exports a report matching the current config fingerprint", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行模擬回測" }));
    await completeBacktest();
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeEnabled();

    fireEvent.change(screen.getByRole("spinbutton", { name: "短期均線數值" }), { target: { value: "12" } });

    expect(screen.queryByRole("region", { name: "回測結果" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeDisabled();
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

  it("keeps import restoration atomic when saving the imported draft fails", async () => {
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

    expect(await screen.findByRole("alert")).toHaveTextContent("無法儲存策略草稿");
    expect(screen.queryByText(/已匯入 cannot-save\.zip/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("SMA 均線交叉");
    expect(screen.getByRole("region", { name: "已選策略" })).not.toHaveTextContent("MACD 動能");
    expect(screen.queryByRole("region", { name: "回測結果" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下載完整策略包" })).toBeDisabled();
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

    await waitFor(() => expect(screen.getByRole("combobox", { name: "市場" })).toHaveValue("futures"));
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("MACD");
    expect(screen.getByRole("region", { name: "已選策略" })).not.toHaveTextContent("SMA 均線交叉");
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
    expect(screen.getByRole("combobox", { name: "市場" })).toHaveValue("spot");
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
    await user.click(screen.getByRole("button", { name: "執行模擬回測" }));

    await completeBacktest();
    expect(screen.getByRole("region", { name: "回測結果" })).toHaveTextContent(DISCLAIMER);
    expect(screen.getByRole("figure", { name: /模擬資產曲線/ })).toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: /回測指標/ })).toHaveLength(9);
  });

  it("disables backtesting and explains when every exit and risk rule is removed", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await loadSteadyTrend(user);
    await user.click(screen.getByRole("button", { name: "移除 固定停損" }));
    await user.click(screen.getByRole("button", { name: "移除 固定停利" }));

    expect(screen.getByText("至少需要一個出場或風控規則")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "執行模擬回測" })).toBeDisabled();
  });

  it.each([
    {
      preset: "穩健趨勢",
      input: "短期均線數值",
      value: "60",
      guidance: "SMA 均線交叉（sma-cross）的短期均線（shortPeriod）必須小於長期均線（longPeriod）",
    },
    {
      preset: "低槓桿風控",
      input: "快線週期數值",
      value: "26",
      guidance: "MACD 動能（macd）的快線週期（fastPeriod）必須小於慢線週期（slowPeriod）",
    },
  ])("blocks contradictory strategy periods in the $preset workshop flow", async ({ preset, input, value, guidance }) => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: preset }));
    fireEvent.change(screen.getByRole("spinbutton", { name: input }), { target: { value } });

    expect(screen.getByRole("region", { name: "策略摘要" })).toHaveTextContent(guidance);
    expect(screen.getByRole("button", { name: "執行模擬回測" })).toBeDisabled();
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
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("RSI Rebound");
  });

  it("ignores an unreadable saved draft and starts from the safe default", () => {
    localStorage.setItem("cryptobot-labs:draft:v1", "{broken-json");

    renderWorkshop();

    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("固定停損");
    expect(screen.getByRole("button", { name: "執行模擬回測" })).toBeEnabled();
  });

  it("restores a valid saved draft after mount", async () => {
    localStorage.setItem("cryptobot-labs:draft:v1", JSON.stringify(STRATEGY_PRESETS[4]));

    renderWorkshop();

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("MACD 動能");
    });
    expect(screen.getByRole("region", { name: "已選策略" })).toHaveTextContent("ATR 波動倉位");
  });

  it("keeps the catalog and presets isolated from the editable current config", async () => {
    const catalogBefore = JSON.stringify(STRATEGY_BLOCKS);
    const presetsBefore = JSON.stringify(STRATEGY_PRESETS);
    const user = userEvent.setup();
    renderWorkshop();

    await loadSteadyTrend(user);
    fireEvent.change(screen.getByRole("spinbutton", { name: "短期均線數值" }), { target: { value: "33" } });
    await user.click(screen.getByRole("button", { name: "加入 RSI Rebound" }));

    expect(JSON.stringify(STRATEGY_BLOCKS)).toBe(catalogBefore);
    expect(JSON.stringify(STRATEGY_PRESETS)).toBe(presetsBefore);

    await loadSteadyTrend(user);
    expect(screen.getByRole("spinbutton", { name: "短期均線數值" })).toHaveValue(20);
    expect(screen.getByRole("region", { name: "已選策略" })).not.toHaveTextContent("RSI Rebound");
  });

  it("exposes the validating, running, and complete backtest states", async () => {
    vi.useFakeTimers();
    renderWorkshop();

    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "idle");
    fireEvent.click(screen.getByRole("button", { name: "執行模擬回測" }));
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "validating");

    act(() => vi.advanceTimersByTime(40));
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "running");
    expect(screen.getByRole("status")).toHaveTextContent("訊號流模擬中");

    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "complete");
  });

  it("returns from validating to idle with guidance when validation rejects the run", () => {
    vi.useFakeTimers();
    const config = cloneConfig(STRATEGY_PRESETS[0]);
    config.blocks.find((block) => block.id === "sma-cross")!
      .parameters.find((parameter) => parameter.key === "shortPeriod")!.value = 60;
    render(<BacktestPanel config={config} validation={{ valid: true, errors: [] }} />);

    fireEvent.click(screen.getByRole("button", { name: "執行模擬回測" }));
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "validating");

    act(() => vi.advanceTimersByTime(40));
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "idle");
    expect(screen.getByRole("alert")).toHaveTextContent("短期均線（shortPeriod）必須小於長期均線（longPeriod）");
  });

  it("enters the error state when the backtest runtime throws", () => {
    vi.useFakeTimers();
    const config = cloneConfig(STRATEGY_PRESETS[0]);
    render(
      <BacktestPanel
        config={config}
        executeBacktest={() => { throw new Error("回測服務暫時無法使用"); }}
        validation={validateConfig(config)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "執行模擬回測" }));
    act(() => vi.advanceTimersByTime(40));
    act(() => vi.advanceTimersByTime(200));

    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "error");
    expect(screen.getByRole("alert")).toHaveTextContent("回測服務暫時無法使用");
  });

  it("immediately hides a completed report when its config fingerprint changes", () => {
    vi.useFakeTimers();
    const config = cloneConfig(STRATEGY_PRESETS[0]);
    const view = render(<BacktestPanel config={config} validation={validateConfig(config)} />);
    fireEvent.click(screen.getByRole("button", { name: "執行模擬回測" }));
    act(() => vi.advanceTimersByTime(40));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("region", { name: "回測結果" })).toBeInTheDocument();

    config.blocks[0].parameters[0].value += 1;
    view.rerender(<BacktestPanel config={config} validation={validateConfig(config)} />);

    expect(screen.queryByRole("region", { name: "回測結果" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "回測控制" })).toHaveAttribute("data-state", "idle");
  });

  it("returns identical report data when unchanged settings are run again", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    await user.click(screen.getByRole("button", { name: "執行模擬回測" }));
    await completeBacktest();
    const first = screen.getByRole("region", { name: "回測結果" }).getAttribute("data-report-key");

    await user.click(screen.getByRole("button", { name: "再次執行模擬回測" }));
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
