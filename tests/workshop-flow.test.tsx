import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkshopPage from "../app/workshop/page";

const DISCLAIMER = "模擬回測資料，不代表未來績效";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderWorkshop() {
  return render(<WorkshopPage />);
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

    expect(screen.getByRole("button", { name: "加入 ATR 波動倉位" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("與已選擇的固定倉位衝突，請先移除原倉位模組。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "加入 ATR 波動倉位" }));
    expect(screen.getByRole("region", { name: "已選策略" })).not.toHaveTextContent("ATR 波動倉位");
  });
});
